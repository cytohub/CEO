import { FileImage, FileSpreadsheet, FileText, type LucideIcon, Presentation } from "lucide-react";
import type { DocumentFormat } from "@/generated/prisma/enums";
import { DOCUMENT_FORMATS } from "@/lib/intelligence";
import { cn } from "@/lib/utils";

const ICON: Partial<Record<DocumentFormat, { icon: LucideIcon; cls: string }>> = {
  PPTX: { icon: Presentation, cls: "text-serious-ink bg-serious-soft" },
  XLSX: { icon: FileSpreadsheet, cls: "text-good-ink bg-good-soft" },
  CSV: { icon: FileSpreadsheet, cls: "text-good-ink bg-good-soft" },
  PDF: { icon: FileText, cls: "text-critical-ink bg-critical-soft" },
  DOCX: { icon: FileText, cls: "text-brand bg-brand-soft" },
  IMAGE: { icon: FileImage, cls: "text-brain bg-brain-soft" },
};

export function DocFormatIcon({ format, className }: { format: DocumentFormat; className?: string }) {
  const m = ICON[format] ?? { icon: FileText, cls: "text-ink-2 bg-muted" };
  return (
    <span className={cn("flex size-8 items-center justify-center rounded-md", m.cls, className)} title={DOCUMENT_FORMATS[format].label}>
      <m.icon className="size-4" aria-label={DOCUMENT_FORMATS[format].label} />
    </span>
  );
}
