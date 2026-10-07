/**
 * Largest file a user can upload directly from the browser. Some hosts cap
 * request bodies below the 25 MB document limit (Vercel: 4.5 MB), so
 * NEXT_PUBLIC_UPLOAD_MAX_MB can lower it; the upload dialog and the upload
 * route then agree on the real limit. Files synced from Drive, OneDrive or
 * Dropbox are fetched server-side and keep the 25 MB limit.
 */
const DOCUMENT_LIMIT_MB = 25;

function configuredMb(): number {
  const mb = Number(process.env.NEXT_PUBLIC_UPLOAD_MAX_MB);
  return Number.isFinite(mb) && mb > 0 ? Math.min(mb, DOCUMENT_LIMIT_MB) : DOCUMENT_LIMIT_MB;
}

export const UPLOAD_MAX_BYTES = Math.floor(configuredMb() * 1024 * 1024);
export const UPLOAD_MAX_LABEL = `${Number(configuredMb().toFixed(1))} MB`;
