import { CalendarDays, FileText, Handshake, Landmark, Mail, NotebookPen, Signature, type LucideIcon } from "lucide-react";
import type { SourceKind } from "@/generated/prisma/enums";

export const KIND_ICON: Record<SourceKind, LucideIcon> = {
  EMAIL: Mail,
  CALENDAR: CalendarDays,
  DOCUMENTS: FileText,
  MEETINGS: NotebookPen,
  CRM: Handshake,
  FINANCE: Landmark,
  CONTRACTS: Signature,
};

/** What one ingested item is called, per source kind. */
export const KIND_NOUN: Record<SourceKind, string> = {
  EMAIL: "email",
  CALENDAR: "calendar",
  DOCUMENTS: "document",
  MEETINGS: "meeting notes",
  CRM: "CRM",
  FINANCE: "finance",
  CONTRACTS: "contracts",
};
