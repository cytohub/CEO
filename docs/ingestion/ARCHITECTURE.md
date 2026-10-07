# CytoHub Brain — Ingestion Architecture

CytoHub Brain turns the CEO's email, calendar and company documents into
structured, traceable intelligence: tasks, commitments, decisions, risks,
opportunities, meetings, entities and relationships. It is not a search index.
Every record it writes points back to the source that produced it, and anything
uncertain or high-impact goes to a human before it becomes company truth.

## 1. What already existed, and what this extends

| Existing | Role after this change |
| --- | --- |
| `BrainSource` | Connector **catalog** (one row per connector type). Accounts are now `SourceConnection` rows that belong to a catalog entry. |
| `BrainSignal` + `analyzeSignals` | Lightweight path, kept for CRM, Teams and meeting-note signals. Email, calendar and documents use the full ingestion pipeline below. |
| `runBrainRefresh` | Gains an **ingest** stage at the front: sync every connection incrementally, drain the pipeline, then run the existing analyzers, inbox reconciliation, rescoring, Top 5 and brief. |
| `Meeting`, `Task`, `Decision`, `BrainInsight`, `InboxItem`, `Activity` | Extended in place with provenance, confidence and attention fields; no parallel copies. |
| `buildPrepBrief` (Prepare Me) | Upgraded to draw on threads, commitments, documents and relationship history. |
| `searchWorkspace` | Superseded by permission-aware universal search with a natural-language query planner. |
| No authentication | **Added**: sessions, roles, capabilities, source-level permissions, audit log. Every server action and route re-verifies the caller. |

## 2. Pipeline

```
Source connector ─► Raw ingestion ─► Normalization ─► Deduplication
   ─► Entity extraction ─► Classification ─► Entity resolution ─► Relationship mapping
   ─► AI intelligence extraction (validated) ─► Confidence gate ─┬─► Brain write (provenance)
                                                                └─► Brain Review Queue
   ─► Change detection ─► Thread summary ─► CEO attention engine ─► CEO Inbox / Top 5 / Brief
```

Each stage is a plain service in `src/server/ingestion/` with typed input and
output. Stages persist their output on the `SourceItem`, so a failed stage is
retried from where it stopped instead of re-running the whole chain.

### Jobs

A Postgres-backed queue (`IngestionJob`, claimed with `FOR UPDATE SKIP LOCKED`)
runs the stages. No extra infrastructure is needed; a Redis or SQS backend can
replace `jobs/queue.ts` without touching handlers.

| Job | Does |
| --- | --- |
| `EMAIL_SYNC`, `CALENDAR_SYNC`, `DOCUMENT_SYNC` | Pull changes since the connection cursor; raw-store + normalize; enqueue processing |
| `DOCUMENT_PARSE` | Extract text from PDF/DOCX/PPTX/XLSX/CSV/TXT/MD/images; create a `DocumentVersion` when content changed |
| `ENTITY_EXTRACTION` | Mentions + classification (relevance, category, sensitivity); noise stops here |
| `ENTITY_RESOLUTION` | Map mentions to canonical people, companies and projects |
| `RELATIONSHIP_MAPPING` | Graph edges between the item and its entities |
| `INTELLIGENCE_EXTRACTION` | Claude structured output (or the rules engine), validated |
| `BRAIN_WRITE` | Confidence gate, dedupe, write records + provenance, change detection, attention |
| `THREAD_SUMMARY` | Re-summarize an email thread after new messages (debounced per thread) |
| `PRIORITY_RECALC` | Rescore tasks and recommend Top 5 (debounced) |
| `DAILY_BRAIN_REFRESH` | The morning pipeline |
| `RETENTION_SWEEP` | Apply retention policy |

Retries back off exponentially with jitter (`attempts`, `maxAttempts`, `runAt`);
a job that keeps failing becomes `DEAD` and shows on the health dashboard with a
retry button. Stale locks are recovered. Enqueueing is idempotent via `dedupeKey`.

Jobs run from: the Daily Brain Refresh, "Run sync now", provider webhooks, the
`/api/ingestion/tick` cron endpoint (hourly/daily schedules), and
`npm run ingest:worker` for a long-running worker.

## 3. Sources

Provider adapters implement one of three interfaces (`EmailProvider`,
`CalendarProvider`, `DocumentProvider`) that return **changes since a cursor**:

| Provider | Incremental mechanism | Push |
| --- | --- | --- |
| Gmail | `users.history.list` from `historyId` | Pub/Sub push (token-verified) |
| Outlook Mail | Graph `messages/delta` deltaLink | Graph subscription (`clientState`) |
| Google Calendar | `events.list` `syncToken` | Channel watch (`X-Goog-Channel-Token`) |
| Outlook Calendar | Graph `calendarView/delta` | Graph subscription |
| Google Drive | `changes.list` `pageToken` | Channel watch |
| OneDrive / SharePoint | Graph `drive/root/delta` | Graph subscription |
| Dropbox | `list_folder/continue` cursor | Webhook (HMAC) |
| Local upload | Direct | — |
| CytoHub internal | Meeting notes and memos written in the app | — |

Connections run in `LIVE` mode (OAuth 2.0 + PKCE, encrypted refresh tokens) or
`DEMO` mode (mock adapters over realistic CytoHub fixtures, revealed over time
so incremental sync and change detection behave exactly as with a real account).

## 4. Data model (new and extended)

**Security** — `User.role` (`CEO`, `EXECUTIVE`, `TEAM_MEMBER`, `ADMIN`, `ADVISOR`),
`Session` (hashed tokens), `AccessGrant` (per-connection / per-item / per-document
grants), `AuditLog`, `RateLimitBucket`.

**Sources** — `SourceConnection` (account, mode, status, frequency, scopes,
encrypted credentials, cursor, webhook), `SourceItem` (the provenance anchor:
one row per message, event or document, with content hash, relevance, attention,
sensitivity and stage state), `EmailThread` (evolving summary), `EmailMessage`,
`EmailAttachment`, `CalendarEvent` (→ `Meeting`), `Document`, `DocumentVersion`
(hash, change summary, significant changes, key facts), `StoredBlob` (encrypted raw copies).

**Intelligence** — `Commitment` (outbound / inbound, due, follow-up, fulfilment),
`Risk`, `Opportunity`, `Project` (projects, scientific programs, products),
`EntityAlias` (names, emails, domains, abbreviations, subsidiaries),
`EntityMention`, `Relationship` (typed graph edges with confidence and evidence),
`SourceReference` (provenance snapshot that survives retention purges),
`ReviewQueueItem`.

**Operations** — `IngestionJob`, `IngestionRun` (per-sync stats: fetched, new,
updated, noise, duplicates prevented, records written, review items, errors).

Extended: `Company.parentId` + `domain`, `Meeting.category/status`,
`InboxItem.attention/confidence/source`, `BrainInsight` + `Activity` provenance
links and new types (`CHANGE`, `COMMITMENT_*`, `DEADLINE_CHANGED`, `RISK_*`, …).

## 5. Intelligence extraction

The extractor returns one validated JSON document per source item (see
`src/server/ingestion/extraction-schema.ts`): entities, tasks, commitments,
decisions, deadlines, risks, opportunities, follow-ups, meeting requests,
metrics and key facts, relationships, CEO relevance, strategic relevance and
recommended actions, each with a confidence score and a **verbatim evidence
quote**.

Validation before anything is written:

1. Schema validation (zod).
2. Evidence must appear in the source text (whitespace-normalized); otherwise the item is dropped.
3. Dates must parse and fall within a sane window; relative dates resolve in the CEO's timezone against the message date.
4. Names resolve to canonical entities or are flagged.
5. Source content is treated as untrusted data; instructions inside emails or documents are never followed.

With `ANTHROPIC_API_KEY` set, Claude produces the extraction with structured
outputs; otherwise a deterministic rules engine produces the same schema.

## 6. Confidence gate and review

| Confidence | Default behavior |
| --- | --- |
| High (≥ 0.80) | Written automatically unless the record is in a protected class |
| Medium (0.55–0.80) | Brain Review Queue |
| Low (< 0.55) | Review if the source is High/Critical relevance; otherwise kept only in the extraction record |

Protected classes always go to review, whatever the confidence: recorded
decisions, entity merges, new investor identification, changes to deadlines or
owners of existing work, deal value changes and milestone date changes. The
reviewer can **approve, edit, reject, merge or ignore**; approval runs the same
writer as automatic creation.

## 7. Deduplication

* **Source level** — `(connection, externalId)`, RFC 5322 `Message-ID` across
  providers, and content hashes (unchanged content is not reprocessed).
* **Intelligence level** — before creating a task or commitment the writer looks
  for an existing one from the same thread or entity with a similar action and a
  compatible date (token-set similarity on normalized text; the scorer is
  pluggable for embeddings). A match is updated and gains a corroborating
  source reference instead of creating a duplicate; the event is counted.

## 8. Change detection

Compares new facts with the state already in the Brain and raises an
`Important change` insight with impact and recommended action, for example a
meeting moved, a customer requesting a new deliverable, a deadline moved, a
proposal value changed, a milestone slipping, a new scientific result, a new
investor entering the pipeline, a contract signed, or a document whose key
figures changed between versions ($10M → $15M raise).

## 9. CEO attention engine

Every written item is scored on strategic impact, revenue, fundraising,
customer importance, risk, urgency, deadline, CEO relationship ownership, legal
impact, scientific significance and opportunity size, then classified:
`IMMEDIATE`, `TODAY`, `THIS_WEEK`, `MONITOR`, `DELEGATE` or `ARCHIVE`. Only
`IMMEDIATE`/`TODAY` (and CEO-owed commitments due this week) reach the CEO
Inbox, so the CEO does not get hundreds of notifications:

* **Grouped per thread** — a conversation is one item that evolves with it.
* **One item per record** — if the Daily Brain Refresh or another thread already
  filed the same decision, commitment, task, risk, opportunity or deal, that
  item is refreshed with the newer context (wording, source, attention) instead
  of a second one being filed (`src/server/inbox-dedupe.ts`).
* **Capped** — at most 8 new ingestion items per CEO day; `IMMEDIATE` bypasses the cap.
* **Respectful of resolution** — an item the CEO closed reopens only for newer
  `IMMEDIATE` information (or `TODAY` information, if it was marked done).

Each item says what happened, why it needs the CEO, the source, the
recommended action, the deadline, strategic relevance and confidence; the CEO
can take action, delegate, snooze, ignore or open the source.

## 10. Security

* Sessions: random 256-bit tokens, SHA-256 hashed at rest, `httpOnly`,
  `SameSite=Lax`, `Secure` with the `__Host-` prefix in production, sliding
  12-hour idle expiry and a 7-day absolute lifetime. Changing a user's role,
  deactivating them or resetting their password revokes their sessions.
* Passwords: scrypt with per-user salt; login rate-limited and lockout after
  repeated failures. A password an administrator sets or resets is temporary
  (`User.mustChangePassword`): until the user replaces it, `getViewer()`
  treats the session as signed out, so every page, action and API route fails
  closed and pages redirect to `/account/password`. Changing a password
  (required or from the account menu) revokes every session and issues a new one.
* Authorization: role → capabilities; source content additionally filtered by
  **clearance** (`INTERNAL` < `CONFIDENTIAL` < `RESTRICTED`), connection
  ownership and explicit `AccessGrant`s. Search, View Source, Prepare Me and the
  Chief of Staff all go through the same filter. When the filter hides
  matching sources, search says so ("Some matching sources aren't available
  at your access level") without revealing what they are, so a partial answer
  is never mistaken for a complete one.
* Secrets: OAuth tokens, raw payloads and stored documents encrypted with
  AES-256-GCM (`CYTOHUB_ENCRYPTION_KEY`, required in production). Ciphertext is
  versioned, so keys rotate by moving the old key to
  `CYTOHUB_ENCRYPTION_KEY_PREVIOUS`. Disk-level encryption is expected from the
  database host.
* CSRF: server actions are origin-checked by Next.js; custom routes check
  `Origin` and use `SameSite` cookies. Webhooks verify provider tokens or HMAC
  signatures with constant-time comparison.
* Rate limiting, input validation (zod everywhere), file validation (size,
  extension allowlist, magic-byte sniffing), audit log for sign-ins, connection
  changes, source views, review decisions, permission and retention changes.

## 11. Retention

Configurable per data class: raw email bodies, attachments, raw document
copies, AI extraction outputs, and behavior when a source item is deleted
upstream (`KEEP_HISTORY`, `REDACT_CONTENT`, `DELETE_DERIVED`). Provenance
snapshots (`SourceReference`) and metadata survive content purges unless the
policy says otherwise, so company history is never silently destroyed.

## 12. Implementation phases

All five phases are implemented:

1. Schema, source abstraction, email / calendar / document ingestion, raw storage, incremental sync.
2. Entity, task, commitment, deadline, decision, risk and opportunity extraction.
3. Entity resolution, relationship graph, deduplication, source traceability, review queue.
4. Daily Brain Refresh, CEO Inbox, Top 5, Prepare Me, universal search.
5. Production security, monitoring, retries, audit logs, performance.

## 13. Operating it

| Concern | Where |
| --- | --- |
| Connect, reconnect, disconnect, set frequency, run sync now | Settings → Integrations (`/settings/integrations`) |
| Sync runs, queue depth, failed and dead jobs (retry), review backlog | Ingestion Health (`/brain/ingestion`) |
| Uncertain or protected intelligence | Brain Review Queue (`/brain/review`) |
| Users and roles, audit log, retention policy | `/settings/users`, `/settings/audit`, `/settings/retention` |
| Scheduled syncs and retention | `/api/ingestion/tick` (cron, `Bearer $CRON_SECRET`) or `npm run ingest:worker` |
| Morning pipeline | `/api/brain/refresh` (cron) or "Run morning refresh" |

**Adding a provider** means implementing `EmailProvider`, `CalendarProvider` or
`DocumentProvider` (`src/server/ingestion/types.ts`) — changes since a
cursor, plus optional webhook subscribe/verify — and registering it in
`providers/registry.ts`. Everything downstream (normalization, extraction,
resolution, the Brain writer, search and retention) is provider-agnostic.

**Demo mode.** `DEMO` connections use mock adapters over CytoHub fixtures
(`providers/mock/`) anchored to the connection's creation time; each sync
reveals what has "arrived" since the cursor, so the full pipeline — including
incremental sync, version changes and change detection — runs exactly as it
would against a live account.

**Testing.** `npm test` covers security, jobs, providers and webhooks, parsers,
extraction quality, resolution, search planning, health and retention. The
end-to-end writer test needs a disposable database seeded with
`SEED_DEMO_SOURCES=0`; see the header of
`src/server/ingestion/write/pipeline.integration.test.ts`.
