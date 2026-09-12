# Select Mobility TMS

**Employee Transportation Management System**
Select Mobility India Private Limited &mdash; Staff Shuttle Operations

A complete, self-hosted transport management system for running an employee
transportation fleet: vehicles, drivers, routes, shift rosters, passenger
manifests, digital boarding, maintenance, fuel, statutory compliance and cost
analytics &mdash; with role-based access control and CSV reporting.

---

## 1. Highlights

| Area | What you get |
|---|---|
| **Operations dashboard** | 8 live KPIs, today's operations board, 14-day trip and distance trends, route load factors, fleet status mix, compliance and incident feeds |
| **Trip management** | Log runs, edit, close out with final readings, cancel with reason, paginated register with search and filters |
| **Manifests & boarding** | Stop-sequenced passenger lists, digital boarding with no-show tracking, seat availability, printable driver manifest |
| **Routes & shifts** | Route corridors with ordered stop sequences, route rosters grouped by stop, pickup/drop windows per shift |
| **Fleet & people** | Vehicles (owned + contracted), drivers with licence expiry alerts and performance scorecards, employee transport register |
| **Cost control** | Maintenance and workshop register, fuel/CNG/EV charging log, monthly expense ledger with category breakdown |
| **Compliance** | Insurance, permit, PUC, fitness, road tax and contract register with an expiry radar (15/30/45/90/180-day windows) |
| **Incidents** | Breakdown, accident, delay and complaint log with severity, escalation and resolution workflow |
| **Reports** | 11 built-in reports, previewable on screen and downloadable as CSV for Excel |
| **Security** | scrypt password hashing, HMAC session tokens, three roles (admin / operations / viewer), audit trail of every write |

---

## 2. Quick Start

### Prerequisites

- **Node.js 18 or newer** (tested on Node 22 and 24)
- Any modern browser (Chrome, Edge, Firefox)
- Windows, macOS or Linux

No database server is required &mdash; the application stores data in a single
JSON file, so it runs on a plain office PC.

### Install and run

```bash
cd SelectMobility_TMS
npm install
npm start
```

Then open **http://localhost:4000**

On first launch the application creates its data file and loads a demo fleet
(8 vehicles, 8 drivers, 30 employees, 5 routes, 70 trips and full history) so
every screen has meaningful content immediately.

### Demo sign-in

| Role | Email | Password |
|---|---|---|
| Administrator | `admin@selectmobility.in` | `Select@2026` |
| Operations | `ops@selectmobility.in` | `Ops@2026` |

> Change these credentials before putting the system into real use. See
> [Section 8](#8-security-and-operations).

---

## 3. Available Commands

| Command | Purpose |
|---|---|
| `npm start` | Start the server on port 4000 |
| `npm run dev` | Start with automatic restart on file changes |
| `npm run seed` | Populate demo data (only if the database is empty) |
| `npm run reset` | **Wipe and re-seed** the database with fresh demo data |
| `node tools/smoke-test.js` | Run 56 end-to-end API checks against a running server |
| `node tools/verify-frontend.js` | Run 37 frontend asset and wiring checks |

Both test tools expect the server to already be running and default to port
4000. Override with `TEST_PORT=4100 node tools/smoke-test.js`.

---

## 4. Project Structure

```
SelectMobility_TMS/
├── package.json                 Project manifest and scripts
├── .env.example                 Configuration template
├── README.md                    This file
│
├── server/                      Backend (Node.js + Express)
│   ├── data/
│   │   └── tms.db               JSON data store (created on first run)
│   └── src/
│       ├── index.js             HTTP server, routing table, startup
│       ├── config.js            Environment configuration loader
│       ├── db/
│       │   ├── store.js         Atomic JSON store with serialised writes
│       │   ├── schema.js        Data model + demo dataset generator
│       │   └── seed.js          Command line seeder
│       ├── middleware/
│       │   ├── auth.js          Token auth, role gates, audit trail
│       │   └── common.js        Security headers, logging, error handling
│       ├── routes/              One module per resource
│       │   ├── resource.js      Generic REST factory + validators
│       │   ├── auth.js          Login, session, password change
│       │   ├── dashboard.js     KPI aggregation endpoints
│       │   ├── reports.js       Reporting engine + CSV export
│       │   ├── trips.js         Trips, manifests, attendance
│       │   ├── vehicles.js      Fleet register
│       │   ├── drivers.js       Driver roster and scorecards
│       │   ├── employees.js     Employee transport register
│       │   ├── routes.js        Routes, stops, rosters
│       │   ├── users.js         Account management + audit log
│       │   └── ...              shifts, maintenance, fuel, documents,
│       │                        incidents, vendors, expenses
│       └── utils/
│           ├── password.js      scrypt hashing + HMAC tokens
│           └── helpers.js       Shared validation and formatting
│
├── client/                      Frontend (vanilla HTML/CSS/JS)
│   ├── index.html               Entry redirect
│   ├── login.html               Sign-in screen
│   ├── dashboard.html           Application shell
│   ├── css/app.css              Full application stylesheet
│   └── js/
│       ├── api.js               API client, formatters, charts, tables
│       ├── app.js               Navigation and hash router
│       └── pages/
│           ├── dashboard.js     Operations dashboard
│           ├── trips.js         Trip register
│           ├── manifests.js     Manifests and boarding
│           ├── routes.js        Routes and shifts
│           ├── vehicles.js      Vehicles and drivers
│           ├── employees.js     Employee register
│           ├── resources.js     Vendors, maintenance, fuel, expenses,
│           │                    documents, incidents
│           └── reports.js       Report browser and user administration
│
├── tools/
│   ├── smoke-test.js            End-to-end API test suite + contract guard
│   ├── verify-frontend.js       Frontend asset verification
│   ├── browser-debug.js         Loads each page in a DOM, reports script errors
│   └── ui-test.js               Renders every page, asserts real DOM output
│
├── render.yaml                  Render Blueprint (free tier)
├── railway.toml                 Railway configuration
├── railway.json                 Railway configuration (JSON form)
├── Dockerfile                   For Fly.io, Koyeb or any container host
│
└── docs/
    ├── API.md                   Full REST API reference
    ├── USER_GUIDE.md            Daily operating procedures
    ├── DEPLOYMENT.md            Production hosting and backup guidance
    └── DEPLOYMENT-FREE-HOST.md  Free hosting + free domain, step by step
```

> The host configuration files sit at the repository root because Render and
> Railway only auto-detect them from there.

---

## 5. Application Modules

### Dashboard
Fleet availability, trips today, employee boarding rate, open incidents,
vehicles in workshop, driver availability, month fuel spend and month-to-date
cost. Includes a 14-day trip volume chart, distance trend, route load factors,
fleet status donut, compliance alerts and upcoming workshop jobs.

### Trip Logs
The core operational record. Each trip links a date, shift, route, vehicle and
driver, and carries planned versus actual distance, fuel and toll cost,
passenger counts, occupancy and status (`scheduled`, `in-progress`,
`completed`, `cancelled`). Filter by status, route or date; export to CSV.

### Manifests & Boarding
Opens a run's passenger list ordered by the route's stop sequence. Employees
are ticked as they board; saving records attendance, updates booking status and
recalculates the trip's boarded count. No-shows are tracked per employee and
roll up into attendance rates across the system.

### Routes & Stops
Route corridors with an ordered stop list, one-way distance and assigned shift.
The roster view groups employees by boarding stop. Employees are auto-matched
to their boarding stop when added.

### Shift Timings
Pickup and drop windows per shift (general, afternoon, night). Each shift lists
the routes and headcount running on it.

### Fleet Vehicles
Registration, model, type, seat capacity, fuel type, ownership (owned or
contracted), vendor, odometer and status. Each vehicle shows its assigned
driver, running totals and a statutory compliance panel. Contracted vehicles
are attributed to their vendor for cost roll-up.

### Drivers
Licence number and expiry (with automatic expiring/expired flags), badge,
experience, vendor and assigned vehicle. The scorecard shows trips, distance
driven and on-time performance.

### Employees
Staff availing transport, with code, department, phone, route, shift and
boarding stop. Displays attendance rate, boarded count and no-show count, and
a 30-day boarding history per employee.

### Vendors
Contracted transport suppliers with contact, GSTIN, contract validity, rating,
linked vehicles and drivers, trips serviced and amount billed.

### Maintenance
Workshop jobs by vehicle and type (scheduled service, repair, tyre, breakdown,
inspection, bodywork) with workshop, cost and odometer reading. Overdue jobs
are flagged automatically.

### Fuel & Energy
Diesel, CNG, petrol and electric charging transactions with quantity, rate,
computed amount, odometer, station and payment mode (fuel card, cash, credit,
vendor). Aggregates volume, spend and average rate.

### Operating Expenses
Monthly cost ledger across driver salary, vendor hire, fuel, maintenance, toll,
insurance and miscellaneous. Includes a stacked monthly chart, category donut
and an approval workflow.

### Compliance Documents
Insurance, permit, PUC, fitness, road tax and vendor contracts per vehicle.
The compliance radar highlights everything expired or expiring inside a
selectable window, colour-graded as expired, critical (within 15 days) or
warning.

### Incidents & Safety
Breakdowns, accidents, delays, complaints and safety issues with severity
(low/medium/high/critical), the affected vehicle and route, action taken and a
resolution workflow that stamps the resolving user.

### Reports & Exports
Eleven reports, each previewable on screen with column totals and downloadable
as CSV:

1. Management Summary &mdash; 22 consolidated KPIs for the period
2. Daily Trip Register
3. Employee Attendance Register
4. Vehicle Cost & Efficiency (with km/l and cost per km)
5. Maintenance & Repair Log
6. Fuel Consumption Register
7. Driver Performance Scorecard
8. Route Performance Summary
9. Statutory Compliance Register
10. Operating Cost Ledger
11. Incident & Safety Register

### Users & Audit
Administrator-only account management (admin / operations / viewer), a role
permission matrix, and an audit trail recording every create, update and delete
with actor, action, detail and timestamp.

---

## 6. Roles and Permissions

| Role | View | Create / edit records | Manage trips & boarding | Manage users |
|---|---|---|---|---|
| **admin** | Yes | Yes | Yes | Yes |
| **operations** | Yes | Yes | Yes | No |
| **viewer** | Yes | No | No | No |

Attempting a restricted action returns HTTP 403 with a clear message; the
interface hides controls the signed-in role cannot use.

---

## 7. Configuration

Copy `.env.example` to `.env` and adjust as needed:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address (`127.0.0.1` for local-only access) |
| `DATABASE_FILE` | `server/data/tms.db` | Data file location, relative to the project root |
| `ADMIN_EMAIL` | `admin@selectmobility.in` | Seeded administrator email |
| `ADMIN_PASSWORD` | `Select@2026` | Seeded administrator password |
| `SESSION_HOURS` | `12` | Session token lifetime |
| `COMPANY_NAME` | Select Mobility India Private Limited | Shown in the UI and on reports |
| `COMPANY_CITY` | Pune, Maharashtra, India | Company location |

Configuration is read at startup. Changing `ADMIN_PASSWORD` only affects a
freshly seeded database &mdash; for an existing install, change the password
from the account menu in the top bar.

---

## 8. Security and Operations

**Built in**

- Passwords hashed with scrypt (64-byte derived key, per-user random salt)
- Constant-time password comparison to avoid timing leaks
- HMAC-SHA256 signed session tokens with expiry
- Role-based authorisation on every write endpoint
- Security headers on every response
- Atomic data writes (temp file plus rename) so a power loss cannot corrupt records
- Corrupt data files are preserved with a timestamped backup rather than discarded
- Audit trail of every mutation

**Before production use**

1. Change the administrator and operations passwords.
2. Set `HOST=127.0.0.1` if the system should only be reachable from the server itself.
3. Put the application behind a reverse proxy (IIS, nginx) with HTTPS.
4. Schedule a nightly copy of `server/data/tms.db` to a separate drive.
5. Create individual operator accounts rather than sharing a login, so the audit trail is meaningful.

See `docs/DEPLOYMENT.md` for Windows service setup, reverse proxy configuration
and backup automation.

**Putting it on the public internet (free)**

`docs/DEPLOYMENT-FREE-HOST.md` is a complete walkthrough for hosting this system
at a public address at zero cost: pushing to GitHub, deploying to Render or
Railway, obtaining the free `*.onrender.com` subdomain, and optionally attaching
a custom domain.

Host configuration ships ready to use:

| File | Purpose |
|---|---|
| `render.yaml` | Render Blueprint — provisions the service, health check and env vars |
| `railway.toml` / `railway.json` | Railway build, start command and health check |
| `Dockerfile` | Container image for Fly.io, Koyeb or any Docker host |
| `.env.example` | Every supported environment variable, with notes |

> **Data loss warning.** Free cloud hosts use an ephemeral disk: the database is
> wiped on every restart and redeploy. The application includes optional
> S3-compatible persistence (`server/src/db/remote-backup.js`) that mirrors the
> database to Cloudflare R2 or Backblaze B2 — both free for 10 GB. Set the
> `BACKUP_S3_*` variables in `.env.example` before putting real records in the
> system. The startup banner confirms which mode is active:

```
Data persistence      : local file + remote mirror     <- data survives restarts
Data persistence      : local file only                <- data is lost on restart
```

If the remote bucket is unreachable the application still starts normally on the
local file — persistence degrades rather than blocking boot, and a corrupt remote
copy is validated before it is ever allowed to overwrite local data.

---

## 9. Notes and Limitations

- The data store is a single JSON file, comfortable for tens of thousands of
  records on a single-server deployment. For multi-site or high-concurrency
  use, migrate the data layer to SQL Server or PostgreSQL &mdash; the
  `JsonStore` interface in `server/src/db/store.js` is the only component that
  needs replacing.
- Document records store a file reference path, not the file itself. Uploading
  and storing scanned paperwork is a natural next step.
- Location tracking (GPS) is not included; trips carry planned and actual
  distance rather than a live position feed.
- Email and SMS notifications are stubbed. The report distribution endpoint
  returns 501 until an SMTP relay is configured.

---

## 10. Verification Status

The project ships with four test suites, all passing:

```
API end-to-end suite      : 70 passed, 0 failed
Frontend asset suite      : 37 passed, 0 failed
Browser console suite     : clean, no runtime errors
Functional UI suite       : 20 passed, 0 failed (16/16 pages render)
```

The API suite covers authentication, credential rejection, unauthenticated
access blocking, all 12 collections, computed views (manifests, rosters,
compliance radar, utilisation), all 11 reports plus CSV export, create/update/
delete flows, duplicate and range validation, foreign key validation, trip
attendance and close-out, role-based access control, and static file hosting.

It also includes a **frontend/backend contract guard**: it extracts every
collection the frontend requests and asserts a matching route exists. This was
added after a whole-page failure went undetected — see below.

The browser console suite loads each real page in a DOM and reports any script
error. The functional UI suite signs in against the live API and drives the
app's own router through every navigation entry, asserting each page produces
real DOM. Together they catch the class of bug where a page loads without an
error but renders nothing.

### Defect found and fixed during browser debugging

Four pages — **Trip Logs, Routes & Stops, Shift Timings and Employees** — were
completely non-functional, each showing "Could not load this page" because
`GET /api/shifts` returned 404. Shifts are a first-class collection (every route
belongs to a shift, and the trip schedule derives from the shift's pickup and
drop windows) and the frontend loads the shift list as a lookup on those four
pages, but the route handler had never been written. The collection existed in
the data model and was read by several backend modules, which is why nothing
failed loudly.

Fixed by adding `server/src/routes/shifts.js` with full CRUD, time-window
validation, a dependency check before deletion, and authentication applied
ahead of its hand-written routes.

**Why every earlier test passed anyway:** the existing suites only exercised the
collections they already knew about, and none of them rendered a page or checked
that a frontend call had a backend counterpart. Green tests were not evidence
the application worked. The contract guard and UI suite now close that gap.

---

*Select Mobility India Private Limited &mdash; Employee Transportation Division.*
*Internal system. Not for distribution outside the organisation.*
