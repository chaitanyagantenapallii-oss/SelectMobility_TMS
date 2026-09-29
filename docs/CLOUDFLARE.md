# Cloudflare Setup for Select Mobility TMS

This project is a Node/Express application, so the best Cloudflare connection is:

1. Cloudflare D1 for persistent database storage.
2. Cloudflare DNS for the public domain.
3. Cloudflare Tunnel if you want to run the app from an office PC or private server.

The app is not a pure static site or Worker-native app because it writes to a local JSON database. Keep the Node server running on Render, Railway, Fly.io, Docker, or an office machine, then use Cloudflare around it.

## 1. Connect the database to Cloudflare D1

Create a D1 database in Cloudflare and create an API token with D1 edit access.
Set these variables on the Node host:

```env
CLOUDFLARE_ACCOUNT_ID=<cloudflare-account-id>
CLOUDFLARE_D1_DATABASE_ID=<d1-database-id>
CLOUDFLARE_API_TOKEN=<scoped-api-token>
```

The app creates a private `tms_state` table automatically and mirrors the
operational dataset there. D1 takes precedence over the older S3/R2 option.
After restart, the banner should show `local file + remote mirror`.

## 2. Optional R2 backup

Create a bucket:

- Cloudflare dashboard -> R2 -> Create bucket
- Bucket name: `select-mobility-tms`

Create credentials:

- R2 -> Manage R2 API Tokens -> Create API token
- Permission: Object Read & Write
- Scope: only the `select-mobility-tms` bucket

Set these variables in your `.env` file or hosting dashboard:

```env
BACKUP_S3_ENDPOINT=https://<cloudflare-account-id>.r2.cloudflarestorage.com
BACKUP_S3_BUCKET=select-mobility-tms
BACKUP_S3_ACCESS_KEY_ID=<r2-access-key-id>
BACKUP_S3_SECRET_ACCESS_KEY=<r2-secret-access-key>
BACKUP_S3_REGION=auto
BACKUP_S3_KEY=tms.db
```

Then verify the connection:

```bash
npm run cloudflare:check-r2
```

A successful check means the app can write, read, and delete a small test object in the R2 bucket.

## 3. Run the TMS with D1 Enabled

Start the app normally:

```bash
npm start
```

The startup banner should show:

```text
Data persistence      : local file + remote mirror
```

From that point, every data write is mirrored to R2 in the background. On restart, the app restores the latest R2 copy before loading the local database file.

## 3. Put a Domain on the App

If the app is already hosted on Render, Railway, Fly.io, or another public host:

- Add your domain to Cloudflare DNS.
- Create a CNAME such as `tms.selectmobility.in`.
- Point it to the host-provided domain.
- Keep the Cloudflare proxy enabled unless the host asks otherwise.

If the app runs on an office PC or private server, use Cloudflare Tunnel instead:

```bash
cloudflared tunnel login
cloudflared tunnel create select-mobility-tms
cloudflared tunnel route dns select-mobility-tms tms.selectmobility.in
cloudflared tunnel run --url http://localhost:4000 select-mobility-tms
```

Keep the TMS server running on the same machine:

```bash
npm start
```

## 4. Production Notes

- Change all demo passwords before putting real records in the system.
- Keep `.env` and `server/data/tms.db` out of Git.
- Use Cloudflare Access if this should be private to employees only.
- Keep the R2 bucket private; the app uses API credentials and does not need public bucket access.
