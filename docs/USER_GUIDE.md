# User Guide

Daily operating procedures for the Select Mobility transport desk.

---

## Getting Started

### Signing in

1. Open a browser and go to `http://localhost:4000` (or the address your IT
   team gives you).
2. Enter your email and password on the sign-in screen.
3. You land on the Operations Dashboard.

Sessions last 12 hours by default. If you leave the system idle past that,
you will be returned to the sign-in screen and any unsaved form data is lost.

### Finding your way around

The left sidebar is grouped by function:

| Group | Pages |
|---|---|
| **Operations** | Dashboard, Trip Logs, Manifests & Boarding, Routes & Stops, Shift Timings |
| **Resources** | Fleet Vehicles, Drivers, Employees, Vendors |
| **Cost & Care** | Maintenance, Fuel & Energy, Expenses |
| **Compliance** | Documents, Incidents |
| **Insight** | Reports & Exports, Users & Audit (administrators only) |

The bell icon in the top bar shows a combined count of compliance alerts due
within 30 days plus open incidents. The printer icon prints whatever page you
are on, formatted for paper. Your account chip shows your name and role, and
lets you change your password.

---

## Morning Routine

### 1. Check the dashboard

Open the dashboard and scan the four headline figures:

- **Fleet Availability** &mdash; if this drops, some routes cannot run as planned.
- **Trips Today** &mdash; how many runs are scheduled and how many are done.
- **Employee Boarding** &mdash; the share of allocated seats actually occupied.
- **Open Incidents** &mdash; anything unresolved from the previous shift.

Then work down the page:

- **Today's Operations Board** lists every run in departure order. Click
  **Manifest** on any row to open its passenger list.
- **Compliance Alerts** shows documents expiring within 45 days. Act on the
  red ones first.
- **Upcoming Workshop Jobs** shows scheduled services, with **overdue** marked
  in red.

### 2. Handle compliance alerts

Any document already expired or expiring within 15 days is critical. For each:

1. Go to **Documents**.
2. Find the vehicle and document type in the **Compliance Radar** at the top.
3. Arrange the renewal with the vendor or RTO.
4. When the new certificate arrives, click the pencil icon on the document row,
   update the **Issue date** and **Expiry date**, and save.

The radar and the top-bar counter update immediately.

### 3. Dispatch the shift

Before the first departure:

1. Go to **Trip Logs** and filter to today's date to confirm every route has a
   run logged with a vehicle and driver assigned.
2. Where a run is missing, click **+ Log Trip**, choose the date, shift, route,
   vehicle and driver, and save. The planned distance fills in automatically
   from the route.
3. Check **Fleet Vehicles** for any vehicle showing `maintenance` or
   `breakdown`. Reassign its route to an available vehicle before departure.
4. Check **Drivers** for anyone whose licence shows an expiring or expired
   flag. Do not dispatch them until it is renewed.

---

## Daily Operations

### Recording boarding on a manifest

This is the most frequent task. Do it as each vehicle reaches the plant.

1. Go to **Manifests & Boarding**. The top table lists today's runs that still
   need boarding; the lower table shows recent runs.
2. Click **Open manifest** on the run you are handling.
3. Review the header: route, trip, departure time, vehicle, capacity and driver
   with phone number.
4. Work down the stops in sequence. Each stop lists the employees who board
   there. Tick the checkbox next to each employee as they board.
5. Employees who do not turn up are left unticked.
6. Click **Save boarding**. The counts update and the trip's boarded figure is
   recalculated.

Useful shortcuts:

- **Mark all boarded** &mdash; ticks everyone, then untick the absentees.
- **Clear all** &mdash; resets the form if you started on the wrong run.
- **Print manifest** &mdash; a paper copy for the driver.

> Nothing is saved until you click **Save boarding**. You can tick any number
> of employees and save them in one go. The button shows how many changes are
> pending.

### Closing out a trip

Once a vehicle returns:

1. Go to **Trip Logs** and find the run.
2. Click the green tick button.
3. Enter the **actual distance** from the odometer and the fuel and toll costs
   for the run.
4. Add a closing note if anything deviated from plan &mdash; a diversion, a
   delay, a passenger issue.
5. Click **Mark completed**.

The trip is now included in cost and efficiency reports, and it drops off the
boarding queue.

### Cancelling a trip

If a run cannot happen &mdash; breakdown, insufficient bookings, no driver:

1. Open the run in **Trip Logs** and click the red cross.
2. Enter the reason. This is mandatory and is stored on the trip.
3. Click **Cancel trip**.

Every passenger booking on that run is marked cancelled. If those employees
were merged onto another vehicle, record the actual boarding on that
vehicle's manifest instead.

### Reporting an incident

Report anything that affects safety, punctuality or the passenger experience.

1. Go to **Incidents** and click **+ Report Incident**.
2. Select the date, vehicle and route (if applicable).
3. Choose the type &mdash; breakdown, accident, delay, complaint, safety or
   other.
4. Set the severity:
   - **Critical** &mdash; injury, collision, or a vehicle blocking a route
   - **High** &mdash; breakdown requiring recovery
   - **Medium** &mdash; significant delay or a vehicle off-road within the day
   - **Low** &mdash; minor complaint or short delay
5. Describe what happened, including location and immediate impact.
6. Record the action taken, then save.

To close an incident later, click the green tick on its row, enter the
resolution and set it to **Closed** or leave it **Under review**. Resolution
stamps your name and the time.

### Recording fuel

After each fill:

1. Go to **Fuel & Energy** and click **+ Record Fill**.
2. Pick the vehicle, enter the date, quantity in litres (or kWh for an
   electric vehicle) and the rate per unit. The amount calculates
   automatically.
3. Enter the odometer reading, station name and payment mode.
4. Save.

For electric vehicles, enter energy in kWh and the per-unit tariff. The report
labels the unit correctly based on the vehicle's fuel type.

### Logging a workshop job

1. Go to **Maintenance** and click **+ Log Job**.
2. Select the vehicle, job type, date and status.
3. Describe the work, name the workshop and enter the estimated cost.
4. Enter the odometer reading at service if known.
5. Save.

When the vehicle comes back, click the green tick on the row and enter the
**final invoice amount**, then confirm. Jobs past their scheduled date are
marked **overdue** in the register.

Also switch the vehicle's status on **Fleet Vehicles** to `maintenance` while
it is off the road and back to `active` on its return, so the dashboard
availability figure stays accurate.

---

## Weekly and Monthly Tasks

### Weekly

- **Review driver performance.** Open **Drivers**, click the eye icon on each
  driver to see their scorecard: trips, distance and on-time percentage.
  Investigate anyone persistently below 80%.
- **Check route load factors.** The dashboard's **Route Load Today** panel
  shows seat fill per route. Routes consistently above 90% need a larger
  vehicle or a second run; routes below 50% may be candidates for merging.
- **Verify vehicle efficiency.** Open **Reports & Exports**, preview
  **Vehicle Cost & Efficiency** for the last 7 days, and look at km/l. A sharp
  drop for one vehicle usually signals a mechanical problem or a fuel-logging
  error.
- **Clear the compliance radar.** Aim to keep zero items in the expired bucket.
- **Triage incidents.** No incident should sit at `open` for more than a few
  days without at least an update.

### Monthly

1. **Reconcile expenses.** Open **Operating Expenses**. For each pending entry,
   verify the amount against the invoice and click the green tick to mark it
   paid. Review the category donut against the previous month.
2. **Produce the management summary.** In **Reports & Exports**, set the period
   to the full month, preview **Management Summary**, then click **Download
   CSV** for the file to circulate.
3. **Review vendor performance.** Open **Vendors** and check rating, trips
   serviced and amount billed. Flag anyone trending badly or approaching
   contract expiry.
4. **Plan preventive maintenance.** In **Maintenance**, look at vehicles whose
   next service kilometre reading is approaching and schedule jobs ahead of the
   busy period.
5. **Audit attendance outliers.** Preview the **Employee Attendance Register**
   for the month and follow up with departments whose staff repeatedly miss
   the shuttle.

---

## Using Reports

Every report works the same way.

1. Go to **Reports & Exports**.
2. Set the **Reporting Period** at the top. Use **Last 30 days** or
   **This month** for quick presets, or type exact dates.
3. Click any report card, then **Preview**.
4. The preview shows the row count, generation time, column totals for every
   numeric field, and up to 500 rows on screen.
5. Click **Download CSV** to get the complete data set for Excel. The file is
   named with the report key and date range.
6. Click **Print** for a paper copy without the navigation chrome.

### Which report to use

| I need to... | Use this report |
|---|---|
| Brief management on the month | Management Summary |
| Check what ran on a given day | Daily Trip Register |
| Chase employees who miss the shuttle | Employee Attendance Register |
| Compare running costs between vehicles | Vehicle Cost & Efficiency |
| Justify a workshop bill | Maintenance & Repair Log |
| Analyse fuel consumption | Fuel Consumption Register |
| Assess a driver | Driver Performance Scorecard |
| Decide whether to merge routes | Route Performance Summary |
| Prepare for an RTO or insurance audit | Statutory Compliance Register |
| Reconcile the transport budget | Operating Cost Ledger |
| Review safety trends | Incident & Safety Register |

---

## Adding and Maintaining Records

### Adding a vehicle

**Fleet Vehicles** &rarr; **+ Add Vehicle**. Registration is upper-cased
automatically and must be unique. Enter seat capacity, fuel type and whether
the vehicle is owned or contracted; if contracted, pick the vendor so costs
attribute correctly. Fill in the four compliance expiry dates straight away
&mdash; the radar depends on them.

### Adding a driver

**Drivers** &rarr; **+ Add Driver**. Licence number must be unique. Set the
licence expiry date so the system can warn you ahead of time. Assign the
vehicle they normally drive.

### Adding an employee

**Employees** &rarr; **+ Add Employee**. Employee code must be unique. Choose
the route first &mdash; the boarding stop list then populates with that route's
stops, and the shift is set to the route's default (you can override it).

Getting the boarding stop right matters: manifests are grouped by stop, so an
employee on the wrong stop will not appear where the driver expects them.

### Adding a route

**Routes & Stops** &rarr; **+ Add Route**. Enter the code, name, shift and
one-way distance, then list the stops one per line **in pickup order** &mdash;
the sequence is what the manifest follows. At least two stops are required.

Use the eye icon on a route row to see its full roster grouped by stop, and to
spot any employee whose recorded stop is not in the route's stop list.

### Adjusting a shift

**Shift Timings** &rarr; click **Edit** on a shift card. Set the pickup and
drop windows. Routes and employees assigned to the shift are shown on the card.

---

## Managing Access

Administrators only. Go to **Users & Audit**.

### Roles

| Role | Can do |
|---|---|
| **Administrator** | Everything, including managing accounts and passwords |
| **Operations** | Day-to-day records: trips, boarding, vehicles, drivers, routes, expenses, incidents |
| **Viewer** | Read-only access plus report downloads |

### Adding a user

Click **+ Add User**, enter name, email, role and a password of at least 8
characters. Create individual accounts rather than sharing a login &mdash;
the audit trail is only useful if each action is attributable to one person.

### The audit trail

The lower table on the same page lists the 300 most recent system events with
the actor, action and detail. Use it to answer "who changed this and when"
questions.

---

## Troubleshooting

**I am returned to the sign-in screen unexpectedly.**
Your session expired after the configured period of inactivity. Sign in again.

**A field will not accept my input.**
Validation messages appear directly under the form. Common causes: a duplicate
registration number or employee code, a seat count outside 4&ndash;80, or a
missing required field.

**"Route RTE9999 does not exist."**
The form referenced a route that has been deleted. Reload the page so the
dropdowns refresh, then try again.

**Boarding changes disappeared.**
The manifest only saves when you click **Save boarding**. Navigating away
discards unsaved ticks.

**A vehicle still shows as available but is in the workshop.**
The dashboard reads the vehicle's own status field, not the maintenance
register. Update the vehicle's status to `maintenance` on **Fleet Vehicles**.

**The compliance radar looks empty.**
The window may be set too narrow. Widen it using the dropdown on the
**Documents** page.

**Report totals look wrong.**
Check the reporting period &mdash; it is set once and applies to every report
until you change it.

**A background is very light / printing is hard to read.**
The stylesheet includes a print mode that strips navigation and colours. Use
the printer icon in the top bar rather than the browser's own shortcut.

---

## Keyboard and Browser Notes

- `Esc` closes any open dialog.
- The layout works on tablets and phones; the sidebar collapses behind the
  menu button on narrow screens.
- CSV files open directly in Excel. If Excel shows all data in one column,
  import through **Data &rarr; From Text/CSV** and choose comma as the
  delimiter.
- The system is tested on current Chrome, Edge and Firefox.
