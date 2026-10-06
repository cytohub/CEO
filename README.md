# CytoHub CEO Command Center

An AI-powered operating system for the CEO of CytoHub. It is not a task manager:
every morning **CytoHub Brain** reads the company's systems, works out what changed,
what is at risk and what only the CEO can do, and turns that into a short, ranked
plan — the **CEO Daily Intelligence Brief** and **Today's Top 5**.

```
Sources ─▶ Signals ─▶ Analyzers ─▶ Insights ─▶ Inbox · Priority Scores · Top 5 ─▶ Brief
(M365, HubSpot,       (commitments,   (risk, staleness,   (why it needs the CEO,     (narrative,
 Granola, ELN, …)      escalations…)   attention drift…)   recommended action)        citations)
```

## What's inside

| Area | Route | What it answers |
| --- | --- | --- |
| **CEO Today** | `/` | Greeting, Brain status, Daily Intelligence Brief, Today's Top 5 (complete, reschedule, delegate, re-prioritize, notes), since yesterday, decisions needed, at-risk work, upcoming, goal progress, attention allocation (actual vs recommended), daily rhythm, end-of-day review |
| **CytoHub Brain** | `/brain` | Refresh history, sources and their health, the insight feed with citations |
| **CEO Inbox** | `/inbox` | Items that need the CEO, *why* they need the CEO, and the recommended action (convert to task/decision, delegate, snooze, dismiss) |
| **Tasks** | `/tasks` | Today · Upcoming · Overdue · Completed · Delegated · Waiting · Someday · Historical, with search, filters and sorting |
| **Task History** | `/tasks/history` | Everything the CEO has done, filterable by date, priority, goal, focus area, status, person, project and pillar |
| **Goals** | `/goals`, `/goals/[id]` | Company, quarterly, annual, CEO and department goals with confidence, progress, linked work and milestones |
| **Milestones** | `/milestones` | Timeline, quarter, goal and status views; due soon, at risk, overdue, blocked, completed |
| **Upcoming** | `/upcoming` | Next 24h / 7d / 30d / 90d with **Prepare Me** briefings |
| **Decision Center** | `/decisions`, `/decisions/[id]` | Needed · Waiting for information · Recently decided · History, with options, recommendation and rationale |
| **Delegation** | `/delegation` | What is delegated, to whom, follow-up dates, overdue check-ins, and what the Brain recommends delegating |
| **Resources** | `/resources` | Documents, links, people and companies, linkable to goals, tasks, milestones and decisions |
| **Scoreboard** | `/scoreboard` | Company metrics (cash, runway, revenue, pipeline, science, people) — all connectable, nothing hard-coded |
| **Weekly / Monthly Review** | `/review/weekly`, `/review/monthly` | What moved, what slipped, where time went, what to change |
| **CEO Performance** | `/performance` | Private: impact (outcomes, decisions, unblocks) rather than busyness |
| **AI Chief of Staff** | `/chief-of-staff`, ⌘J panel | Ask anything about the company; answers are grounded in Brain data with citations |
| **Search** | `/search`, ⌘K | Search every entity, run commands |
| **Settings** | `/settings` | Strategic pillars, priority weights, attention targets, Brain thresholds, sources |

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
cp .env.example .env            # set DATABASE_URL; ANTHROPIC_API_KEY is optional

# 3. Install (also generates the Prisma client), migrate and load sample data
npm install
npm run db:setup

# 4. Run
npm run dev                     # http://localhost:3000
```

The seed loads a realistic CytoHub workspace — strategic pillars, goals,
milestones, ~90 tasks with history, decisions, deals, investors, meetings,
resources, metrics and connector signals — and runs two Brain refreshes
(yesterday and today) so the cockpit has a "since yesterday" story on first load.

### Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm run db:migrate` | Apply migrations (`prisma migrate deploy`) |
| `npm run db:migrate:dev` | Create a migration after editing `prisma/schema.prisma` |
| `npm run db:seed` | Reset the database to the sample workspace |
| `npm run brain:refresh` | Run the Daily Brain Refresh from the command line |
| `npm run typecheck` · `lint` · `test` | Quality gates |

## Daily Brain Refresh

The refresh runs on a schedule, on demand from the cockpit ("Run morning refresh"),
or from the CLI. A run:

1. **Syncs** each configured connector into `BrainSignal` rows.
2. **Analyzes signals** — commitments become tasks, escalations, approval and
   investor requests become inbox items; each signal is classified from connector
   metadata or a keyword fallback.
3. **Analyzes the workspace graph** — overdue and blocked execution, milestone
   health, goal confidence, pending decisions, stale delegations, stalled deals,
   investor follow-ups, meeting prep, attention drift and metric thresholds.
4. **Persists insights** with fingerprints, so a persisting risk updates in place
   instead of duplicating, and reconciles the CEO Inbox.
5. **Rescores every open task** and recommends Today's Top 5.
6. **Composes the CEO Daily Intelligence Brief** with citations back to sources.
7. If Claude is configured, rewrites the brief's narrative (after the database
   transaction commits, so a slow model never holds a lock).

### Scheduling

`GET|POST /api/brain/refresh` with `Authorization: Bearer $CRON_SECRET`.
`vercel.json` schedules it at 10:30 UTC (06:30 New York) on Vercel; any scheduler
that can send the header works (GitHub Actions, Cloud Scheduler, cron + curl).

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
the Brain recommends delegating and allows at most two tasks per goal so one
initiative cannot crowd out the rest.

## AI (optional)

With `ANTHROPIC_API_KEY` set, Claude powers the Chief of Staff (streaming, with
tools that query the Brain), Prepare Me briefings and the brief narrative. The
model is set by `CYTOHUB_CLAUDE_MODEL`. Without a key everything still works:
a deterministic rules engine answers Chief of Staff questions from the same tools
and the brief is composed from templates.

## Connectors

Sources live in `src/server/brain/connectors.ts`. Each connector normalizes an
external system into `BrainSignal` rows and is inert until its credentials are set:

| Connector | Environment |
| --- | --- |
| Outlook Mail, Outlook Calendar, Teams, SharePoint/OneDrive | `MS365_TENANT_ID`, `MS365_CLIENT_ID`, `MS365_CLIENT_SECRET` |
| HubSpot CRM | `HUBSPOT_ACCESS_TOKEN` |
| Granola | `GRANOLA_API_KEY` |
| Read AI | `READ_AI_API_KEY` |
| DocuSign | `DOCUSIGN_ACCESS_TOKEN` |
| Accounting & banking | `FINANCE_API_KEY` |
| ELN / LIMS | `ELN_API_KEY` |
| HRIS & recruiting | `HRIS_API_KEY` |

Seeded sources are marked as *sample* in the UI. Implementing a vendor means
filling in its `sync()` — the analysis stage only ever reads signals and the
workspace graph.

## Architecture

- **Next.js 16 App Router** with React Server Components; mutations are server
  actions in `src/server/actions`, reads are typed queries in `src/server/queries`.
- **PostgreSQL + Prisma 7** (`prisma/schema.prisma`) — a relational model of
  pillars, goals, milestones, tasks, decisions, delegations, deals, meetings,
  people, companies, resources, metrics, time entries, Brain sources, signals,
  refreshes, insights, briefs, inbox items, day plans, activities, notes, reviews
  and Chief of Staff threads. Calendar days are stored as `DATE`; instants are
  rendered in the CEO's timezone.
- **CytoHub Brain** in `src/server/brain` — connectors, analyzers, scoring,
  priorities, attention, metrics, brief composition and the refresh pipeline.
- **Chief of Staff** in `src/server/chief` — Brain query tools shared by the
  Claude tool runner and the rules engine; streamed over NDJSON from
  `/api/chief-of-staff`.
- **UI** — Tailwind 4 and shadcn/ui, light and dark themes, keyboard-first.

```
prisma/                 schema, migrations, seed workspace
scripts/                CLI entry points (brain:refresh)
src/app/(app)/          pages (all dynamic, server-rendered)
src/app/api/            Brain refresh cron + Chief of Staff stream
src/components/         UI by area (today, tasks, goals, chief, shell, …)
src/server/brain/       CytoHub Brain
src/server/chief/       AI Chief of Staff
src/server/actions/     server actions (validated with zod)
src/server/queries/     read models per page
src/lib/                dates, formatting, domain vocab, db client
```
