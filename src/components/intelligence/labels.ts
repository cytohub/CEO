/** Display labels for ingestion enums not covered by src/lib/intelligence.ts. Client-safe. */
import type { EventStatus, MentionResolution, MentionRole, MessageDirection, PipelineStage, ProcessingStatus, ResponseStatus } from "@/generated/prisma/enums";
import type { Tone } from "@/lib/domain";

export const PROCESSING_STATUS: Record<ProcessingStatus, { label: string; tone: Tone }> = {
  PENDING: { label: "Queued", tone: "neutral" },
  PROCESSING: { label: "Processing", tone: "info" },
  PROCESSED: { label: "Processed", tone: "good" },
  SKIPPED: { label: "Skipped (noise)", tone: "neutral" },
  FAILED: { label: "Failed", tone: "critical" },
};

export const PIPELINE_STAGE: Record<PipelineStage, string> = {
  RAW: "Raw stored",
  NORMALIZED: "Normalized",
  PARSED: "Parsed",
  ENTITIES_EXTRACTED: "Entities extracted",
  ENTITIES_RESOLVED: "Entities resolved",
  RELATIONSHIPS_MAPPED: "Relationships mapped",
  INTELLIGENCE_EXTRACTED: "Intelligence extracted",
  WRITTEN: "Written to the Brain",
};

export const RESPONSE_STATUS: Record<ResponseStatus, { label: string; tone: Tone }> = {
  ACCEPTED: { label: "Accepted", tone: "good" },
  DECLINED: { label: "Declined", tone: "critical" },
  TENTATIVE: { label: "Tentative", tone: "warning" },
  NEEDS_ACTION: { label: "No response", tone: "neutral" },
  ORGANIZER: { label: "Organizer", tone: "info" },
};

export const EVENT_STATUS: Record<EventStatus, { label: string; tone: Tone }> = {
  CONFIRMED: { label: "Confirmed", tone: "good" },
  TENTATIVE: { label: "Tentative", tone: "warning" },
  CANCELLED: { label: "Cancelled", tone: "critical" },
};

export const MENTION_ROLE: Record<MentionRole, string> = {
  SENDER: "Sender",
  RECIPIENT: "Recipient",
  CC: "Cc",
  ORGANIZER: "Organizer",
  ATTENDEE: "Attendee",
  AUTHOR: "Author",
  MENTIONED: "Mentioned",
};

export const MENTION_RESOLUTION: Record<MentionResolution, string> = {
  RESOLVED: "Resolved",
  CREATED: "New record",
  AMBIGUOUS: "Ambiguous",
  UNRESOLVED: "Unresolved",
  IGNORED: "Ignored",
};

export const MESSAGE_DIRECTION: Record<MessageDirection, string> = {
  INBOUND: "Received",
  OUTBOUND: "Sent",
  INTERNAL: "Internal",
};
