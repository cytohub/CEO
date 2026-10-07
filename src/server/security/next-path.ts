/**
 * Post-sign-in destinations come from the URL, so only same-site relative
 * paths are honoured; sign-in and the password change page are never targets
 * (they would loop).
 */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  if (/^\/(?:login|account\/password)(?:[/?#]|$)/.test(next)) return null;
  return next;
}
