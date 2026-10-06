/**
 * Webhook authentication helpers. Webhook routes are outside the session
 * proxy, so every request must prove it came from the provider:
 *
 * - Google Calendar / Drive channels echo the per-connection secret we set as
 *   the channel token (X-Goog-Channel-Token).
 * - Microsoft Graph echoes the per-subscription clientState in each notification.
 * - Dropbox signs the raw body with the app secret (X-Dropbox-Signature).
 * - Gmail push arrives through Pub/Sub with a deployment-level verification token.
 *
 * Only SHA-256 hashes of per-connection secrets are stored; every comparison
 * is constant time.
 */
import { hmacSha256, randomToken, safeEqual, sha256 } from "@/server/security/crypto";

/** A fresh per-connection webhook secret and the hash to store. */
export function newWebhookSecret(): { secret: string; hash: string } {
  const secret = randomToken(32);
  return { secret, hash: sha256(secret) };
}

/** Does the secret a provider echoed back match the stored hash? */
export function verifyWebhookSecret(presented: string | null | undefined, storedHash: string | null | undefined): boolean {
  if (!presented || !storedHash || presented.length > 512) return false;
  return safeEqual(sha256(presented), storedHash);
}

/** Dropbox: hex HMAC-SHA256 of the exact raw body with the app secret. */
export function verifyDropboxSignature(rawBody: string | Buffer, signature: string | null | undefined, appSecret: string | null | undefined): boolean {
  if (!signature || !appSecret || signature.length > 256) return false;
  return safeEqual(hmacSha256(appSecret, rawBody), signature.trim().toLowerCase());
}

/** Shared verification token (Pub/Sub push endpoint for Gmail). */
export function verifySharedToken(presented: string | null | undefined, expected: string | null | undefined): boolean {
  if (!presented || !expected || presented.length > 512) return false;
  return safeEqual(presented, expected);
}

/**
 * Challenge / validation tokens are echoed back as text/plain. Bound their
 * size and charset so the endpoint cannot be used to reflect arbitrary content.
 */
export function safeEchoToken(value: string | null | undefined, maxLength = 1024): string | null {
  if (!value || value.length > maxLength) return null;
  // Graph validation tokens contain spaces, colons and punctuation; disallow control characters and markup.
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f || value[i] === "<" || value[i] === ">") return null;
  }
  return value;
}
