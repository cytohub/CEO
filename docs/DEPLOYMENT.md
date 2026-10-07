# Deploying to ceo.cytolab.ai

The recommended setup is **Vercel** (the app, crons and HTTPS) plus a managed
**PostgreSQL** database (Neon, Supabase, RDS or Cloud SQL). The repository is
already configured for it: `vercel.json` schedules the jobs, and every route
sets its own time limit. Allow about an hour, most of it waiting on DNS and
setting up the Google / Microsoft apps.

```
Browser ──HTTPS──▶ ceo.cytolab.ai (Vercel) ──▶ PostgreSQL
                      ▲   crons: morning refresh (daily), sync tick (hourly)
                      └── webhooks from Gmail / Graph / Dropbox
```

## What you need

| | |
| --- | --- |
| **Vercel Pro** | Hobby is for personal, non-commercial projects, and it only allows daily crons — the hourly sync in `vercel.json` makes a Hobby deployment fail. |
| **PostgreSQL 14+** | Any managed provider. Put it in the same region as your Vercel functions (default: Washington, D.C. — AWS `us-east-1`). |
| **DNS access for cytolab.ai** | To add one CNAME record. |
| **Admin access to Google Workspace and/or Microsoft 365** | Only to connect real mailboxes, calendars and drives (step 7). |
| **Your machine** | Node.js ≥ 20.9 and a clone of this repository, for the one-time setup command. |

## 1. Create the database

Create a PostgreSQL database and copy its **direct** connection string (Neon
calls it "unpooled"), for example:

```
postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require
```

Use the direct string for `DATABASE_URL` everywhere below. The app holds only a
few connections, and migrations need a direct connection.

Turn on your provider's backups / point-in-time restore.

## 2. Generate the secrets

```bash
openssl rand -base64 32   # → CYTOHUB_ENCRYPTION_KEY
openssl rand -hex 32      # → CRON_SECRET
```

Store `CYTOHUB_ENCRYPTION_KEY` in your password manager. It encrypts OAuth tokens
and stored documents. **If it is lost, connected accounts must be reconnected
and stored documents re-synced.** To rotate it later, set the new key and move
the old one to `CYTOHUB_ENCRYPTION_KEY_PREVIOUS`.

## 3. Create the Vercel project

1. In Vercel: **Add New → Project → Import** the `cytohub/ceo` GitHub repository.
2. Framework: **Next.js** (detected). Root directory: the repository root.
3. **Build command**: `npm run db:migrate && npm run build`.
   Every deploy then applies new database migrations before building.
4. **Environment variables**. Add them for the **Production** environment:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | the direct connection string from step 1 |
   | `CYTOHUB_ENCRYPTION_KEY` | from step 2 |
   | `CRON_SECRET` | from step 2. Vercel sends it to the cron routes automatically. |
   | `APP_ORIGIN` | `https://ceo.cytolab.ai` |
   | `NEXT_PUBLIC_UPLOAD_MAX_MB` | `4`. Vercel functions accept request bodies up to 4.5 MB. |
   | `ANTHROPIC_API_KEY` | optional: Claude extraction, Chief of Staff and brief narratives. Without it the rules engine runs. |

   Provider credentials (`GOOGLE_*`, `MICROSOFT_*`, `DROPBOX_*`) are added in step 7.
   Don't set `SEED_PASSWORD`; production never loads the demo data.
5. **Deploy**. When it finishes, open `https://<project>.vercel.app/login`. You
   should see the sign-in page.

Preview deployments (other branches) don't get these variables, so they can't
reach the database. Leave it that way, or give them a separate database.

## 4. Create the CEO account

From your clone, against the production database:

```bash
npm install
DATABASE_URL="postgresql://…direct production string…" \
  npm run db:bootstrap -- --name "Your Name" --email rb@cytohub.com --timezone America/New_York
```

This creates the source catalog and the CEO account, then prints a **one-time
password** (shown once). It loads no demo data. It is safe to run again: it
won't create a second CEO.

## 5. Point ceo.cytolab.ai at Vercel

1. Vercel project → **Settings → Domains → Add** `ceo.cytolab.ai`.
2. Vercel shows a **CNAME** record with a value unique to your project (like
   `d1d4fc829fe7bc7c.vercel-dns-017.com`). Add exactly that record at the DNS
   provider for cytolab.ai: name `ceo`, type `CNAME`.
3. Wait until Vercel shows the domain as valid. It then issues the HTTPS
   certificate automatically.

## 6. First sign-in

1. Open https://ceo.cytolab.ai and sign in as `rb@cytohub.com` with the one-time password.
2. Choose your own password (at least 12 characters).
3. **Settings → Users & access**: add your team. Each person gets a one-time
   password and chooses their own at first sign-in. Roles:
   CEO · Executive · Team member · Advisor · Admin.
4. **Settings**: add strategic pillars, then goals on the Goals page.

## 7. Connect email, calendar and documents

Create an OAuth app per provider, add its credentials to Vercel
(**Settings → Environment Variables**, Production), and **redeploy**. Then
connect accounts from **Settings → Integrations** on ceo.cytolab.ai.

### Google: Gmail, Google Calendar, Google Drive

1. Google Cloud console → create a project → enable the **Gmail API**,
   **Google Calendar API** and **Google Drive API**.
2. **OAuth consent screen**: add `cytolab.ai` under **Authorized domains**, and
   choose user type **Internal** if CytoHub uses Google Workspace. Gmail read
   access is a restricted scope: an *External* app would need Google's
   verification and a security assessment, and its tokens expire after 7 days
   while it stays in testing mode.
3. **Credentials → Create OAuth client ID → Web application**. Authorized
   redirect URI: `https://ceo.cytolab.ai/api/integrations/google/callback`.
4. Vercel: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
5. Optional, for instant Gmail updates instead of hourly: create a Pub/Sub topic.
   Grant `gmail-api-push@system.gserviceaccount.com` the **Pub/Sub Publisher**
   role on it. Add a push subscription to
   `https://ceo.cytolab.ai/api/webhooks/google?token=<random string>`.
   Set `GOOGLE_PUBSUB_TOPIC` (full topic name) and
   `GOOGLE_PUBSUB_VERIFICATION_TOKEN` (the same random string).

Calendar and Drive push notifications need no extra setup.

### Microsoft 365: Outlook Mail, Outlook Calendar, OneDrive, SharePoint

1. Microsoft Entra admin center → **App registrations → New registration**:
   single tenant. Redirect URI, platform **Web**:
   `https://ceo.cytolab.ai/api/integrations/microsoft/callback`.
2. **API permissions → Microsoft Graph → Delegated**: `offline_access`,
   `User.Read`, `Mail.Read`, `Calendars.Read`, `Files.Read.All`,
   `Sites.Read.All`. Then **Grant admin consent**.
3. **Certificates & secrets → New client secret**. Note its expiry date and set
   a reminder: connections stop syncing when it expires.
4. Vercel: `MICROSOFT_CLIENT_ID` (Application ID), `MICROSOFT_CLIENT_SECRET`,
   `MICROSOFT_TENANT_ID` (Directory ID).

Graph change notifications use `APP_ORIGIN` automatically.

### Dropbox

1. Dropbox App Console → **Create app** → Scoped access. Permissions:
   `files.metadata.read`, `files.content.read`, `account_info.read`.
2. Redirect URI: `https://ceo.cytolab.ai/api/integrations/dropbox/callback`.
   Webhook URI: `https://ceo.cytolab.ai/api/webhooks/dropbox`.
3. Vercel: `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`.

## 8. Check it's working

- Vercel → **Settings → Cron Jobs** lists `/api/brain/refresh` (daily, 10:30 UTC
  = 06:30 New York) and `/api/ingestion/tick` (hourly). Adjust the refresh time
  in `vercel.json` if the CEO's morning is elsewhere.
- On Today, **Refresh Brain** runs the morning refresh on demand.
- **Ingestion Health** (`/brain/ingestion`) shows the last sync per source,
  pending and failed jobs (with a retry button) and the review backlog.
- **Settings → Audit log** records every sign-in, connection and permission change.

## Updating

Push to the production branch, and Vercel builds and deploys it. The build
command applies new migrations first. To roll back, use **Instant Rollback** in
Vercel. Migrations in this repository only add tables and columns, so the
previous version keeps working against the newer schema.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Deployment fails: "Hobby accounts are limited to daily cron jobs" | The hourly sync needs Pro. On Hobby, remove the `/api/ingestion/tick` entry from `vercel.json` and call it hourly from another scheduler, with header `Authorization: Bearer $CRON_SECRET`. |
| Every page errors: "CYTOHUB_ENCRYPTION_KEY is required in production" | Add the variable, then redeploy. |
| "No CEO user found" | Run step 4 against the production database. |
| Integrations show "Not configured" | The provider's variables are missing from Production, or you haven't redeployed since adding them. |
| OAuth fails with `redirect_uri_mismatch` | The redirect URI in the provider must match exactly, including `https://` and no trailing slash. |
| Uploads over 4 MB are refused | Vercel's 4.5 MB request limit. Larger files can be synced from Drive, OneDrive or Dropbox (up to 25 MB each). |
| Too many database connections | Point `DATABASE_URL` at your provider's pooled connection string at runtime. Keep the direct one for migrations and `db:bootstrap`. |

## Alternative: your own server

Any Linux VM with Node.js ≥ 20.9 and PostgreSQL works, without Vercel's
plan or upload limits:

```bash
npm ci && npm run db:migrate && npm run build
npm run db:bootstrap -- --name "Your Name" --email rb@cytohub.com
npm start                 # the app on :3000   (run under systemd or pm2)
npm run ingest:worker     # syncs and pipeline jobs, every 30 s (also under systemd)
```

- Set the same environment variables in `.env`. Leave `NEXT_PUBLIC_UPLOAD_MAX_MB`
  unset (25 MB).
- Daily refresh via cron:
  `30 10 * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://ceo.cytolab.ai/api/brain/refresh`
- HTTPS with Caddy (certificate is automatic):
  `ceo.cytolab.ai { reverse_proxy localhost:3000 }`.
  Point an **A** record for `ceo` at the server's IP.
