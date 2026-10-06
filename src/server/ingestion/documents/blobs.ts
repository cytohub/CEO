/**
 * Encrypted binary store for raw document copies and attachments.
 *
 * Blobs are addressed by the SHA-256 of their plaintext, so the same file
 * synced twice (or attached to ten emails) is stored once. Data is sealed with
 * AES-256-GCM (security/crypto) before it reaches the database; purging keeps
 * the row (hash, size, type) so provenance survives and drops the bytes.
 */
import { Prisma } from "@/generated/prisma/client";
import { db, type Db, type Tx } from "@/lib/db";
import { decryptBytes, encryptBytes, sha256 } from "@/server/security/crypto";

export interface StoredBlobRef {
  id: string;
  sha256: string;
  sizeBytes: number;
  /** False when an identical blob was already stored. */
  created: boolean;
}

/** AES-256-GCM sealed bytes in the shape Prisma's Bytes column expects. */
export function sealBlob(plain: Buffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(encryptBytes(plain));
}

export function openBlob(sealed: Uint8Array): Buffer {
  return decryptBytes(Buffer.from(sealed.buffer, sealed.byteOffset, sealed.byteLength));
}

export async function storeBlob(bytes: Buffer, mimeType: string, client: Db | Tx = db): Promise<StoredBlobRef> {
  const hash = sha256(bytes);
  const existing = await client.storedBlob.findUnique({ where: { sha256: hash }, select: { id: true, data: true, sizeBytes: true } });
  if (existing?.data) return { id: existing.id, sha256: hash, sizeBytes: existing.sizeBytes, created: false };
  if (existing) {
    // Purged earlier by retention and seen again: store the bytes anew.
    await client.storedBlob.update({ where: { id: existing.id }, data: { data: sealBlob(bytes), purgedAt: null, mimeType } });
    return { id: existing.id, sha256: hash, sizeBytes: existing.sizeBytes, created: true };
  }
  try {
    const row = await client.storedBlob.create({ data: { sha256: hash, sizeBytes: bytes.length, mimeType, data: sealBlob(bytes) }, select: { id: true } });
    return { id: row.id, sha256: hash, sizeBytes: bytes.length, created: true };
  } catch (error) {
    // Lost a race with a concurrent store of the same bytes.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const raced = await client.storedBlob.findUnique({ where: { sha256: hash }, select: { id: true } });
      if (raced) return { id: raced.id, sha256: hash, sizeBytes: bytes.length, created: false };
    }
    throw error;
  }
}

/** Decrypted bytes, or null when the blob is missing or was purged. */
export async function readBlob(id: string, client: Db | Tx = db): Promise<Buffer | null> {
  const row = await client.storedBlob.findUnique({ where: { id }, select: { data: true, sha256: true } });
  if (!row?.data) return null;
  const plain = openBlob(row.data);
  // Integrity check: the address is the plaintext hash.
  if (sha256(plain) !== row.sha256) throw new Error(`Stored blob ${id} failed its integrity check`);
  return plain;
}

/**
 * Drops a blob's bytes (retention). A blob shared with email attachments is
 * kept unless `force` — attachments follow their own retention window.
 * Returns true when bytes were purged.
 */
export async function purgeBlob(id: string, opts: { force?: boolean; client?: Db | Tx } = {}): Promise<boolean> {
  const client = opts.client ?? db;
  if (!opts.force) {
    const attachments = await client.emailAttachment.count({ where: { blobId: id } });
    if (attachments > 0) return false;
  }
  const res = await client.storedBlob.updateMany({ where: { id, data: { not: null } }, data: { data: null, purgedAt: new Date() } });
  return res.count > 0;
}

/** Deletes a blob row nothing references any more (e.g. the bytes of a version that turned out identical). */
export async function deleteBlobIfUnreferenced(id: string, client: Db | Tx = db): Promise<boolean> {
  const res = await client.storedBlob.deleteMany({ where: { id, versions: { none: {} }, attachments: { none: {} } } });
  return res.count > 0;
}
