# Putting the TMS on the Internet — Free Hosting + Free Domain

This guide takes the project from your Desktop to a public web address that
managers and clients can open from anywhere, using only free services.

**Total cost: ₹0.** No credit card is required for anything below.

---

## Read this first: what "connect to a domain" actually requires

A domain name is only the *label*. To make `https://something.example.com` open
your TMS, four separate things have to be true:

| Piece | What it does | Where it comes from |
|---|---|---|
| 1. A running server | Actually serves the pages | Render / Railway / Fly.io (free tier) |
| 2. A public IP address | Lets the internet find that server | Provided automatically by the host |
| 3. A DNS record | Points the domain at that IP | Your domain provider's control panel |
| 4. An HTTPS certificate | Makes the padlock appear | Issued automatically by the host |

**Your home PC cannot do piece 1.** Your home internet connection has a dynamic
IP, sits behind a router, and is usually blocked from accepting inbound
connections. So the app has to be deployed to a cloud host — which is what this
guide does.

**Also important:** every free host gives you a free web address automatically
(for example `https://select-mobility-tms.onrender.com`). That address already
works and is already HTTPS. You do **not** need to buy anything to be online.
A custom domain is purely cosmetic, and it is the *last* optional step below.

---

## Step 1 — Put the project on GitHub (required by all hosts)

Render, Railway and Fly.io all deploy by pulling from a Git repository.

1. Create a free account at <https://github.com> if you do not have one.
2. Install Git for Windows: <https://git-scm.com/download/win> (accept defaults).
3. Open **Git Bash** in the project folder and run:

```bash
cd "/c/Users/Chait/Desktop/SelectMobility_TMS"
git init
git add .
git commit -m "Select Mobility TMS - initial commit"
```

4. On GitHub click **New repository**.
   - Name: `select-mobility-tms`
   - Visibility: **Private** (recommended — this is company data software)
   - Do **not** tick "Add a README"
5. GitHub shows you a URL. Connect and push:

```bash
git remote add origin https://github.com/YOUR-USERNAME/select-mobility-tms.git
git branch -M main
git push -u origin main
```

When prompted for a password, paste a **Personal Access Token**, not your
GitHub password: `Settings → Developer settings → Personal access tokens →
Tokens (classic) → Generate new token`, tick the `repo` scope.

> **Before pushing, confirm `.gitignore` excludes `server/data/` and `.env`.**
> Your database file and secrets must never land in a repository.

---

## Step 2 — Choose a host and deploy

All three are free and all three run this project without changes. Pick one.

### Option A — Render (recommended: no credit card, most predictable)

1. Sign up at <https://render.com> using your GitHub account.
2. **New +** → **Blueprint**.
3. Pick the `select-mobility-tms` repository. Render finds `render.yaml`
   automatically and fills in the settings.
4. It will ask you to confirm the `sync: false` secrets. Set:
   - `ADMIN_EMAIL` — e.g. `admin@selectmobility.in`
   - `ADMIN_PASSWORD` — a strong password you will actually use
   - Leave the `BACKUP_S3_*` values blank for now (Step 4 covers them)
5. Click **Apply**. First build takes roughly 2–4 minutes.
6. Your site is live at `https://select-mobility-tms.onrender.com`.

**The one catch with Render's free tier:** the service **sleeps after 15 minutes
of inactivity**. The next visitor waits ~50 seconds while it wakes. That is
normal and unavoidable on the free plan. If 50 seconds is unacceptable for your
clients, the paid tier ($7/month) removes it.

### Option B — Railway

1. Sign up at <https://railway.app> with GitHub.
2. **New Project** → **Deploy from GitHub repo** → pick the repository.
3. Railway reads `railway.json` and starts the service.
4. Under **Variables**, add `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
5. Under **Settings → Networking**, click **Generate Domain**.

Railway gives a small monthly free credit rather than a permanently free tier,
so the service stops once the credit runs out.

### Option C — Fly.io

Fly gives a free allowance for small machines but **requires a credit card** at
signup. It does not sleep, which is its main advantage. The included `Dockerfile`
means you can deploy with:

```bash
fly launch --no-deploy
fly secrets set ADMIN_EMAIL=admin@selectmobility.in ADMIN_PASSWORD=YourStrongPassword
fly deploy
```

---

## Step 3 — Get to your site and sign in

Open the address your host gave you and sign in with the `ADMIN_EMAIL` and
`ADMIN_PASSWORD` you set. The first boot creates the database and loads demo
fleet data so you can see the system working immediately.

To start with an empty database instead, set `ADMIN_EMAIL` and
`ADMIN_PASSWORD`, deploy, then open a shell on the host and run `npm run reset`.

---

## Step 4 — Stop losing data (do not skip this)

**This is the most important step in this guide.**

Free hosts give you an *ephemeral* disk. Every time the service restarts,
redeploys, or wakes from sleep on a new machine, `server/data/tms.db` is wiped.
Your vehicles, trips and records would silently reset to the demo data.

The application has built-in S3-compatible off-box persistence to solve this.
Cloudflare R2's free tier is 10 GB with no egress charges — far more than a JSON
database will ever need.

1. Create a free Cloudflare account at <https://dash.cloudflare.com>.
2. Go to **R2** → **Create bucket**. Name it `select-mobility-tms`.
3. Still in R2, click **Manage R2 API Tokens** → **Create API token**.
   - Permissions: **Object Read & Write**
   - Scope it to just the `select-mobility-tms` bucket
4. Note the values it gives you:
   - **Access Key ID**
   - **Secret Access Key**
   - Your **account ID** (visible in the R2 dashboard URL)
5. In your host's dashboard, set these environment variables:

```
BACKUP_S3_ENDPOINT=https://<your-account-id>.r2.cloudflarestorage.com
BACKUP_S3_BUCKET=select-mobility-tms
BACKUP_S3_ACCESS_KEY_ID=<from step 4>
BACKUP_S3_SECRET_ACCESS_KEY=<from step 4>
BACKUP_S3_REGION=auto
BACKUP_S3_KEY=tms.db
```

6. Redeploy. The startup banner will now read:

```
Data persistence      : local file + remote mirror
```

**How it behaves:** every write mirrors to R2 in the background (debounced, so
normal page speed is unaffected). On boot, the app restores the latest copy
*before* reading the local file. The restore validates the JSON before
overwriting anything, so a corrupt remote copy can never destroy local data —
and if the bucket is unreachable the app still starts normally on the local file.

Backblaze B2 works identically if you prefer it (10 GB free); just change the
endpoint to `https://s3.<region>.backblazeb2.com` and set the matching region.

---

## Step 5 (optional) — A custom domain

**First, a warning about "free domains."**

Freenom — which used to hand out free `.tk`, `.ml`, `.ga` and `.cf` domains —
**stopped accepting new registrations and is no longer reliable**. The free TLDs
it managed have been withdrawn. Treat any site still advertising them as a
scam: you will usually lose the domain, or be asked to pay a "release fee" later.

Realistic ways to get an address that is not `*.onrender.com`:

| Option | Cost | What you get |
|---|---|---|
| Keep the host's free subdomain | ₹0 | `select-mobility-tms.onrender.com` — works today, HTTPS included |
| Free DNS subdomain services | ₹0 | `yourname.duckdns.org`, `yourname.eu.org` — real but unmemorable |
| A real domain from Cloudflare/Namecheap | ~₹700–900/year | `selectmobility.in` — professional, and the only option clients will respect |

For a company moving client-facing traffic, the ~₹700/year is worth it — but it
is genuinely optional, and nothing below is required to be online.

### If you do get a domain

1. Buy it (Cloudflare Registrar sells at wholesale cost with free privacy).
2. In the host's dashboard, add the custom domain:
   - **Render:** your service → **Settings → Custom Domains → Add**
   - **Railway:** **Settings → Networking → Custom Domain**
3. The host shows you a DNS record to create. Go to your domain provider's DNS
   panel and add it:

   | Type | Name | Value | TTL |
   |---|---|---|---|
   | `CNAME` | `tms` (or `@` for the root) | what the host gave you, e.g. `select-mobility-tms.onrender.com` | Auto |

4. Wait for propagation — usually 5–30 minutes, occasionally a few hours.
5. The host issues the HTTPS certificate automatically once DNS resolves.
   You do not need to buy or configure a certificate.

Result: `https://tms.selectmobility.in` opens your TMS.

---

## Running it on your own office PC instead

If the goal is only office access on the local network, skip all of the above.
Run `start-tms.bat`. Other machines on the same Wi-Fi reach it at
`http://<office-pc-ip>:4000`. The data lives permanently in
`server/data/tms.db` and nothing is ever wiped.

---

## Checklist

- [ ] Project pushed to a private GitHub repository
- [ ] Deployed on Render / Railway / Fly.io, build succeeded
- [ ] `ADMIN_EMAIL` and `ADMIN_PASSWORD` set as host secrets
- [ ] Signed in successfully at the public URL
- [ ] Cloudflare R2 bucket created and `BACKUP_S3_*` variables set
- [ ] Startup banner shows "local file + remote mirror"
- [ ] Tested: make a change, restart the service, confirm the change survived
- [ ] (Optional) Custom domain added and DNS record created

---

## Troubleshooting

**The page takes ~50 seconds to load the first time.**
Expected on Render's free tier — the service was asleep and is waking. Not a bug.

**"Application failed to respond" / 502 on first visit.**
The build may still be running, or the service is mid-wake. Wait 60 seconds and
reload. Check the host's build log for errors.

**Signed in, but my data reset to demo data after a redeploy.**
`BACKUP_S3_*` is not configured, so the ephemeral disk was wiped. Complete Step 4.

**Health check failing.**
The app must bind to `0.0.0.0`, not `127.0.0.1`. Confirm `HOST=0.0.0.0` is set.
`render.yaml` and `railway.json` already handle this.

**"Registration number already exists" when adding a vehicle.**
Working as intended — registration numbers are unique. Search for the existing
record instead of creating a duplicate.

**Forgot the admin password.**
Set a new `ADMIN_PASSWORD` on the host and run `npm run reset` from the host
shell. This re-creates the database and clears existing records, so export your
reports first if the data matters.
