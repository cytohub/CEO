/** Only http(s) URLs render as links; anything else (javascript:, data:, typos) stays plain text. */
export function safeHref(url: string | null | undefined): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}
