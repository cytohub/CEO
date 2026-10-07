/**
 * The page a request is for. src/proxy.ts sets this header on every request
 * it lets through (overwriting anything the client sent), so server code that
 * does not know its URL — the app layout — can send people back after sign-in.
 * No imports: the proxy loads this module.
 */
export const REQUEST_PATH_HEADER = "x-cytohub-path";

/** Path and query of a URL, without Next's internal `_rsc` cache-buster. */
export function pathOf(url: URL): string {
  const params = new URLSearchParams(url.search);
  params.delete("_rsc");
  const search = params.toString();
  return `${url.pathname}${search ? `?${search}` : ""}`;
}
