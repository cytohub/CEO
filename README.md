# CytoHub CEO Command Center

An AI-powered operating system for the CEO of CytoHub. It is not a task manager:
**CytoHub Brain** continuously reads the CEO's email, calendar and company
documents (and the other company systems), turns them into structured,
traceable intelligence, and every morning works out what changed, what is at
risk and what only the CEO can do — the **CEO Daily Intelligence Brief** and
**Today's Top 5**.

```
Email · Calendar · Documents ─▶ Ingestion pipeline ─▶ Tasks · Commitments · Decisions · Risks ·
(Gmail, Outlook, Drive,          (normalize, dedupe,   Opportunities · Meetings · Entities ·
 OneDrive, Dropbox, uploads)      extract, resolve,    Relationships — each with View Source
                                  confidence gate)               │
                                       │ uncertain               ▼
                                       └─▶ Brain Review Queue   Daily Brain Refresh ─▶ CEO Inbox ·
CRM, notes, finance, ELN … ─▶ Signals ─────────────────────────▶ (analyzers, scoring)   Top 5 · Brief
```

The ingestion layer is documented in depth in
[`docs/ingestion/ARCHITECTURE.md`](docs/ingestion/ARCHITECTURE.md).

## What's inside

| Area | Route | What it answers |
| --- | --- | --- |
| **CEO Today** | `/` | Greeting, Brain status, Daily Intelligence Brief (incl. important changes), Today's Top 5, commitments due and overdue, since yesterday, decisions needed, at-risk work, upcoming, goal progress, attention allocation, daily rhythm, end-of-day review |
| **CytoHub Brain** | `/brain` | Refresh history, sources and their health, the insight feed with citations |
| **CEO Inbox** | `/inbox` | What needs the CEO, *why*, the source, recommended action, deadline, strategic relevance and confidence — Take action · Delegate · Snooze · Ignore · Open source |
| **Brain Review Queue** | `/brain/review` | Uncertain or protected intelligence awaiting a human: approve, edit, reject, merge or ignore |
| **Commitments** | `/commitments` | What the CEO promised and what others promised the CEO: due, overdue, fulfilled |
| **Risks & Opportunities** | `/risks` | Extracted risks and opportunities with severity, value, company and source |
| **Email Threads** | `/brain/threads` | Evolving thread summaries, status (awaiting CEO / awaiting them / FYI), commitments and history |
| **Documents** | `/documents` | Classified documents, key facts, version history with change summaries, uploads |
| **View Source** | `/sources/[id]` | The original message, event or document behind any record, with everything derived from it |
| **Tasks** | `/tasks` | Today · Upcoming · Overdue · Completed · Delegated · Waiting · Someday · Historical |
| **Task History** | `/tasks/history` | Everything the CEO has done, filterable by date, priority, goal, focus area, status, person, project and pillar |
| **Goals** | `/goals`, `/goals/[id]` | Company, quarterly, annual, CEO and department goals with confidence, progress, linked work and milestones |
| **Milestones** | `/milestones` | Timeline, quarter, goal and status views |
| **Upcoming** | `/upcoming` | Next 24h / 7d / 30d / 90d with **Prepare Me** briefings (objective, participants, relationship history, recent emails, open tasks and commitments, talking points, risks, desired outcome) |
| **Decision Center** | `/decisions`, `/decisions/[id]` | Needed · Waiting for information · Recently decided · History |
| **Delegation** | `/delegation` | What is delegated, to whom, follow-ups, and what the Brain recommends delegating |
| **Resources** | `/resources` | Documents, links, people and companies |
| **Scoreboard** | `/scoreboard` | Company metrics — all connectable, nothing hard-coded |
| **Weekly / Monthly Review** | `/review/weekly`, `/review/monthly` | What moved, what slipped, where time went |
| **CEO Performance** | `/performance` | Private: impact rather than busyness |
| **AI Chief of Staff** | `/chief-of-staff`, ⌘J panel | Ask anything; answers are grounded in Brain data with citations |
| **Search** | `/search`, ⌘K | Permission-aware universal search with natural-language questions ("What commitments have I made to investors?", "Which customers are waiting on CytoHub?") |
| **Ingestion Health** | `/brain/ingestion` | Sync runs, job queue, failures and retries, review backlog, extraction quality |
| **Settings** | `/settings`, `/settings/integrations`, `/settings/users`, `/settings/audit`, `/settings/retention` | Priorities and thresholds; email, calendar and document accounts (status, last sync, permissions, frequency, run sync now, reconnect, disconnect); users and roles; audit log; data retention |

### Keyboard

| Keys | Action |
| --- | --- |
| `⌘K` / `Ctrl K` | Command bar (search and commands) |
| `⌘J` / `Ctrl J` | AI Chief of Staff |
| `C` | Create task |
| `/` | Focus search |
| `G` then a letter | Go to a page — `T` Today, `B` Brain, `I` Inbox, `K` Tasks, `D` Decisions, `U` Upcoming, `E` Delegation, `G` Goals, `M` Milestones, `S` Scoreboard, `R` Resources, `W` Weekly review, `O` Monthly review, `P` Performance, `C` Chief of Staff, `,` Settings |
| `?` | Show all shortcuts |

## Getting started

Requirements: Node.js ≥ 20.9 and PostgreSQL ≥ 14.

```bash
# 1. Database (or point DATABASE_URL at any Postgres)
docker compose up -d

# 2. Configure
cp .env.example .env            # set DATABASE_URL; set SEED_PASSWORD to choose the demo password

# 3. Install (also generates the Prisma client), migrate and load sample data
npm install
npm run db:setup

# 4. Run
npm run dev                     # http://localhost:3000
```

Sign in as `ceo@cytohub.example` with `SEED_PASSWORD` (a random password is
generated and printed by the seed if it is unset). The seed also creates one
account per role — `elena@` (Executive), `ben@` (Team member), `catherine@`
(Advisor) and `admin@` (Admin), all `@cytohub.example` with the same password —
so you can see what each role can and cannot reach.

The seed loads a realistic CytoHub workspace — pillars, goals, milestones, tasks
with history, decisions, deals, investors, meetings, resources and metrics —
connects a **demo** mailbox, calendar and Google Drive, and runs two Brain
refreshes (yesterday and today) through the real ingestion pipeline: about 100
emails, events and documents become threads, tasks, commitments, decisions,
risks, opportunities, important changes and a handful of review items. Demo
connections keep revealing fixtures over time, so incremental sync, change
detection and "Run sync now" behave as they would with a real account.
`SEED_DEMO_SOURCES=0` seeds without them.

### Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm run db:migrate` | Apply migrations (`prisma migrate deploy`) |
| `npm run db:migrate:dev` | Create a migration after editing `prisma/schema.prisma` |
| `npm run db:seed` | Reset the database to the sample workspace |
| `npm run brain:refresh` | Run the Daily Brain Refresh from the command line |
| `npm run db:bootstrap -- --name … --email …` | First-time production setup: the CEO account (one-time password) and source catalog, no demo data |
| `npm run ingest:worker` | Long-running ingestion worker (self-hosted deployments) |
| `npm run typecheck` · `lint` · `test` | Quality gates |

## Deploying

`ceo.cytolab.ai` runs like cytolab.ai: on an AWS Lightsail server with Docker
Compose (the app, an ingestion worker, PostgreSQL, and Caddy for HTTPS).
[`deploy/lightsail/README.md`](deploy/lightsail/README.md) walks through it,
from creating the server to the first sign-in.
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) covers the Google / Microsoft /
Dropbox app setup, and hosting on Vercel instead.

## Daily Brain Refresh

The refresh runs on a schedule, on demand from the cockpit ("Run morning refresh"),
or from the CLI. A run:

1. **Ingests**: syncs every email, calendar and document connection
   incrementally and drains the ingestion pipeline (extraction, resolution,
   confidence gate, Brain write, change detection), marks meetings that have
   happened and sweeps commitments for due and overdue promises.
2. **Syncs** the other connectors (CRM, notes, …) into `BrainSignal` rows and
   analyzes them.
3. **Analyzes the workspace graph** — overdue and blocked execution, milestone
   health, goal confidence, pending decisions, stale delegations, stalled deals,
   investor follow-ups, meeting prep, attention drift and metric thresholds.
4. **Persists insights** with fingerprints, so a persisting risk updates in place,
   and reconciles the CEO Inbox (one item per record, whichever stage raised it).
5. **Rescores every open task** and recommends Today's Top 5.
6. **Composes the CEO Daily Intelligence Brief** — including important changes
   from ingestion — with citations back to sources.
7. If Claude is configured, rewrites the brief's narrative (after the database
   transaction commits, so a slow model never holds a lock).

### Scheduling

| Endpoint | Purpose | `vercel.json` |
| --- | --- | --- |
| `GET\|POST /api/brain/refresh` | Daily Brain Refresh | 10:30 UTC (06:30 New York) |
| `GET\|POST /api/ingestion/tick` | Queue due syncs (hourly/daily connections), drain the job queue, retention sweep | hourly |

Both require `Authorization: Bearer $CRON_SECRET`; any scheduler that can send
the header works. Webhook-enabled connections also sync on push
(`/api/webhooks/{google,microsoft,dropbox}`). Self-hosted deployments can run
`npm run ingest:worker` instead of (or alongside) the tick — jobs are claimed
with `FOR UPDATE SKIP LOCKED`, so any number of workers can run.

## Connecting real accounts

Without OAuth apps configured, Settings → Integrations offers demo accounts
only. To connect real ones, create an OAuth app per provider, register the
redirect URI `<APP_ORIGIN>/api/integrations/{google|microsoft|dropbox}/callback`,
and set:

| Provider | Sources | How it connects |
| --- | --- | --- |
| Microsoft 365 | Outlook Mail, Teams chats, Outlook Calendar, OneDrive, SharePoint | Sign-in app: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID` |
| Google | Gmail, Google Calendar, Google Drive (read-only scopes) | Sign-in app: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`; Gmail push: `GOOGLE_PUBSUB_TOPIC`, `GOOGLE_PUBSUB_VERIFICATION_TOKEN` |
| Dropbox | Dropbox files | Sign-in app: `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET` (also verifies webhooks) |
| QuickBooks Online | Monthly P&L, bank balances → revenue, expenses, burn, runway | Sign-in app: `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`, `QUICKBOOKS_ENV` |
| DocuSign | Agreements sent, signed, declined, waiting on the CEO | Sign-in app: `DOCUSIGN_CLIENT_ID`, `DOCUSIGN_CLIENT_SECRET`, `DOCUSIGN_ENV` |
| HubSpot | Deals, pipelines, companies, owners | Service key pasted in Settings → Integrations |
| Brex | Live cash, cash movements, card spend | Read-only user token pasted in Settings → Integrations |
| Granola | Meeting notes | API key pasted in Settings → Integrations |
| Read AI | Meeting reports after each meeting | Signed webhook; signing key pasted in Settings → Integrations |
| Uploads | PDF, DOCX, PPTX, XLSX, CSV, TXT, MD, images (≤ 25 MB) | — |

Sign-in apps use the authorization code flow with state (and PKCE where the
vendor supports it); tokens and pasted keys are encrypted with
`CYTOHUB_ENCRYPTION_KEY` (required in production), checked with the vendor
before they are stored, and never sent to a browser. Each connection has a
sync frequency — Manual, Hourly, Daily or Webhook (with an hourly safety
sync). Step-by-step setup for every vendor: [docs/CONNECTORS.md](docs/CONNECTORS.md).

## Roles and access

Every page, server action and route re-verifies the session and checks a
capability on the server; navigation only hides what a role cannot open.

| Role | Can use | Reads source content up to |
| --- | --- | --- |
| CEO | Everything | Restricted |
| Executive | Tasks, goals, decisions, commitments, risks, Brain, threads, documents, review queue, search, health | Confidential |
| Team member | Search over the emails, events and documents they are cleared for, and their source viewers | Internal |
| Advisor | The same, limited to explicit grants | Only what is explicitly granted |
| Admin | Integrations, settings, users, audit log, retention, health, search | Internal |

Source content is also limited by connection ownership and explicit access
grants. Search, View Source, Prepare Me, summaries and the Chief of Staff all go
through the same filter, so restricted information never leaks through AI
answers. Sign-ins, password changes, connection changes, source views, review
decisions and permission and retention changes are written to the audit log.

Passwords an administrator sets or resets (Settings → Users) are temporary: the
user must choose their own at the next sign-in before they can open anything
else. Anyone can change their password from the account menu; doing so signs
out every other device.

## CEO Priority Score

Every open task gets a 0–100 score with drivers and a plain-language rationale.
Weights are configurable in Settings and normalized to 100:

| Factor | Default weight | Factor | Default weight |
| --- | ---: | --- | ---: |
| Strategic impact | 16 | Risk | 8 |
| CEO uniqueness | 13 | Dependency (tasks it unblocks) | 7 |
| Urgency (days to due) | 12 | Customer impact | 7 |
| Revenue impact | 10 | Scientific impact | 6 |
| Fundraising impact | 10 | Opportunity cost | 6 |
| | | Deadline (hard vs soft) | 5 |

Modifiers: P0 ×1.10, P1 ×1.04, P3 ×0.85; work on an at-risk goal ×1.05; delegable
work (uniqueness ≤ 2) ×0.85 and flagged for delegation; blocked ×0.93; waiting ×0.80;
postponed three or more times +3 points. Top 5 selection keeps CEO pins, skips work
the Brain recommends delegating and allows at most two tasks per goal.

## AI (optional)

With `ANTHROPIC_API_KEY` set, Claude extracts intelligence from emails, events
and documents (structured outputs, validated against a schema with verbatim
evidence before anything is written), reads text from images, and powers the
Chief of Staff, Prepare Me briefings and the brief narrative. The model is set
by `CYTOHUB_CLAUDE_MODEL`. Without a key everything still works: a
deterministic rules engine produces the same extraction schema, answers Chief
of Staff questions from the same tools and composes the brief from templates.

## Testing

```bash
npm run typecheck && npm run lint && npm test
```

`npm test` runs the unit suites (security, jobs, providers, parsers,
extraction quality, resolution, search planning, retention, …). The ingestion
integration test writes to the database, so it runs only against a disposable
copy seeded without demo sources:

```bash
SEED_DEMO_SOURCES=0 DATABASE_URL=…/scratch npx tsx prisma/seed.ts
INGEST_INTEGRATION=1 DATABASE_URL=…/scratch node --import tsx --test src/server/ingestion/write/pipeline.integration.test.ts
```

## Architecture

- **Next.js 16 App Router** with React Server Components; mutations are server
  actions in `src/server/actions`, reads are typed queries in `src/server/queries`.
  `src/proxy.ts` sends unauthenticated requests to sign-in.
- **PostgreSQL + Prisma 7** (`prisma/schema.prisma`) — the execution graph
  (pillars, goals, milestones, tasks, decisions, deals, meetings, people,
  companies, …), the ingestion model (connections, source items, threads,
  messages, events, documents and versions, commitments, risks, opportunities,
  aliases, mentions, relationships, source references, review items, jobs,
  runs) and security (users, sessions, access grants, audit log, rate limits).
  Calendar days are stored as `DATE`; instants are rendered in the CEO's timezone.
- **Ingestion** in `src/server/ingestion` — providers, sync, normalization,
  document parsing, extraction, resolution, the Brain writer, jobs, search,
  retention and health. See [the architecture doc](docs/ingestion/ARCHITECTURE.md).
- **CytoHub Brain** in `src/server/brain` — connectors, analyzers, scoring,
  priorities, attention, metrics, brief composition and the refresh pipeline.
- **Security** in `src/server/security` — sessions, passwords, roles and
  capabilities, source-level access, encryption, audit, rate limiting.
- **Chief of Staff** in `src/server/chief` — Brain query tools shared by the
  Claude tool runner and the rules engine; streamed from `/api/chief-of-staff`.
- **UI** — Tailwind 4 and shadcn/ui, light and dark themes, keyboard-first.

```
prisma/                 schema, migrations, seed workspace
scripts/                CLI entry points (brain:refresh, ingest:worker)
docs/ingestion/         ingestion architecture
src/app/(app)/          pages (all dynamic, server-rendered, role-checked)
src/app/api/            crons, OAuth connect/callback, webhooks, uploads, Chief of Staff stream
src/components/         UI by area (today, inbox, intelligence, integrations, admin, health, …)
src/server/ingestion/   ingestion pipeline
src/server/brain/       CytoHub Brain
src/server/security/    authentication, authorization, encryption, audit
src/server/chief/       AI Chief of Staff
src/server/actions/     server actions (validated with zod, capability-checked)
src/server/queries/     read models per page
src/lib/                dates, formatting, domain vocab, db client
```
