# Deploy the CEO Command Center on AWS Lightsail (ceo.cytolab.ai)

The same setup as cytolab.ai. One Lightsail server runs everything with Docker
Compose: the app, the ingestion worker, PostgreSQL, and
[Caddy](https://caddyserver.com), which serves HTTPS with free Let's Encrypt
certificates. Route 53 points `ceo.cytolab.ai` at the server, and cron runs the
morning refresh, nightly backups and weekly updates. Allow about 45 minutes.

```
visitor ──https──▶ Caddy (ports 80/443) ──▶ app (Next.js) ──▶ PostgreSQL
                     certificates            worker (syncs every 30 s) ──┘   private network only
cron 03:00 UTC ──▶ backup · 10:30 UTC ──▶ morning refresh · Sun 05:30 ──▶ security updates
```

**Use a separate server from cytolab.ai.** This app holds the CEO's mail,
calendar and documents, while cytolab.ai is a public demo anyone can sign in
to. On separate machines, a problem in one can't reach the other. Each stack's
Caddy also needs ports 80 and 443 to itself.

You need:

- the `cytolab.ai` hosted zone in Route 53 (already there for cytolab.ai)
- access to the `cytohub/CEO` repository on GitHub
- a terminal with `ssh`, or Lightsail's in-browser SSH

## 1. Create the server

1. Open the [Lightsail console](https://lightsail.aws.amazon.com) and choose
   **Create instance**.
2. **Region**: the one closest to the CEO.
3. **Platform**: Linux/Unix. **Blueprint**: OS Only → **Ubuntu 24.04 LTS**.
4. **Networking**: dual-stack (not IPv6-only).
5. **Plan**: **4 GB** memory. The app needs about 600 MB once running, but
   building it needs more than 2 GB: on a 2 GB server the build runs out of
   memory.
6. **Name**: `ceo`, then **Create instance**.
7. On the instance's **Snapshots** tab, turn on **automatic snapshots**. They
   back up the whole server; step 11's nightly backups live on the server
   itself.

## 2. Give it a fixed address

1. In Lightsail, open **Networking → Create static IP**.
2. Attach it to `ceo` and name it `ceo-ip`.
3. Note the address (for example `203.0.113.40`).

## 3. Open the firewall

Open the `ceo` instance, then **Networking**. Under **IPv4 Firewall**:

| Application | Port | Note |
| --- | --- | --- |
| SSH | 22 | Already there. Use **Restrict to IP address** to allow only your own address, and tick **Allow Lightsail browser SSH/RDP**. |
| HTTP | 80 | Add it. Let's Encrypt and the redirect to HTTPS use it. |
| HTTPS | 443 | Add it. |

Under **IPv6 Firewall**, delete the rules: this setup serves IPv4 only.

## 4. Point ceo.cytolab.ai at the server (Route 53)

1. Open **Route 53 → Hosted zones → cytolab.ai**.
2. **Create record**: name `ceo`, type **A**, value = the static IP, TTL **300**.
3. Don't add an AAAA (IPv6) record.

Check from your own computer; it can take a few minutes:

```sh
dig +short ceo.cytolab.ai   # the static IP
```

## 5. Prepare the server

Connect from the instance page (**Connect using SSH**), or with the key from
**Account → SSH keys**:

```sh
ssh -i LightsailDefaultKey-<region>.pem ubuntu@203.0.113.40
```

Install Docker and Git, and add swap as headroom for the weekly rebuild:

```sh
sudo apt update && sudo apt -y upgrade
sudo apt -y install docker.io docker-compose-v2 git
sudo usermod -aG docker ubuntu

sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Log out (`exit`) and connect again so the `docker` group applies. Then check:

```sh
docker compose version
```

## 6. Get the code

```sh
git clone https://github.com/cytohub/CEO.git ~/ceo
```

If the repository is private, give the server a read-only deploy key instead:

```sh
ssh-keygen -t ed25519 -N '' -f ~/.ssh/ceo_deploy
cat ~/.ssh/ceo_deploy.pub
```

1. Copy the printed line.
2. On GitHub, open **cytohub/CEO → Settings → Deploy keys → Add deploy key**.
3. Paste the line, name the key `lightsail`, and leave **Allow write access** off.

Then clone over SSH, and answer `yes` when asked to trust github.com:

```sh
printf 'Host github.com\n  IdentityFile ~/.ssh/ceo_deploy\n' >> ~/.ssh/config
git clone git@github.com:cytohub/CEO.git ~/ceo
```

## 7. Configure

```sh
cd ~/ceo/deploy/lightsail
(umask 077 && cp .env.example .env)   # readable only by you from the start
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" .env
sed -i "s/^APP_DB_PASSWORD=.*/APP_DB_PASSWORD=$(openssl rand -hex 24)/" .env
sed -i "s|^CYTOHUB_ENCRYPTION_KEY=.*|CYTOHUB_ENCRYPTION_KEY=$(openssl rand -base64 32)|" .env
sed -i "s/^CRON_SECRET=.*/CRON_SECRET=$(openssl rand -hex 32)/" .env
nano .env    # add ANTHROPIC_API_KEY if you have one; save with Ctrl+O, Enter, Ctrl+X
```

Copy the encryption key into your password manager now:

```sh
grep CYTOHUB_ENCRYPTION_KEY .env
```

It encrypts the OAuth tokens and stored documents. If it is lost, connected
accounts must be reconnected. The database passwords take effect when the
database is first created.

## 8. Start

```sh
docker compose up -d --build
```

The first build takes 5 to 10 minutes. Then watch the app start:

```sh
docker compose logs -f web
```

You should see these lines, then press Ctrl+C:

```
All migrations have been successfully applied.
✔ Migrations applied
✓ Ready in …
```

Caddy requests the certificate as soon as it starts:

```sh
docker compose logs caddy | grep -i 'certificate obtained'
```

## 9. Create your account

```sh
docker compose run --rm -T web npm run -s db:bootstrap -- --name "Your Name" --email rb@cytohub.com
```

It prints a **one-time password**, shown once. The worker logs "waiting for
the CEO account" until this step is done.

## 10. Sign in

1. Open https://ceo.cytolab.ai and sign in as `rb@cytohub.com` with the
   one-time password.
2. Choose your own password (at least 12 characters).
3. **Settings → Users & access**: add your team. Each person gets a one-time
   password and chooses their own at first sign-in.

## 11. Schedule the jobs

```sh
crontab ~/ceo/deploy/lightsail/ceo.cron
crontab -l
```

These then run on their own (times in UTC):

- **03:00 daily**: database backup to `~/ceo-backups`, keeping 14 days.
- **10:30 daily**: the morning Brain refresh (06:30 in New York). To change it,
  edit the hour in `ceo.cron` and install it again.
- **Sundays 05:30**: security updates. Fresh Caddy and PostgreSQL images are
  pulled and the app is rebuilt on the latest Node base image, with about
  10 seconds of downtime.

Email, calendar and document syncs don't need cron: the worker runs them
continuously, hourly or daily per connection. Job output goes to
`~/ceo-jobs.log`.

## 12. Connect CytoHub's systems

Follow [`docs/CONNECTORS.md`](../../docs/CONNECTORS.md): Microsoft 365
(Outlook, calendar, Teams, SharePoint), HubSpot, QuickBooks Online, Brex,
DocuSign, Granola and Read AI, in that order. Sign-in apps (Microsoft,
QuickBooks, DocuSign) go in `.env`; apply them with:

```sh
docker compose up -d
```

HubSpot, Brex, Granola and Read AI keys are pasted in **Settings →
Integrations** on the site, where every connection is made.

## Updating

```sh
cd ~/ceo && git pull && cd deploy/lightsail && docker compose up -d --build
```

Database migrations run automatically when the app starts.

## Restoring a backup

```sh
cd ~/ceo/deploy/lightsail
docker compose stop web worker
docker compose exec -T db pg_restore -U ceo -d ceo --clean --if-exists < ~/ceo-backups/ceo-YYYY-MM-DD.dump
docker compose start web worker
```

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| The browser can't reach the site, or shows a certificate error | `dig +short ceo.cytolab.ai` must return the static IP, and ports 80 and 443 must be open. Then `docker compose logs caddy`. |
| The build stops with `Killed` or "heap out of memory" | The server has less than 4 GB of memory. Resize the instance from a snapshot. |
| The worker logs "waiting for the CEO account" | Run step 9. |
| Integrations show "Not configured" | The provider's values are missing from `.env`, or you didn't run `docker compose up -d` after adding them. |
| OAuth fails with `redirect_uri_mismatch` | The redirect URI registered with the provider must be exactly `https://ceo.cytolab.ai/api/integrations/<microsoft\|google\|dropbox\|intuit\|docusign>/callback`. |
| Something else | `docker compose ps` shows each container's state; `docker compose logs web worker` shows the app's errors. |
