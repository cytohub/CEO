# Connecting CytoHub's systems

This guide connects every system CytoHub Brain reads, in the order that gives
the Brain the most context on day one. Each section says where to click at the
vendor, what to put where, what the first sync imports, and how the
connection is secured. Allow about two hours in total; most of it is waiting
for vendor approvals.

| Order | System | What the Brain gets | How it connects |
| --- | --- | --- | --- |
| 1 | [Microsoft 365](#1-microsoft-365-outlook-calendar-teams-sharepoint) | Email, calendar, Teams chats, SharePoint and OneDrive documents | Sign-in app on the server |
| 2 | [HubSpot](#2-hubspot) | Deals, pipelines, companies, deal owners | Service key, pasted in the app |
| 3 | [QuickBooks Online](#3-quickbooks-online) | Revenue, expenses, net income, cash per books | Sign-in app on the server |
| 4 | [Brex](#4-brex) | Live cash, monthly burn, card spend, large payments | Read-only token, pasted in the app |
| 5 | [DocuSign](#5-docusign) | Agreements waiting on you, signed, declined, stalled | Sign-in app on the server |
| 6 | [Granola](#6-granola) and [Read AI](#7-read-ai) | Meeting notes → decisions, action items, commitments | API key / signed webhook, pasted in the app |
| 7 | [Pillars, goals and targets](#8-pillars-goals-and-targets) | What matters, and progress measured from live data | In the app |
| 8 | [First refresh](#9-the-first-refresh) | The first daily brief and Top 5 | In the app |

Every step happens on **ceo.cytolab.ai** (Settings → Integrations) or on the
server (`~/ceo/deploy/lightsail/.env`). Never send keys, tokens or secrets by
email or chat; paste them only into those two places.

## How connections are secured

- **Read-only.** Every connection asks for read access only. Two vendors have
  no read-only option: QuickBooks (accounting scope) and DocuSign (signature
  scope). For those, CytoHub's code only ever reads reports, balances and
  envelope status; it has no code path that writes to them.
- **Encrypted at rest.** OAuth tokens, pasted keys and webhook signing keys are
  encrypted with AES-256-GCM using `CYTOHUB_ENCRYPTION_KEY` before they reach
  the database. They are used only on the server and never appear in a
  browser, a URL or a log line. Settings shows only the last four characters
  of a key.
- **Checked before stored.** A pasted key is tested against the vendor first;
  a wrong key or a missing permission is rejected with what to fix.
- **Sign-in flows.** State and PKCE (where the vendor supports it) are sealed in
  a short-lived, httpOnly cookie, checked in constant time, and the callback
  must come back to the same signed-in user.
- **Signed webhooks.** Read AI deliveries must carry a valid HMAC-SHA256
  signature; Microsoft, Google and Dropbox notifications are verified the same
  way they always were. Anything unsigned or altered is rejected.
- **Who can connect.** Only the CEO and admins (the `integrations.manage`
  permission). Executives see the results, not the connections.
- **Audited.** Connecting, replacing a key, disconnecting and every failed
  attempt are in Settings → Audit log, without key material.
- **Revocable.** Disconnect in Settings → Integrations forgets the credentials
  (and revokes them at Intuit, Google and Dropbox). Revoking at the vendor
  also stops the connection; it then shows "Reconnect needed".

Keys and secrets to calendar:

| Secret | Expires | What to do |
| --- | --- | --- |
| Microsoft client secret | The date you chose (max 24 months) | Create a new secret before then and update `.env` |
| QuickBooks refresh token | 100 days without a sync (syncs run hourly) | Reconnect if a connection was paused that long |
| Brex user token | 90 days without use (syncs run hourly) | Replace the key in Settings |
| DocuSign refresh token | Renewed automatically with the `extended` scope | Reconnect if DocuSign asks |
| HubSpot service key, Granola key | Until revoked | Replace the key if you rotate it |

After editing `.env` on the server, apply it:

```sh
cd ~/ceo/deploy/lightsail && docker compose up -d
```

## 1. Microsoft 365 (Outlook, calendar, Teams, SharePoint)

CytoHub's mail runs on Microsoft 365, so this is the first and most important
connection. One app registration serves all five Microsoft sources.

1. Sign in to the [Microsoft Entra admin center](https://entra.microsoft.com)
   as a Global or Application administrator.
2. **App registrations → New registration**. Name: `CytoHub CEO`. Supported
   account types: **Accounts in this organizational directory only**.
   Redirect URI: platform **Web**,
   `https://ceo.cytolab.ai/api/integrations/microsoft/callback`.
3. **API permissions → Add a permission → Microsoft Graph → Delegated
   permissions**: `offline_access`, `User.Read`, `Mail.Read`,
   `Calendars.Read`, `Files.Read.All`, `Sites.Read.All`, `Chat.Read`. Then
   **Grant admin consent for CytoHub**. (Already registered the app earlier?
   Add `Chat.Read` and grant consent again.)
4. **Certificates & secrets → New client secret**, 24 months. Copy the
   **Value** right away and put a reminder in your calendar a week before it
   expires.
5. On the server, in `.env`: `MICROSOFT_CLIENT_ID` (Application (client) ID),
   `MICROSOFT_CLIENT_SECRET` (the secret value), `MICROSOFT_TENANT_ID`
   (Directory (tenant) ID). Apply with `docker compose up -d`.
6. On ceo.cytolab.ai, **Settings → Integrations**, connect in this order,
   signing in as rb@cytohub.com each time: **Outlook Mail**, **Outlook
   Calendar**, **Teams chats**, **SharePoint**, **OneDrive**.

The first sync reads the last 90 days of mail and Teams chats, and calendar
events from 90 days back to 180 days ahead. After that, mail and calendar
update within minutes (Graph push notifications), chats and files hourly.
Newsletters and notifications are stored but not analyzed unless you switch
them on per connection.

## 2. HubSpot

HubSpot's current credential for a single-company integration is a
**service key**.

1. In HubSpot, as a super admin: **Development → Keys → Service keys** (some
   accounts show it under **Settings → Integrations → Service keys**).
2. **Create service key**, name it `CytoHub CEO`, and add these scopes:
   `crm.objects.deals.read`, `crm.objects.companies.read`,
   `crm.objects.owners.read`. Create, then copy the key.
3. On ceo.cytolab.ai: **Settings → Integrations → CRM → Connect HubSpot**,
   paste the key, **Connect**.

What happens:

- Every deal is imported quietly on the first sync (no alerts for history):
  stage, amount, probability, close date, next step, company and owner.
- Pipelines are typed by name: anything mentioning investors, fundraising,
  seed or series counts as **fundraising**; partnerships and business
  development as **partnership**; everything else as **sales**.
- From then on, hourly: stage moves, won and lost deals and new deals become
  Brain signals, and deals without activity are flagged as stalled.
- The scoreboard's pipeline tiles (weighted sales pipeline, investor pipeline,
  round committed) are computed from these deals.

## 3. QuickBooks Online

1. Go to the [Intuit Developer portal](https://developer.intuit.com), sign in
   with the QuickBooks admin account and **Create an app → QuickBooks Online
   and Payments**. Scope: **Accounting** only.
2. **Keys & credentials**. Intuit gives development keys for its sandbox
   right away. Production keys need the short production checklist: app
   name, host domain `ceo.cytolab.ai`, launch and disconnect URL
   `https://ceo.cytolab.ai/settings/integrations`, a privacy policy URL and an
   end-user licence URL (CytoHub's own pages are fine), and the compliance
   questionnaire (internal use, one company).
3. Redirect URI (in both Development and Production settings):
   `https://ceo.cytolab.ai/api/integrations/intuit/callback`.
4. On the server, in `.env`: `QUICKBOOKS_CLIENT_ID`,
   `QUICKBOOKS_CLIENT_SECRET`, and `QUICKBOOKS_ENV=production` (or `sandbox`
   to try it on Intuit's sample company first). Apply with
   `docker compose up -d`.
5. On ceo.cytolab.ai: **Settings → Integrations → Finance → Connect
   QuickBooks Online**, sign in, and pick the CytoHub company.

What happens:

- The first sync reads 12 complete months of profit and loss and today's bank
  balances. Only complete months are recorded, so a half-finished month never
  looks like a drop.
- Scoreboard: revenue per month, trailing-12-month revenue, revenue run-rate
  (last complete month × 12), operating expenses and net income. Without
  Brex, QuickBooks also provides cash on hand and net burn (the 3-month
  average net loss), which drive runway; with Brex connected it reports its
  bank balance as "cash per books" instead.
- About ten days after a month ends, when the books are usually closed, the
  brief says how the month went. Figures keep updating if entries are
  posted later.

## 4. Brex

1. In Brex, as an account admin: **Settings → Developer → Create token**.
   Name it `CytoHub CEO` and give it read-only access to **cash accounts**,
   **cash transactions** and **card transactions**. Copy the token.
2. On ceo.cytolab.ai: **Settings → Integrations → Finance → Connect Brex**,
   paste the token, **Connect**.

What happens:

- **Cash on hand** comes from Brex, live, every hour. Brex is the source of
  truth for cash and burn once connected; QuickBooks then reports its bank
  balance separately as "cash per books" so you can see reconciliation gaps.
- **Net burn** per month is cash out minus cash in across the Brex cash
  accounts (cash basis), for the last six complete months and every month
  after. Transfers between CytoHub's own Brex accounts are left out. Runway =
  cash on hand ÷ the average net burn of the last three months, so one
  month with a large inflow doesn't blank it.
- **Card spend** per month, when the token can read card transactions.
- Single payments of $50,000 or more, in or out, appear in the brief.
- Brex disables tokens that go unused for 90 days; the hourly sync keeps this
  one active.

## 5. DocuSign

1. In DocuSign, as an admin: **Settings → Apps and Keys → Add App and
   Integration Key**. Name it `CytoHub CEO`.
2. Authentication: **Authorization Code Grant**; **Add Secret Key** and copy
   it. Redirect URI: `https://ceo.cytolab.ai/api/integrations/docusign/callback`.
3. DocuSign approves new integrations through a short **go-live review**.
   Create the key in a free DocuSign developer account first, set
   `DOCUSIGN_ENV=demo`, connect once and let it sync a few times (the review
   needs 20 successful API calls), then request go-live. Once approved, the
   same integration key works on CytoHub's production account: set
   `DOCUSIGN_ENV=production` and connect again.
4. On the server, in `.env`: `DOCUSIGN_CLIENT_ID` (the integration key),
   `DOCUSIGN_CLIENT_SECRET`, `DOCUSIGN_ENV`. Apply with
   `docker compose up -d`.
5. On ceo.cytolab.ai: **Settings → Integrations → Contracts → Connect
   DocuSign**, and sign in.

What happens:

- Agreements **waiting for your signature** go to your Inbox immediately,
  including ones already waiting when you connect.
- Agreements you sent that are unsigned after 7 days are flagged with who
  they are waiting on.
- Signed, declined and voided agreements appear in the brief.

## 6. Granola

The Granola API needs a **Business or Enterprise** plan.

1. In Granola: **Settings → Connectors → API keys → Create**. Copy the key.
2. On ceo.cytolab.ai: **Settings → Integrations → Meeting notes → Connect
   Granola**, paste the key, **Connect**.

The last 90 days of notes are imported first, then new and edited notes every
hour. Each note is attached to the matching meeting from your calendar and
read for decisions, action items, commitments, risks and follow-ups, each
linked back to the note. Your private notes are included for notes you
created, because the key is yours.

## 7. Read AI

Read AI sends each meeting report to CytoHub as soon as it is ready.

1. On ceo.cytolab.ai: **Settings → Integrations → Meeting notes → Connect
   Read AI**. Copy the webhook URL shown there
   (`https://ceo.cytolab.ai/api/webhooks/read-ai`).
2. In Read AI: **Integrations → Webhooks → Add webhook**. Paste the URL,
   choose the **Meeting end** trigger. A personal webhook covers your
   meetings; a workspace webhook (admins) covers everyone's, which is
   usually more than the CEO's Brain should read.
3. Copy the **signing key** Read AI shows for the webhook, paste it into the
   CytoHub dialog, and **Connect**. Webhooks created before March 2026 send no
   signature and are rejected; create a new one.
4. To test, open a recent report in Read AI and send it to the webhook
   manually; it appears under Meeting notes within a minute.

## 8. Pillars, goals and targets

Connections tell the Brain what is happening; pillars, goals and targets tell
it what matters.

1. **Settings → Strategic pillars**: the four to six themes everything ladders
   up to (for example revenue, fundraising, science, team).
2. **Goals**: add the company and quarterly goals, each under a pillar, with
   an owner and a target date.
3. **Scoreboard → a metric → Edit target**: set targets (for example revenue
   run-rate $6M by Dec 31, runway at least 24 months), and choose the goal the
   metric measures. That goal's progress then updates itself from QuickBooks,
   Brex or HubSpot every time the Brain refreshes.

## 9. The first refresh

On **Today**, run the morning refresh once everything is connected. It takes a
minute or two the first time. From then on the server runs it every morning
(10:30 UTC by default) and the setup checklist on Today disappears once every
step is done.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| "Not configured — set …" next to a provider | The sign-in app's values are missing from `.env`, or `docker compose up -d` wasn't run after adding them. |
| The vendor says the redirect URI doesn't match | Register exactly `https://ceo.cytolab.ai/api/integrations/<microsoft\|google\|dropbox\|intuit\|docusign>/callback`. |
| Teams chats: "Reconnect needed" mentioning Chat.Read | Add `Chat.Read` to the Entra app, grant admin consent, then reconnect Teams chats. |
| HubSpot: the key is rejected for missing scopes | Edit the service key in HubSpot, add the three read scopes, and paste it again. |
| QuickBooks: "the account couldn't be read" | Connect again and pick the CytoHub company on Intuit's screen. On a sandbox app, set `QUICKBOOKS_ENV=sandbox`. |
| DocuSign: sign-in fails on the production account | The integration key hasn't passed go-live review yet; use `DOCUSIGN_ENV=demo` until it has. |
| Brex: no card spend | The token needs card transactions access and an account admin's rights. Cash and burn still work. |
| Read AI reports don't arrive | The signing key in CytoHub must be the one shown for that exact webhook; replace it in Settings. Deliveries with a wrong signature are rejected. |
| A connection shows "Error" | It retries on its own with backoff; Settings → Integrations shows the last error. Health details: Brain → Ingestion health. |
