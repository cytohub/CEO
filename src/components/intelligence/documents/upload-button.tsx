"use client";

import { AlertCircle, ArrowRight, CheckCircle2, FileUp, Loader2, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, SimpleSelect } from "@/components/common/fields";
import { Meter } from "@/components/common/status";
import { useCan, useViewer } from "@/components/shell/ui-context";
import type { Sensitivity } from "@/generated/prisma/enums";
import { SENSITIVITY } from "@/lib/intelligence";
import { cn } from "@/lib/utils";
import { clearanceAllows, ROLE_CLEARANCE } from "@/server/security/rbac";
import { formatBytes, UPLOAD_EXTENSIONS, validateUploadFile } from "../model";

interface UploadResult {
  documentId: string | null;
  sourceItemId?: string;
  status?: string;
  outcome?: "created" | "updated" | "unchanged";
  version?: number | null;
  title?: string;
  error?: string;
}

type Phase = { kind: "idle" } | { kind: "uploading"; pct: number } | { kind: "processing" } | { kind: "done"; result: UploadResult } | { kind: "error"; message: string };

const ACCEPT = UPLOAD_EXTENSIONS.map((e) => `.${e}`).join(",");

function messageFor(status: number, body: { error?: string } | null): string {
  if (status === 404) return "Uploads aren’t available yet — the upload service isn’t running.";
  if (status === 401) return "Your session expired. Sign in again and retry.";
  if (status === 403) return body?.error ?? "You don’t have permission to upload documents.";
  if (status === 413) return body?.error ?? "The file is larger than the 25 MB limit.";
  if (status === 415) return body?.error ?? "That file type isn’t supported.";
  if (status === 429) return body?.error ?? "Too many uploads — try again in a few minutes.";
  return body?.error ?? "The upload failed. Please try again.";
}

/** POST multipart to /api/uploads with progress. XHR (not fetch) because fetch has no upload progress. */
function send(form: FormData, onProgress: (pct: number) => void, onSent: () => void): Promise<{ status: number; body: (UploadResult & { error?: string }) | null }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads");
    xhr.responseType = "text";
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.upload.onload = onSent;
    xhr.onload = () => {
      let body = null;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        body = null;
      }
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => resolve({ status: 0, body: { documentId: null, error: "Network error — check your connection and try again." } });
    xhr.send(form);
  });
}

/**
 * Upload a document (or a new version of one) into CytoHub Brain. The route
 * re-validates size, extension and magic bytes; this checks first so the
 * CEO is not kept waiting on a file that will be refused.
 */
export function UploadButton({ documentId, label = "Upload", variant = "default" }: { documentId?: string; label?: string; variant?: "default" | "outline" }) {
  const canUpload = useCan("workspace.edit");
  const viewer = useViewer();
  const router = useRouter();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [sensitivity, setSensitivity] = useState<Sensitivity | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  if (!canUpload) return null;

  const clearance = ROLE_CLEARANCE[viewer.role];
  const levels = (Object.keys(SENSITIVITY) as Sensitivity[]).filter((s) => clearanceAllows(clearance, s));
  const busy = phase.kind === "uploading" || phase.kind === "processing";
  const fileError = file ? validateUploadFile(file) : null;

  const pick = (f: File | null | undefined) => {
    if (!f) return;
    setFile(f);
    setPhase({ kind: "idle" });
  };
  const reset = () => {
    setFile(null);
    setSensitivity(null);
    setPhase({ kind: "idle" });
  };

  async function upload() {
    if (!file || fileError || busy) return;
    const form = new FormData();
    form.append("file", file);
    if (sensitivity) form.append("sensitivity", sensitivity);
    if (documentId) form.append("documentId", documentId);
    setPhase({ kind: "uploading", pct: 0 });
    const { status, body } = await send(
      form,
      (pct) => setPhase({ kind: "uploading", pct }),
      () => setPhase({ kind: "processing" }),
    );
    if (status >= 200 && status < 300 && body) {
      setPhase({ kind: "done", result: body });
      router.refresh();
    } else {
      setPhase({ kind: "error", message: messageFor(status, body) });
    }
  }

  return (
    <>
      <Button size="sm" variant={variant} onClick={() => setOpen(true)}>
        <Upload /> {label}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (busy) return;
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{documentId ? "Upload a new version" : "Upload a document"}</DialogTitle>
            <DialogDescription>CytoHub Brain parses it, extracts key facts and intelligence, and links everything back to the file.</DialogDescription>
          </DialogHeader>

          {phase.kind === "done" ? (
            <div className="space-y-3">
              <div className={cn("flex items-start gap-2.5 rounded-lg border p-3", phase.result.error ? "border-warning/40 bg-warning-soft" : "border-good/30 bg-good-soft")}>
                {phase.result.error ? <AlertCircle className="mt-0.5 size-4 shrink-0 text-warning-ink" aria-hidden /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-good-ink" aria-hidden />}
                <div className="min-w-0 text-[13px]">
                  <p className="font-medium">
                    {phase.result.outcome === "unchanged" ? "Already up to date — this exact file was uploaded before." : phase.result.outcome === "updated" ? `Saved as version ${phase.result.version ?? ""}` : "Uploaded"}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-ink-2">{phase.result.title ?? file?.name}</p>
                  {phase.result.error ? (
                    <p className="mt-1 text-xs text-warning-ink">{phase.result.error}</p>
                  ) : (
                    phase.result.status !== "PROCESSED" && <p className="mt-1 text-xs text-muted-foreground">Extraction continues in the background — derived intelligence appears as it is written.</p>
                  )}
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={reset}>
                  Upload another
                </Button>
                {phase.result.documentId && (
                  <Button asChild onClick={() => setOpen(false)}>
                    <Link href={`/documents/${phase.result.documentId}`}>
                      Open document <ArrowRight />
                    </Link>
                  </Button>
                )}
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <label
                htmlFor={inputId}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  pick(e.dataTransfer.files?.[0]);
                }}
                className={cn(
                  "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-4 py-7 text-center transition-colors focus-within:ring-2 focus-within:ring-ring/50",
                  dragging ? "border-brand bg-brand-soft/50" : "border-input hover:bg-muted/40",
                  busy && "pointer-events-none opacity-60",
                )}
              >
                <FileUp className="size-5 text-ink-3" aria-hidden />
                {file ? (
                  <>
                    <span className="max-w-full truncate text-[13px] font-medium">{file.name}</span>
                    <span className="text-2xs text-muted-foreground">{formatBytes(file.size)} · choose another file</span>
                  </>
                ) : (
                  <>
                    <span className="text-[13px] font-medium">Drop a file here, or click to choose</span>
                    <span className="text-2xs text-muted-foreground">PDF, Word, PowerPoint, Excel, CSV, text, Markdown or images · up to 25 MB</span>
                  </>
                )}
                <input
                  ref={inputRef}
                  id={inputId}
                  type="file"
                  accept={ACCEPT}
                  className="sr-only"
                  disabled={busy}
                  onChange={(e) => {
                    pick(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
              {fileError && (
                <p role="alert" className="flex items-start gap-1.5 text-xs text-critical-ink">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {fileError}
                </p>
              )}
              <Field label="Sensitivity" htmlFor={`${inputId}-sens`} hint={sensitivity ? SENSITIVITY[sensitivity].description : "Default for your uploads (usually Confidential)."}>
                <SimpleSelect
                  id={`${inputId}-sens`}
                  size="sm"
                  value={sensitivity}
                  onChange={(v) => setSensitivity(v as Sensitivity | null)}
                  allowNone
                  noneLabel="Default"
                  options={levels.map((s) => ({ value: s, label: SENSITIVITY[s].label }))}
                  className="w-[200px]"
                />
              </Field>
              {(phase.kind === "uploading" || phase.kind === "processing") && (
                <div className="space-y-1.5" aria-live="polite">
                  <div className="flex justify-between text-2xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <Loader2 className="size-3 animate-spin" aria-hidden />
                      {phase.kind === "uploading" ? "Uploading…" : "Parsing and extracting…"}
                    </span>
                    {phase.kind === "uploading" && <span className="tabular">{phase.pct}%</span>}
                  </div>
                  <Meter value={phase.kind === "uploading" ? phase.pct : 100} tone={phase.kind === "processing" ? "brain" : "info"} label="Upload progress" className={phase.kind === "processing" ? "animate-pulse" : undefined} />
                </div>
              )}
              {phase.kind === "error" && (
                <p role="alert" className="flex items-start gap-1.5 rounded-md bg-critical-soft px-2.5 py-2 text-xs text-critical-ink">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {phase.message}
                </p>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button onClick={upload} disabled={!file || Boolean(fileError) || busy}>
                  {busy ? <Loader2 className="animate-spin" /> : <Upload />} Upload
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
