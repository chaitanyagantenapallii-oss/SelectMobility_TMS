# API Reference

Base URL: `http://localhost:4000/api`

All endpoints except `/health` and `/auth/login` require an
`Authorization: Bearer <token>` header. Tokens are returned by the login
endpoint and expire after the configured session lifetime (default 12 hours).

**Success responses** always wrap payloads in a `data` key:

```json
{ "data": { ... }, "meta": { ... } }
```

**Error responses** use the HTTP status code and this shape:

```json
{
  "error": true,
  "status": 400,
  "message": "Registration number \"MH-12-AB-4521\" already exists (VEH0001).",
  "details": { "fields": ["regNo"] }
}
```

| Status | Meaning |
|---|---|
| 200 | Success |
| 201 | Record created |
| 400 | Validation failed or malformed request |
| 401 | Missing, invalid or expired token |
| 403 | Authenticated but the role is not permitted |
| 404 | Record or route not found |
| 409 | Uniqueness conflict |
| 500 | Unexpected server error |

---

## Health

### `GET /health`
No authentication required. Returns service status and record counts.

```json
{
  "status": "ok",
  "company": "Select Mobility India Private Limited",
  "version": "1.0.0",
  "records": { "vehicles": 8, "drivers": 8, "employees": 30, "trips": 70 },
  "serverTime": "2026-09-13T02:14:22.501Z"
}
```

---

## Authentication

### `POST /auth/login`
```json
{ "email": "admin@selectmobility.in", "password": "Select@2026" }
```
Returns `{ token, expiresInHours, user, company }`.

### `GET /auth/me`
Returns the signed-in user and company details.

### `POST /auth/logout`
Records the logout in the audit trail.

### `POST /auth/change-password`
```json
{ "currentPassword": "Select@2026", "newPassword": "NewPassword123" }
```
New password must be at least 8 characters.

---

## Standard Resource Endpoints

These verbs exist for every collection below:

| Collection | Path | ID prefix | Writable by |
|---|---|---|---|
| Vehicles | `/vehicles` | `VEH` | operations, admin |
| Drivers | `/drivers` | `DRV` | operations, admin |
| Employees | `/employees` | `EMP` | operations, admin |
| Routes | `/routes` | `RTE` | operations, admin |
| Shifts | `/shifts` | `SHF` | operations, admin |
| Trips | `/trips` | `TRP` | operations, admin |
| Maintenance | `/maintenance` | `MNT` | operations, admin |
| Fuel | `/fuel` | `FUL` | operations, admin |
| Documents | `/documents` | `DOC` | operations, admin |
| Incidents | `/incidents` | `INC` | operations, admin |
| Vendors | `/vendors` | `VEN` | operations, admin |
| Expenses | `/expenses` | `EXP` | operations, admin |
| Users | `/users` | `USR` | admin only |

### `GET /{collection}`
Query parameters:

| Parameter | Description |
|---|---|
| `search` | Case-insensitive substring match across the resource's text fields |
| `status` | Filter by status; comma-separate for multiple values |
| `page`, `pageSize` | Enable pagination. Without these, every matching row is returned with `meta.total` |
| `order` | `asc` or `desc` (default `desc` by the resource's primary sort field) |
| Resource filters | `routeId`, `vehicleId`, `driverId`, `shiftId`, `vendorId`, `type`, `category`, `month`, `paymentMode`, `severity`, `gender`, `department`, `ownership`, `fuelType`, `assignedVehicleId` |
| `from`, `to` | Date range filter (`YYYY-MM-DD`) where the record has a `date` field |

Example:
```
GET /api/trips?status=scheduled,in-progress&routeId=RTE0001&page=1&pageSize=25
```

Paginated response:
```json
{
  "data": [ ... ],
  "meta": { "page": 1, "pageSize": 25, "total": 70, "totalPages": 3 }
}
```

### `GET /{collection}/{id}`
Returns a single record with computed fields attached.

### `POST /{collection}`
Creates a record. The `id` is generated server-side. Registration numbers are
upper-cased automatically. Validate against the rules below.

### `PUT /{collection}/{id}`
Partial update of the supplied fields. `id` and `createdAt` are immutable.

### `DELETE /{collection}/{id}`
Removes the record.

---

## Validation Rules

### Vehicles
| Field | Rule |
|---|---|
| `regNo` | Required, unique, upper-cased |
| `model` | Required |
| `type` | Required; one of `bus`, `van`, `car`, `tempo`, `ev-bus` |
| `seats` | 4 to 80 |
| `odometer` | 0 to 2,000,000 |
| `status` | `active`, `idle`, `maintenance`, `breakdown`, `retired` |

### Drivers
| Field | Rule |
|---|---|
| `name`, `phone`, `licenceNo` | Required |
| `licenceNo` | Unique |
| `experience` | 0 to 60 years |
| `status` | `active`, `on-leave`, `suspended`, `exited` |

### Employees
| Field | Rule |
|---|---|
| `name`, `code`, `phone` | Required |
| `code` | Unique |
| `routeId` | Must reference an existing route |
| `status` | `active`, `inactive`, `on-leave` |

### Routes
| Field | Rule |
|---|---|
| `code`, `name`, `shiftId` | Required |
| `code` | Unique |
| `distanceKm` | 0 to 500 |
| `stops` | At least two when submitting through the stop endpoint |

### Trips
| Field | Rule |
|---|---|
| `date`, `routeId`, `vehicleId`, `driverId`, `shiftId` | Required |
| Foreign keys | `routeId`, `vehicleId` and `driverId` must exist |
| `status` | `scheduled`, `in-progress`, `completed`, `cancelled` |
| `plannedKm`, `actualKm` | 0 to 1000 |

### Maintenance
| Field | Rule |
|---|---|
| `vehicleId`, `description`, `date` | Required |
| `type` | `scheduled-service`, `repair`, `tyre`, `breakdown`, `inspection`, `bodywork` |
| `status` | `scheduled`, `in-progress`, `completed`, `cancelled` |
| `cost` | 0 to 10,000,000 |

### Fuel
| Field | Rule |
|---|---|
| `vehicleId`, `litres`, `rate`, `date` | Required |
| `litres` | 0 to 1000 |
| `rate` | 0 to 500 |
| `paymentMode` | `fuel-card`, `cash`, `credit`, `vendor` |

### Expenses
| Field | Rule |
|---|---|
| `month`, `category`, `amount` | Required |
| `category` | `driver-salary`, `vendor-hire`, `fuel`, `maintenance`, `toll`, `insurance`, `misc` |
| `status` | `pending`, `approved`, `paid`, `rejected` |

### Documents
| Field | Rule |
|---|---|
| `vehicleId`, `type`, `expiryDate` | Required |
| `type` | `insurance`, `permit`, `puc`, `fitness`, `road-tax`, `contract` |

### Incidents
| Field | Rule |
|---|---|
| `vehicleId`, `type`, `description`, `date` | Required |
| `type` | `breakdown`, `accident`, `delay`, `complaint`, `safety`, `other` |
| `severity` | `low`, `medium`, `high`, `critical` |
| `status` | `open`, `under-review`, `closed` |

---

## Dashboard

### `GET /dashboard/overview`
The main dashboard payload.

| Block | Contents |
|---|---|
| `kpis` | totalVehicles, activeVehicles, vehiclesInMaintenance, totalDrivers, activeDrivers, totalEmployees, activeEmployees, tripsToday, completedToday, attendanceRate, complianceAlerts, openIncidents, monthToDateCost, monthFuelCost, monthMaintenanceCost, fleetAvailabilityPct |
| `todayBoard` | Today's runs with departure, shift, route, vehicle, driver, boarding counts and status |
| `utilisationSeries` | 14 days of `{ date, trips, completed, cancelled, km, passengers, utilisationPct }` |
| `routeLoad` | Per route: trips, capacity, allocated seats, fill percentage, employee count |
| `complianceAlerts` | Documents expiring within 45 days |
| `recentIncidents` | Six most recent incidents |
| `upcomingMaintenance` | Six next workshop jobs |

### `GET /dashboard/vehicle-utilisation?days=30`
Per-vehicle running summary over the window: trips, km, litres, km/l, fuel
spend, passengers and cost per km.

---

## Trips, Manifests and Boarding

### `GET /trips/{id}/manifest`
Passenger list for one run, grouped by stop sequence.

```json
{
  "data": {
    "trip": { "id": "TRP00001", "date": "2026-09-13", "status": "completed" },
    "route": { "code": "R-01", "name": "Hinjewadi - Wakad Corridor", "distanceKm": 24.5 },
    "vehicle": { "regNo": "MH-12-AB-4521", "seats": 40 },
    "driver": { "name": "Ramesh Sawant", "phone": "+91 98230 11221" },
    "summary": { "total": 6, "boarded": 6, "absent": 0, "pending": 0, "seatsAvailable": 34 },
    "stops": [
      { "stop": "Wakad Chowk", "passengers": [ { "bookingId": "BKG00001", "code": "SMI-1001", "name": "Aarav Deshmukh", "stop": "Wakad Chowk", "boarded": true } ] }
    ],
    "unlisted": []
  }
}
```

### `POST /trips/{id}/attendance`
Bulk-mark boarding. Records attendance, updates each booking's status and
recalculates the trip's boarded count.

```json
{ "entries": [ { "bookingId": "BKG00001", "boarded": true },
                { "bookingId": "BKG00002", "boarded": false } ] }
```
Returns `{ "ok": true, "updated": 2, "boarded": 5 }`.

### `POST /trips/{id}/complete`
Close out a run with final readings.
```json
{ "actualKm": 48.5, "fuelCost": 620, "tollCost": 60, "notes": "Minor diversion at Wakad" }
```

### `POST /trips/{id}/cancel`
```json
{ "reason": "Vehicle breakdown - route merged with R-02" }
```
The reason is stored on the trip and every booking on the run is marked
`cancelled`.

---

## Routes

### `GET /routes/{id}/roster`
Active employees grouped by boarding stop, plus any employee whose stop is not
in the route's stop list.

### `PUT /routes/{id}/stops`
Replace the ordered stop sequence.
```json
{ "stops": ["Wakad Chowk", "Datta Mandir", "Hinjewadi Phase 1", "Plant Gate 2"] }
```
Minimum two stops.

---

## Documents

### `GET /documents/alerts?window=45`
Compliance radar. Returns documents expired or expiring within `window` days,
each with `daysLeft` and a `severity` of `expired`, `critical` (within 15 days)
or `warning`, sorted by urgency. `meta` carries the counts per severity.

---

## Expenses

### `GET /expenses/summary`
Monthly rollup with per-category totals, paid and pending splits, the grand
total and the monthly average.

### `POST /expenses/{id}/approve`
```json
{ "status": "paid" }
```
Accepts `approved`, `paid` or `rejected`; stamps the approving user.

---

## Incidents

### `POST /incidents/{id}/resolve`
```json
{ "actionTaken": "Vendor replaced the clutch assembly and vehicle returned to service.",
  "status": "closed" }
```
Accepts `closed` or `under-review`; stamps the resolving user and timestamp.

---

## Vendors

`GET /vendors` decorates each vendor with linked vehicle and driver counts,
trips serviced, total amount billed and a list of its vehicles.

---

## Users (administrator only)

### `GET /users`
Lists accounts with password hashes removed.

### `POST /users`
```json
{ "name": "Priya Joshi", "email": "priya@selectmobility.in",
  "password": "SecurePass123", "role": "operations" }
```
Role must be `admin`, `operations` or `viewer`. Password minimum 8 characters.

### `PUT /users/{id}`
Update `name`, `email`, `role`, `status` and optionally `password`.

### `DELETE /users/{id}`
Refuses to delete your own account or the last remaining administrator.

### `GET /users/audit-log`
The 300 most recent audit entries, newest first.

---

## Reports

### `GET /reports`
Catalogue of every available report with its title, column list and both
endpoint URLs.

### `GET /reports/{key}.json?from=YYYY-MM-DD&to=YYYY-MM-DD`
Structured payload:
```json
{
  "data": [ { ... } ],
  "meta": {
    "key": "trips",
    "title": "Daily Trip Register",
    "columns": ["Date", "Trip ID", "..."],
    "range": { "from": "2026-08-15", "to": "2026-09-13" },
    "rowCount": 70,
    "generatedAt": "2026-09-13T02:20:00.000Z",
    "company": { "name": "Select Mobility India Private Limited" },
    "totals": { "plannedKm": 1715, "actualKm": 1642.3 }
  }
}
```
`totals` contains the sum of every numeric column.

### `GET /reports/{key}.csv?from=...&to=...`
The same rows as RFC 4180 CSV, served with
`Content-Disposition: attachment; filename="trips-2026-08-15-to-2026-09-13.csv"`.
Opens directly in Excel.

### Report keys

| Key | Title | Rows |
|---|---|---|
| `summary` | Management Summary | One row per KPI (22 metrics) |
| `trips` | Daily Trip Register | One row per trip |
| `attendance` | Employee Attendance Register | One row per boarding record |
| `vehicle-cost` | Vehicle Cost & Efficiency | One row per vehicle |
| `maintenance` | Maintenance & Repair Log | One row per workshop job |
| `fuel` | Fuel Consumption Register | One row per fill |
| `drivers` | Driver Performance Scorecard | One row per driver |
| `routes` | Route Performance Summary | One row per route |
| `compliance` | Statutory Compliance Register | One row per document |
| `expenses` | Operating Cost Ledger | One row per expense entry |
| `incidents` | Incident & Safety Register | One row per incident |

`from` and `to` default to the last 30 days when omitted.

### `POST /reports/email`
Reserved for scheduled distribution. Returns 501 until an SMTP relay is
configured.

---

## Integration Examples

### Sign in and fetch today's board

```bash
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@selectmobility.in","password":"Select@2026"}' \
  | node -pe "JSON.parse(require('fs').readFileSync(0)).token")

curl -s http://localhost:4000/api/dashboard/overview \
  -H "Authorization: Bearer $TOKEN" | node -pe "JSON.stringify(JSON.parse(require('fs').readFileSync(0)).data.kpis, null, 2)"
```

### Download the monthly cost report

```bash
curl -s "http://localhost:4000/api/reports/expenses.csv?from=2026-09-01&to=2026-09-30" \
  -H "Authorization: Bearer $TOKEN" -o september-costs.csv
```

### Log a trip and close it out

```bash
curl -s -X POST http://localhost:4000/api/trips \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"date":"2026-09-14","routeId":"RTE0001","vehicleId":"VEH0001",
       "driverId":"DRV0001","shiftId":"SHF0001","plannedKm":49}'

curl -s -X POST http://localhost:4000/api/trips/TRP00071/complete \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"actualKm":48.2,"fuelCost":610}'
```
