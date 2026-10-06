/**
 * Pure, client-safe helpers for the intelligence pages: URL safety, upload
 * validation, commitment due-state, and the review-proposal field model that
 * drives the per-kind editors (with a generic fallback for unknown fields).
 * No React, no database — unit-tested in model.test.ts.
 */
import type { ReviewKind } from "@/generated/prisma/enums";
import {
  CommitmentDirection,
  CommitmentStatus,
  CompanyType,
  DecisionStatus,
  FocusArea,
  MeetingType,
  MilestoneStatus,
  OpportunityKind,
  PersonType,
  Priority,
  RiskStatus,
  TaskStatus,
} from "@/generated/prisma/enums";
import { daysBetween, formatDay, relativeDay } from "@/lib/dates";
import type { Tone } from "@/lib/domain";
import { COMPANY_TYPES, DECISION_STATUS, FOCUS_AREAS, MEETING_TYPES, MILESTONE_STATUS, PERSON_TYPES, PRIORITY, TASK_STATUS } from "@/lib/domain";
import { COMMITMENT_DIRECTION, COMMITMENT_STATUS, OPPORTUNITY_KIND, RISK_STATUS } from "@/lib/intelligence";
import { RISK_CATEGORIES } from "@/server/ingestion/extraction-schema";
import { EDITABLE_FIELDS, PROPOSAL_SCHEMAS } from "@/server/ingestion/write/review-schemas";

// ─── URLs ────────────────────────────────────────────────────────────────────

/** Only http(s) links to originals are ever rendered (no javascript:, data:, file: …). */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string" || url.length > 2048) return null;
  try {
    const u = new URL(url.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

// ─── Uploads ─────────────────────────────────────────────────────────────────

export const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
export const UPLOAD_EXTENSIONS = ["pdf", "docx", "pptx", "xlsx", "csv", "txt", "md", "png", "jpg", "jpeg", "webp"] as const;

export function fileExtension(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

/** Client-side pre-check; the upload route re-validates (size, extension, magic bytes). */
export function validateUploadFile(file: { name: string; size: number }): string | null {
  const ext = fileExtension(file.name);
  if (!(UPLOAD_EXTENSIONS as readonly string[]).includes(ext)) return `“.${ext || "?"}” files aren’t supported. Use ${UPLOAD_EXTENSIONS.join(", ")}.`;
  if (file.size <= 0) return "That file is empty.";
  if (file.size > UPLOAD_MAX_BYTES) return `That file is ${formatBytes(file.size)} — the limit is 25 MB.`;
  return null;
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

// ─── Commitments ─────────────────────────────────────────────────────────────

export interface DueState {
  days: number | null;
  overdue: boolean;
  label: string;
  tone: Tone;
}

/** Due label for an OPEN commitment (calendar days; "Overdue" is derived, never stored). */
export function commitmentDue(dueDate: Date | null | undefined, today: Date, open = true): DueState {
  if (!dueDate) return { days: null, overdue: false, label: "No date", tone: "neutral" };
  const days = daysBetween(today, dueDate);
  if (!open) return { days, overdue: false, label: formatDay(dueDate), tone: "neutral" };
  if (days < 0) return { days, overdue: true, label: relativeDay(dueDate, today), tone: "critical" };
  if (days === 0) return { days, overdue: false, label: "Due today", tone: "serious" };
  if (days <= 2) return { days, overdue: false, label: relativeDay(dueDate, today), tone: "warning" };
  return { days, overdue: false, label: relativeDay(dueDate, today), tone: "neutral" };
}

/** Overdue first (most overdue first), then soonest due, undated last; ties by commitment age. */
export function sortByUrgency<T extends { dueDate: Date | null; committedAt: Date }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const ad = a.dueDate?.getTime() ?? Infinity;
    const bd = b.dueDate?.getTime() ?? Infinity;
    return ad - bd || a.committedAt.getTime() - b.committedAt.getTime();
  });
}

// ─── Review proposals ────────────────────────────────────────────────────────
// Shapes and editability come from src/server/ingestion/write/review-schemas.ts
// (PROPOSAL_SCHEMAS / EDITABLE_FIELDS). Known fields get a typed editor; any
// other key still renders (read-only unless the schema marks it editable).

export type FieldType = "text" | "textarea" | "date" | "number" | "money" | "rating" | "boolean" | "enum" | "person" | "company" | "goal" | "list" | "json";

export interface FieldSpec {
  path: string[];
  label: string;
  type: FieldType;
  options?: readonly { value: string; label: string }[];
  /** Shown even when the proposal does not carry it (only when editable). */
  always?: boolean;
  /** For person pickers: sibling key with the name as written in the source. */
  nameKey?: string;
  placeholder?: string;
}

export interface ProposalField {
  path: string[];
  key: string;
  label: string;
  type: FieldType;
  value: unknown;
  editable: boolean;
  spec?: FieldSpec;
  /** Free-text name that came with a person field ("Priya"). */
  nameValue?: string | null;
}

export const RISK_CATEGORY_OPTIONS = RISK_CATEGORIES.map((v) => ({ value: v, label: v.charAt(0) + v.slice(1).toLowerCase() }));

const opts = <T extends string>(values: readonly T[], label: (v: T) => string) => values.map((v) => ({ value: v, label: label(v) }));
const DIRECTION_OPTIONS = opts(Object.values(CommitmentDirection), (v) => COMMITMENT_DIRECTION[v].label);
const PRIORITY_OPTIONS = opts(Object.values(Priority), (p) => `${p} · ${PRIORITY[p].label}`);
const FOCUS_OPTIONS = opts(Object.values(FocusArea), (v) => FOCUS_AREAS[v].label);
const COMPANY_TYPE_OPTIONS = opts(Object.values(CompanyType), (t) => COMPANY_TYPES[t].label);
const PERSON_TYPE_OPTIONS = opts(Object.values(PersonType), (t) => PERSON_TYPES[t].label);
const OPPORTUNITY_KIND_OPTIONS = opts(Object.values(OpportunityKind), (k) => OPPORTUNITY_KIND[k].label);
const MEETING_TYPE_OPTIONS = opts(Object.values(MeetingType), (k) => MEETING_TYPES[k].label);

const f = (path: string | string[], label: string, type: FieldType, extra: Partial<FieldSpec> = {}): FieldSpec => ({ path: Array.isArray(path) ? path : [path], label, type, ...extra });
const companyF = f("companyId", "Company", "company");
const goalF = f("goalId", "Goal", "goal");
const ownerF = (label = "Owner", always = false) => f("ownerPersonId", label, "person", { nameKey: "ownerName", always });

/** Known fields per review kind, in display order. */
export const PROPOSAL_FIELDS: Record<ReviewKind, FieldSpec[]> = {
  TASK: [
    f("title", "Title", "text", { always: true }),
    ownerF("Owner", true),
    f("dueDate", "Due", "date", { always: true }),
    f("dueText", "Due as written", "text"),
    f("priority", "Priority", "enum", { options: PRIORITY_OPTIONS }),
    f("hardDeadline", "Hard deadline", "boolean"),
    f("focusArea", "Function", "enum", { options: FOCUS_OPTIONS }),
    companyF,
    goalF,
    f("description", "Description", "textarea"),
  ],
  COMMITMENT: [
    f("direction", "Direction", "enum", { options: DIRECTION_OPTIONS, always: true }),
    f("title", "Title", "text", { always: true }),
    f("counterpartyPersonId", "Owed to", "person", { nameKey: "counterpartyName", always: true }),
    ownerF("Owed by", true),
    f("dueDate", "Due", "date", { always: true }),
    f("dueText", "Due as written", "text"),
    f("followUpDate", "Follow up on", "date"),
    companyF,
    f("mirrorTask", "Track as a CEO task", "boolean"),
    f("priority", "Priority", "enum", { options: PRIORITY_OPTIONS }),
    f("text", "As written", "textarea"),
  ],
  DEADLINE: [
    f("what", "What", "text", { always: true }),
    f("date", "Date", "date", { always: true }),
    f("hard", "Hard deadline", "boolean", { always: true }),
    ownerF(),
    f("priority", "Priority", "enum", { options: PRIORITY_OPTIONS }),
  ],
  DECISION: [
    f("status", "Status", "enum", { options: [{ value: "MADE", label: "Decision made" }, { value: "NEEDED", label: "Decision needed" }], always: true }),
    f("title", "Title", "text", { always: true }),
    f("decision", "Decision", "textarea", { always: true }),
    f("decidedByName", "Decided by", "text"),
    f("deadline", "Deadline", "date"),
    ownerF(),
    f("strategicImpact", "Strategic impact", "rating"),
    goalF,
    f("options", "Options", "list"),
    f("context", "Context", "textarea"),
  ],
  RISK: [
    f("title", "Title", "text", { always: true }),
    f("severity", "Severity", "rating", { always: true }),
    f("category", "Category", "enum", { options: RISK_CATEGORY_OPTIONS, always: true }),
    f("likelihood", "Likelihood", "rating"),
    companyF,
    goalF,
    ownerF(),
    f("description", "Description", "textarea"),
  ],
  OPPORTUNITY: [
    f("title", "Title", "text", { always: true }),
    f("kind", "Kind", "enum", { options: OPPORTUNITY_KIND_OPTIONS, always: true }),
    f("estimatedValue", "Value (USD)", "money", { always: true }),
    f("nextStep", "Next step", "text", { always: true }),
    companyF,
    f("personId", "Contact", "person"),
    goalF,
    f("description", "Description", "textarea"),
  ],
  MEETING: [
    f("title", "Title", "text", { always: true }),
    f("startsAt", "Starts", "text"),
    f("endsAt", "Ends", "text"),
    f("type", "Type", "enum", { options: MEETING_TYPE_OPTIONS }),
    f("importance", "Importance", "rating"),
    f("location", "Location", "text"),
    f("objective", "Objective", "textarea"),
  ],
  ENTITY_MERGE: [],
  NEW_PERSON: [
    f("name", "Name", "text", { always: true }),
    f("email", "Email", "text", { always: true }),
    f("title", "Title", "text", { always: true }),
    f("type", "Type", "enum", { options: PERSON_TYPE_OPTIONS, always: true }),
    companyF,
  ],
  NEW_COMPANY: [
    f("name", "Name", "text", { always: true }),
    f("type", "Type", "enum", { options: COMPANY_TYPE_OPTIONS, always: true }),
    f("domain", "Domain", "text", { always: true, placeholder: "example.com" }),
    f("industry", "Industry", "text", { always: true }),
  ],
  NEW_INVESTOR: [
    f("name", "Name", "text", { always: true }),
    f("domain", "Domain", "text", { always: true, placeholder: "example.com" }),
    f("website", "Website", "text"),
    f("industry", "Industry", "text"),
    f("createDeal", "Open a fundraising deal", "boolean", { always: true }),
    f("dealName", "Deal name", "text"),
  ],
  FIELD_CHANGE: [f("note", "Note", "textarea")],
  DOCUMENT_CHANGE: [],
};

/** Keys rendered by dedicated UI (merge compare, field change, document change) rather than as fields. */
const STRUCTURAL_KEYS: Partial<Record<ReviewKind, string[]>> = {
  ENTITY_MERGE: ["entityType", "keepId", "keepLabel", "mergeId", "mergeLabel", "score", "reason"],
  FIELD_CHANGE: ["targetType", "targetId", "targetLabel", "field", "from", "to", "fromLabel", "toLabel", "changeKind"],
  DOCUMENT_CHANGE: ["documentId", "versionId", "title", "changes"],
};

/** Bookkeeping shown elsewhere on the card (confidence, evidence) or internal to scoring. */
const HIDDEN_KEYS = new Set(["confidence", "evidence", "scores", "source", "fingerprint"]);

const FIELD_CHANGE_LABEL: Record<string, string> = { dueDate: "Due date", ownerId: "Owner", status: "Status", value: "Value", severity: "Severity", deadline: "Deadline", expectedClose: "Expected close" };
const STATUS_OPTIONS: Record<string, { value: string; label: string }[]> = {
  TASK: opts(Object.values(TaskStatus), (s) => TASK_STATUS[s].label),
  COMMITMENT: opts(Object.values(CommitmentStatus), (s) => COMMITMENT_STATUS[s].label),
  MILESTONE: opts(Object.values(MilestoneStatus), (s) => MILESTONE_STATUS[s].label),
  RISK: opts(Object.values(RiskStatus), (s) => RISK_STATUS[s].label),
  DECISION: opts(Object.values(DecisionStatus), (s) => DECISION_STATUS[s].label),
  MEETING: [
    { value: "SCHEDULED", label: "Scheduled" },
    { value: "CANCELLED", label: "Cancelled" },
    { value: "COMPLETED", label: "Completed" },
  ],
};

export function fieldChangeLabel(field: unknown): string {
  return typeof field === "string" ? (FIELD_CHANGE_LABEL[field] ?? humanizeKey(field)) : "Value";
}

/** The typed editor for a FIELD_CHANGE proposal's `to` value. */
export function fieldChangeSpec(targetType: unknown, field: unknown): FieldSpec {
  const label = `New ${fieldChangeLabel(field).toLowerCase()}`;
  switch (field) {
    case "dueDate":
    case "deadline":
    case "expectedClose":
      return f("to", label, "date");
    case "ownerId":
      return f("to", label, "person");
    case "status":
      return f("to", label, "enum", { options: STATUS_OPTIONS[String(targetType)] ?? [] });
    case "value":
      return f("to", label, "money");
    case "severity":
      return f("to", label, "rating");
    default:
      return f("to", label, "text");
  }
}

export function humanizeKey(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : key;
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function getIn(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const k of path) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

/** Immutable set; creates intermediate objects. */
export function setIn(obj: Record<string, unknown>, path: string[], value: unknown): Record<string, unknown> {
  const [head, ...rest] = path;
  if (!rest.length) return { ...obj, [head]: value };
  const child = isPlainObject(obj[head]) ? (obj[head] as Record<string, unknown>) : {};
  return { ...obj, [head]: setIn(child, rest, value) };
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Guess an editor for a value the field model does not know about. */
export function inferType(key: string, value: unknown): FieldType {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return /value|amount|price|usd/i.test(key) ? "money" : "number";
  if (typeof value === "string") {
    if (ISO_DAY.test(value) || (/date|deadline|^due/i.test(key) && !value)) return "date";
    return value.length > 80 || /description|text|summary|note|body|context/i.test(key) ? "textarea" : "text";
  }
  if (Array.isArray(value)) return value.every((x) => typeof x === "string" || typeof x === "number") ? "list" : "json";
  if (value == null) return /date|deadline/i.test(key) ? "date" : "text";
  return "json";
}

/** Internal identifiers stay in the proposal but are not shown as fields. */
function isHiddenKey(key: string): boolean {
  return HIDDEN_KEYS.has(key) || /(^id$|Id$|Ids$)/.test(key);
}

export function isEditable(kind: ReviewKind, key: string): boolean {
  return (EDITABLE_FIELDS[kind] ?? []).includes(key);
}

/**
 * Ordered field list for a proposal: known fields first (when present, or
 * always-on and editable), then every other key — nested objects one level
 * deep — with an inferred editor. Nothing is silently dropped from view
 * except internal ids/bookkeeping and keys a dedicated renderer owns.
 */
export function proposalFields(kind: ReviewKind, proposal: unknown): ProposalField[] {
  const p = isPlainObject(proposal) ? proposal : {};
  const specs: FieldSpec[] = kind === "FIELD_CHANGE" ? [fieldChangeSpec(p.targetType, p.field), ...PROPOSAL_FIELDS.FIELD_CHANGE] : (PROPOSAL_FIELDS[kind] ?? []);
  // Full dotted keys already rendered (or owned by a dedicated renderer).
  const consumed = new Set<string>((STRUCTURAL_KEYS[kind] ?? []).filter((k) => !(kind === "FIELD_CHANGE" && k === "to")));
  const out: ProposalField[] = [];

  for (const spec of specs) {
    const value = getIn(p, spec.path);
    const nameValue = spec.nameKey ? ((p[spec.nameKey] as string | null | undefined) ?? null) : undefined;
    const editable = spec.path.length === 1 && isEditable(kind, spec.path[0]);
    const present = value !== undefined || (spec.nameKey !== undefined && nameValue != null);
    consumed.add(spec.path.join("."));
    if (spec.nameKey) consumed.add(spec.nameKey);
    if (!present && !(spec.always && editable)) continue;
    out.push({ path: spec.path, key: spec.path.join("."), label: spec.label, type: spec.type, value: value ?? null, editable, spec, nameValue });
  }

  for (const [key, value] of Object.entries(p)) {
    if (consumed.has(key) || isHiddenKey(key)) continue;
    if (isPlainObject(value)) {
      for (const [sub, v] of Object.entries(value)) {
        if (consumed.has(`${key}.${sub}`) || isHiddenKey(sub) || isPlainObject(v)) continue;
        out.push({ path: [key, sub], key: `${key}.${sub}`, label: `${humanizeKey(key)} · ${humanizeKey(sub).toLowerCase()}`, type: inferType(sub, v), value: v, editable: false });
      }
      continue;
    }
    out.push({ path: [key], key, label: humanizeKey(key), type: inferType(key, value), value, editable: isEditable(kind, key) });
  }
  return out;
}

function cleanString(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function cleanNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Coerce one edited value to the field's type (empty → null). */
export function coerceValue(type: FieldType, v: unknown): unknown {
  switch (type) {
    case "text":
    case "textarea":
    case "enum":
    case "person":
    case "company":
    case "goal":
      return cleanString(v);
    case "date": {
      const s = cleanString(v);
      return s && ISO_DAY.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()) ? s : null;
    }
    case "number":
    case "money":
      return cleanNumber(v);
    case "rating": {
      const n = cleanNumber(v);
      return n == null ? null : Math.min(5, Math.max(1, Math.round(n)));
    }
    case "boolean":
      return v === true || v === "true";
    case "list":
      if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
      return String(v ?? "")
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean);
    default:
      return v;
  }
}

/**
 * The `edited` patch sent with "Save & approve": every editable field the
 * reviewer saw, coerced to its type. Only EDITABLE_FIELDS are sent — the
 * writer merges them over the stored proposal and re-validates.
 */
export type EditValue = string | number | boolean | null | string[];

export function buildEdit(kind: ReviewKind, draft: Record<string, unknown>): Record<string, EditValue> {
  const out: Record<string, EditValue> = {};
  for (const field of proposalFields(kind, draft)) {
    // Structured values have no editor; they stay as stored.
    if (!field.editable || field.type === "json") continue;
    out[field.path[0]] = coerceValue(field.type, getIn(draft, field.path)) as EditValue;
  }
  return out;
}

/**
 * Pre-flight the reviewer's edit against the writer's schema (the server
 * validates again). Only problems in fields the reviewer edited are
 * returned — keyed by top-level field — so a stale stored proposal never
 * blocks the form with errors the reviewer cannot fix.
 */
export function validateEdit(kind: ReviewKind, proposal: unknown, edited: Record<string, unknown>): Record<string, string> {
  const patch: Record<string, unknown> = { ...edited };
  if (kind === "FIELD_CHANGE" && "to" in patch) patch.toLabel = null;
  const result = PROPOSAL_SCHEMAS[kind].safeParse({ ...(isPlainObject(proposal) ? proposal : {}), ...patch });
  if (result.success) return {};
  const out: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? "");
    if (key in edited && !out[key]) out[key] = issue.message;
  }
  return out;
}

/** Read-only display string for a field value. */
export function displayValue(field: Pick<ProposalField, "type" | "value" | "spec">): string {
  const v = field.value;
  if (v == null || v === "" || (Array.isArray(v) && !v.length)) return "—";
  switch (field.type) {
    case "date":
      return typeof v === "string" && ISO_DAY.test(v) ? formatDay(new Date(`${v}T00:00:00Z`), true) : String(v);
    case "money": {
      const n = cleanNumber(v);
      return n == null ? String(v) : `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
    }
    case "rating":
      return `${v}/5 · ${severityLabel(Number(v))}`;
    case "boolean":
      return v ? "Yes" : "No";
    case "enum":
      return field.spec?.options?.find((o) => o.value === v)?.label ?? humanizeKey(String(v));
    case "list":
      return Array.isArray(v) ? v.join(" · ") : String(v);
    case "json":
      return JSON.stringify(v);
    default:
      // Enum-like values from unknown fields ("INVESTOR", "NEEDS_ACTION") read as words.
      return typeof v === "string" && /^[A-Z][A-Z0-9_]+$/.test(v) ? humanizeKey(v) : String(v);
  }
}

export function severityLabel(severity: number): string {
  return severity >= 5 ? "Critical" : severity >= 4 ? "High" : severity >= 3 ? "Moderate" : severity >= 2 ? "Low" : "Minimal";
}

export function severityTone(severity: number): Tone {
  return severity >= 5 ? "critical" : severity >= 4 ? "serious" : severity >= 3 ? "warning" : "neutral";
}

// ─── Review proposal special shapes (tolerant readers) ───────────────────────

export interface ChangeRow {
  label: string;
  from: string | null;
  to: string | null;
  significance: string | null;
}

/** Significant changes in a DOCUMENT_CHANGE proposal or a DocumentVersion. */
export function readChanges(value: unknown): ChangeRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isPlainObject)
    .map((c) => ({
      label: cleanString(c.label) ?? cleanString(c.field) ?? "Change",
      from: c.from == null ? null : String(c.from),
      to: c.to == null ? null : String(c.to),
      significance: cleanString(c.significance),
    }));
}

export interface KeyFact {
  label: string;
  value: string;
  kind: string | null;
}

export function readKeyFacts(value: unknown): KeyFact[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isPlainObject).flatMap((x) => {
    const label = cleanString(x.label);
    const v = x.value == null ? null : String(x.value);
    return label && v ? [{ label, value: v, kind: cleanString(x.kind) }] : [];
  });
}

export interface Candidate {
  entityId: string;
  label: string;
  score: number | null;
}

export function readCandidates(value: unknown): Candidate[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isPlainObject).flatMap((c) => {
    const entityId = cleanString(c.entityId) ?? cleanString(c.id);
    if (!entityId) return [];
    return [{ entityId, label: cleanString(c.label) ?? cleanString(c.name) ?? entityId, score: cleanNumber(c.score) }];
  });
}

/** { name, email } pairs from EmailThread.participants / EmailMessage.to (tolerant of bad JSON). */
export function readPeople(value: unknown): { name: string | null; email: string | null; role?: string | null; personId?: string | null }[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isPlainObject).map((p) => ({
    name: cleanString(p.name),
    email: cleanString(p.email),
    role: cleanString(p.role),
    personId: cleanString(p.personId),
  }));
}

export function personLabel(p: { name: string | null; email: string | null }): string {
  return p.name ?? p.email ?? "Unknown";
}
