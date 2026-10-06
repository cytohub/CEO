/**
 * Application-level encryption and hashing.
 *
 * - AES-256-GCM for secrets at rest (OAuth tokens, raw provider payloads,
 *   stored blobs). Ciphertext is versioned ("v1:") so keys can rotate:
 *   set CYTOHUB_ENCRYPTION_KEY to the new key and CYTOHUB_ENCRYPTION_KEY_PREVIOUS
 *   to the old one; reads fall back to the previous key, writes use the new one.
 * - SHA-256 for content hashes and token hashes; HMAC-SHA256 for webhooks.
 *
 * Keys are 32 bytes, base64 or hex encoded. Production refuses to start
 * encrypting without a key; development uses a fixed, clearly-labelled dev key.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

let keys: { current: Buffer; previous: Buffer | null } | null = null;
let warned = false;

function decodeKey(raw: string, name: string): Buffer {
  const trimmed = raw.trim();
  const buf = /^[0-9a-f]{64}$/i.test(trimmed) ? Buffer.from(trimmed, "hex") : Buffer.from(trimmed, "base64");
  if (buf.length !== 32) throw new Error(`${name} must be 32 bytes (base64 or hex). Generate one with: openssl rand -base64 32`);
  return buf;
}

function loadKeys() {
  if (keys) return keys;
  const raw = process.env.CYTOHUB_ENCRYPTION_KEY;
  let current: Buffer;
  if (raw) {
    current = decodeKey(raw, "CYTOHUB_ENCRYPTION_KEY");
  } else {
    if (process.env.NODE_ENV === "production" && process.env.CYTOHUB_ALLOW_DEV_KEY !== "true") {
      throw new Error("CYTOHUB_ENCRYPTION_KEY is required in production. Generate one with: openssl rand -base64 32");
    }
    if (!warned) {
      console.warn("[security] CYTOHUB_ENCRYPTION_KEY not set — using the development key. Never use this with real data.");
      warned = true;
    }
    current = createHash("sha256").update("cytohub-development-only-encryption-key").digest();
  }
  const prev = process.env.CYTOHUB_ENCRYPTION_KEY_PREVIOUS;
  keys = { current, previous: prev ? decodeKey(prev, "CYTOHUB_ENCRYPTION_KEY_PREVIOUS") : null };
  return keys;
}

/** True when a real (non-development) encryption key is configured. */
export function encryptionKeyConfigured(): boolean {
  return Boolean(process.env.CYTOHUB_ENCRYPTION_KEY);
}

function seal(plain: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

function open(sealed: Buffer, key: Buffer): Buffer {
  const iv = sealed.subarray(0, IV_BYTES);
  const tag = sealed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const body = sealed.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

function openWithRotation(sealed: Buffer): Buffer {
  const { current, previous } = loadKeys();
  try {
    return open(sealed, current);
  } catch (error) {
    if (previous) return open(sealed, previous);
    throw error;
  }
}

export function encryptBytes(plain: Buffer): Buffer {
  return seal(plain, loadKeys().current);
}

export function decryptBytes(sealed: Buffer): Buffer {
  return openWithRotation(sealed);
}

export function encryptString(plain: string): string {
  return `${VERSION}:${encryptBytes(Buffer.from(plain, "utf8")).toString("base64")}`;
}

export function decryptString(token: string): string {
  const [version, payload] = token.split(":", 2);
  if (version !== VERSION || !payload) throw new Error("Unsupported ciphertext format");
  return openWithRotation(Buffer.from(payload, "base64")).toString("utf8");
}

export function encryptJson(value: unknown): string {
  return encryptString(JSON.stringify(value));
}

export function decryptJson<T>(token: string): T {
  return JSON.parse(decryptString(token)) as T;
}

export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function hmacSha256(secret: string | Buffer, data: string | Buffer): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

/** URL-safe random token (default 256 bits). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Constant-time string comparison (hashes first so lengths never leak). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}
