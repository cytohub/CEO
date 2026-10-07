/**
 * Password hashing with scrypt (memory-hard, per-user salt).
 * Format: scrypt$N$r$p$<salt b64>$<hash b64>
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { randomToken } from "./crypto";

const N = 1 << 15;
const R = 8;
const P = 1;
const KEY_LEN = 64;
const MAX_MEM = 128 * 1024 * 1024;

function scrypt(password: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize("NFKC"), salt, KEY_LEN, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, { N, r: R, p: P, maxmem: MAX_MEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) {
    // Spend comparable time so missing accounts are not distinguishable by timing.
    await scrypt(password, randomBytes(16), { N, r: R, p: P, maxmem: MAX_MEM });
    return false;
  }
  const [scheme, n, r, p, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), { N: Number(n), r: Number(r), p: Number(p), maxmem: MAX_MEM });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** 144-bit random password, shown once. Grouped so it is easy to read aloud or type. */
export function generateOneTimePassword(): string {
  return randomToken(18)
    .replace(/[-_]/g, "x")
    .match(/.{1,6}/g)!
    .join("-");
}

/** Returns a reason when the password is too weak, else null. */
export function passwordProblem(password: string): string | null {
  if (password.length < 12) return "Use at least 12 characters.";
  if (password.length > 200) return "Use at most 200 characters.";
  if (/^(.)\1+$/.test(password)) return "Avoid repeating a single character.";
  return null;
}
