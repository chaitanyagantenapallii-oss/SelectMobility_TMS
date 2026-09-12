# Deployment Guide

Guidance for running Select Mobility TMS on a server rather than a desk PC.

---

## 1. Sizing

The application is a single Node.js process with a file-based data store. It
runs comfortably on modest hardware.

| Fleet size | Recommended |
|---|---|
| Up to 25 vehicles | 2 vCPU, 2 GB RAM, 10 GB disk |
| 25&ndash;100 vehicles | 4 vCPU, 4 GB RAM, 40 GB SSD |
| Above 100 vehicles | Migrate the data layer to SQL Server or PostgreSQL (see Section 9) |

No database server, container runtime or build toolchain is required.

---

## 2. Windows Server Deployment

### 2.1 Install Node.js

Download the LTS installer from [nodejs.org](https://nodejs.org) and install
it for all users. Verify:

```powershell
node --version     # must be 18 or newer
npm --version
```

### 2.2 Place the application

Copy the project folder to a stable location, for example `C:\Apps\SelectMobility_TMS`, then install dependencies:

```powershell
cd C:\Apps\SelectMobility_TMS
npm install --omit=dev
```

### 2.3 Configure

```powershell
Copy-Item .env.example .env
notepad .env
```

Set at minimum:

```
PORT=4000
HOST=127.0.0.1
ADMIN_EMAIL=transport.admin@selectmobility.in
ADMIN_PASSWORD=<a strong password>
SESSION_HOURS=12
```

> The seeded administrator password only applies to a fresh data file. If a
> data file already exists, change the password from the account menu in the
> application instead.

### 2.4 Run as a Windows service

Using [NSSM](https://nssm.cc) (simplest approach):

```powershell
nssm install SelectMobilityTMS "C:\Program Files\nodejs\node.exe" "C:\Apps\SelectMobility_TMS\server\src\index.js"
nssm set SelectMobilityTMS AppDirectory "C:\Apps\SelectMobility_TMS"
nssm set SelectMobilityTMS AppStdout "C:\Apps\SelectMobility_TMS\logs\service.log"
nssm set SelectMobilityTMS AppStderr "C:\Apps\SelectMobility_TMS\logs\service-error.log"
nssm set SelectMobilityTMS AppRotateFiles 1
nssm set SelectMobilityTMS Start SERVICE_AUTO_START
New-Item -ItemType Directory -Force C:\Apps\SelectMobility_TMS\logs
nssm start SelectMobilityTMS
```

Alternatively, use PM2:

```powershell
npm install -g pm2 pm2-windows-startup
cd C:\Apps\SelectMobility_TMS
pm2 start server/start.js --name select-mobility-tms
pm2 save
pm2-startup install
```

### 2.5 Allow LAN access

If operators are on other machines, first set `HOST=0.0.0.0` in `.env`, then
open the port:

```powershell
New-NetFirewallRule -DisplayName "Select Mobility TMS" -Direction Inbound `
  -Protocol TCP -LocalPort 4000 -Action Allow -Profile Domain,Private
```

Restrict the rule to your office subnet by adding
`-RemoteAddress 10.0.0.0/24` with your own network range.

---

## 3. Linux Deployment

### 3.1 Install Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 3.2 Install the application

```bash
sudo mkdir -p /opt/select-mobility-tms
sudo chown "$USER" /opt/select-mobility-tms
cp -r SelectMobility_TMS/. /opt/select-mobility-tms/
cd /opt/select-mobility-tms
npm install --omit=dev
cp .env.example .env
nano .env
```

### 3.3 systemd service

`/etc/systemd/system/select-mobility-tms.service`:

```ini
[Unit]
Description=Select Mobility Transport Management System
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/select-mobility-tms
EnvironmentFile=/opt/select-mobility-tms/.env
ExecStart=/usr/bin/node /opt/select-mobility-tms/server/start.js
Restart=on-failure
RestartSec=5
StandardOutput=append:/var/log/select-mobility-tms.log
StandardError=append:/var/log/select-mobility-tms.log

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/opt/select-mobility-tms/server/data /var/log

[Install]
WantedBy=multi-user.target
```

```bash
sudo chown -R www-data:www-data /opt/select-mobility-tms/server/data
sudo systemctl daemon-reload
sudo systemctl enable --now select-mobility-tms
sudo systemctl status select-mobility-tms
```

---

## 4. HTTPS Reverse Proxy

Never expose the application directly to the internet without TLS. The app
sets security headers but serves plain HTTP.

### nginx

```nginx
server {
    listen 443 ssl http2;
    server_name transport.selectmobility.in;

    ssl_certificate     /etc/ssl/certs/selectmobility.crt;
    ssl_certificate_key /etc/ssl/private/selectmobility.key;
    ssl_protocols TLSv1.2 TLSv1.3;

    client_max_body_size 5m;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}

server {
    listen 80;
    server_name transport.selectmobility.in;
    return 301 https://$host$request_uri;
}
```

### IIS (Windows)

1. Install the **URL Rewrite** and **ARR** (Application Request Routing) modules.
2. Enable the proxy: **IIS Manager &rarr; server node &rarr; Application Request
   Routing Cache &rarr; Server Proxy Settings &rarr; Enable proxy**.
3. Add a site bound to `transport.selectmobility.in` on 443 with your
   certificate, pointing at the application folder.
4. Add a URL Rewrite rule to the site's `web.config`:

```xml
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="ReverseProxyToTMS" stopProcessing="true">
          <match url="(.*)" />
          <action type="Rewrite" url="http://127.0.0.1:4000/{R:1}" />
        </rule>
      </rules>
    </rewrite>
  </configuration>
</system.webServer>
```

With a proxy in front, set `HOST=127.0.0.1` so the Node process is not
directly reachable.

---

## 5. Backup and Recovery

Everything lives in one file: `server/data/tms.db`.

### Manual backup

```bash
# Linux
tar -czf "/backups/tms-$(date +%F).tar.gz" -C /opt/select-mobility-tms server/data
```

```powershell
# Windows
$stamp = Get-Date -Format "yyyy-MM-dd"
Compress-Archive -Path "C:\Apps\SelectMobility_TMS\server\data" `
  -DestinationPath "D:\Backups\tms-$stamp.zip" -Force
```

### Scheduled backup (Linux cron, 22:00 daily)

```cron
0 22 * * * tar -czf /backups/tms-$(date +\%F).tar.gz -C /opt/select-mobility-tms server/data
0 23 * * 0 find /backups -name 'tms-*.tar.gz' -mtime +60 -delete
```

### Scheduled backup (Windows Task Scheduler)

```powershell
$action  = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument '-NoProfile -Command "Compress-Archive -Path C:\Apps\SelectMobility_TMS\server\data -DestinationPath D:\Backups\tms-$(Get-Date -Format yyyy-MM-dd).zip -Force"'
$trigger = New-ScheduledTaskTrigger -Daily -At 10:00PM
Register-ScheduledTask -TaskName "SelectMobilityTMS-Backup" -Action $action -Trigger $trigger -RunLevel Highest
```

### Restore

```bash
sudo systemctl stop select-mobility-tms
cp /backups/tms-2026-09-13.tar.gz /tmp/ && tar -xzf /tmp/tms-2026-09-13.tar.gz -C /opt/select-mobility-tms
sudo chown -R www-data:www-data /opt/select-mobility-tms/server/data
sudo systemctl start select-mobility-tms
```

Writes are atomic (temp file plus rename), so a copy taken at any moment is
consistent. If the data file is ever unreadable, the application preserves it
with a `.corrupt-<timestamp>` suffix and starts from an empty state rather than
silently discarding anything.

### Verify a backup

```bash
node -e "const d=require('/opt/select-mobility-tms/server/data/tms.db'); \
console.log('vehicles', d.vehicles.length, 'trips', d.trips.length, 'users', d.users.length)"
```

---

## 6. Upgrades

1. Back up `server/data/tms.db`.
2. Stop the service.
3. Replace the source files &mdash; **but keep `server/data/` and `.env`**.
4. Run `npm install --omit=dev` if dependencies changed.
5. Start the service and check `/api/health`.

New collections are created automatically on startup, so schema additions are
forward-compatible without a migration step.

---

## 7. Monitoring

**Health endpoint** &mdash; use for uptime checks:

```bash
curl -fsS http://127.0.0.1:4000/api/health | jq -e '.status == "ok"'
```

Returns HTTP 200 with record counts when healthy.

**Logs** &mdash; every API request is logged as
`<timestamp> <METHOD> <url> -> <status> (<ms>)`. Watch for:

- Repeated 401s &mdash; an integration using an expired token, or a
  brute-force attempt against `/auth/login`.
- Repeated 500s &mdash; check the stack trace written to stderr.
- Unusually slow requests &mdash; usually a report over a very wide date range.

**Disk** &mdash; the data file grows with trip volume. A 100-vehicle fleet
generating 300 trips a day produces roughly 60&ndash;80 MB per year. Set an
alert at 80% capacity.

---

## 8. Security Hardening Checklist

- [ ] Changed both seeded passwords
- [ ] `.env` readable only by the service account
- [ ] `HOST=127.0.0.1` when a reverse proxy is in use
- [ ] HTTPS terminating at the proxy with a valid certificate
- [ ] Firewall limited to the office subnet or VPN range
- [ ] Individual accounts for every operator; no shared logins
- [ ] Viewer role used for anyone who only needs to read and export
- [ ] Automated daily backup to a separate disk or off-site location
- [ ] Restore procedure tested at least once
- [ ] Audit log reviewed monthly
- [ ] Node.js kept on a supported LTS release
- [ ] `.env` and `server/data/` excluded from any source control

---

## 9. Scaling Beyond the File Store

The only component that needs replacing to move onto a real database is
`server/src/db/store.js`. It exposes a small interface used by every route
module:

```
collection(name)      all(name)          find(name, predicate)
filter(name, predicate)   insert(name, record)   insertMany(name, records)
update(name, id, patch)   remove(name, id)       nextId(name, prefix)
save()
```

To migrate to SQL Server or PostgreSQL, reimplement that interface with your
driver of choice, keeping the method signatures and return shapes identical.
The route modules read records as plain objects with `id`, `createdAt` and
`updatedAt` fields, so a thin mapping layer between rows and objects is
sufficient. Nothing in `server/src/routes/` or `client/` needs to change.

When you do migrate, consider adding indexes on `trips.date`,
`trips.vehicleId`, `bookings.tripId` and `attendance.date` &mdash; these carry
the heaviest read load.

---

## 10. Pre-Go-Live Checklist

- [ ] Node.js 18+ installed and `npm install` completed
- [ ] `.env` configured with production values
- [ ] Demo data replaced with real fleet, driver, employee and route records
- [ ] Compliance expiry dates entered for every vehicle
- [ ] Shift timings confirmed against the actual plant schedule
- [ ] Operator accounts created with appropriate roles
- [ ] Seeded passwords changed
- [ ] HTTPS and firewall configured
- [ ] Backup job scheduled and a restore tested
- [ ] Staff briefed using `docs/USER_GUIDE.md`
- [ ] Health check added to your monitoring system
- [ ] `node tools/smoke-test.js` passes against the live instance

---

## 11. Quick Reference

| Task | Command |
|---|---|
| Start (foreground) | `npm start` |
| Start (development) | `npm run dev` |
| Reset demo data | `npm run reset` |
| API test suite | `node tools/smoke-test.js` |
| Frontend test suite | `node tools/verify-frontend.js` |
| Health check | `curl http://127.0.0.1:4000/api/health` |
| Windows service | `nssm start SelectMobilityTMS` |
| Linux service | `sudo systemctl restart select-mobility-tms` |
| Service log (Linux) | `journalctl -u select-mobility-tms -f` |
