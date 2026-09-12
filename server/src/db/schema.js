'use strict';

/**
 * Database schema definition + initial seed data.
 *
 * Collections:
 *   users         - application logins (admin / operations / viewer)
 *   employees     - client employees who use the shuttle service
 *   drivers       - fleet drivers with licence & badge details
 *   vehicles      - owned / contracted buses and vans
 *   vendors       - transport contractors supplying vehicles & drivers
 *   routes        - named route corridors with stops
 *   shifts        - pickup / drop time windows
 *   trips         - one vehicle run on a date (the core operational record)
 *   bookings      - employee seat allocation on a trip
 *   attendance    - boarded / no-show tracking per booking
 *   maintenance   - service, repair and inspection history
 *   fuel          - fuel / charging transactions
 *   documents     - compliance papers (insurance, permit, PUC, fitness)
 *   incidents     - accidents, breakdowns and escalation log
 *   expenses      - operational cost ledger
 */

const { JsonStore } = require('./store');
const { restore: remoteRestore, createUploader } = require('./remote-backup');
const config = require('../config');
const { hashPassword } = require('../utils/password');

const EMPTY_DATABASE = {
  users: [],
  employees: [],
  drivers: [],
  vehicles: [],
  vendors: [],
  routes: [],
  shifts: [],
  trips: [],
  bookings: [],
  attendance: [],
  maintenance: [],
  fuel: [],
  documents: [],
  incidents: [],
  expenses: [],
  auditLog: [],
};

function isoDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function stamp(offsetMinutes = 0) {
  const d = new Date();
  d.setMinutes(d.getMinutes() + offsetMinutes);
  return d.toISOString();
}

/** Deterministic demo dataset so the dashboard has something meaningful to show. */
function buildSeed() {
  const db = structuredClone(EMPTY_DATABASE);

  db.users.push({
    id: 'USR0001',
    name: config.admin.name,
    email: config.admin.email,
    role: 'admin',
    passwordHash: hashPassword(config.admin.password),
    status: 'active',
    createdAt: stamp(),
    updatedAt: stamp(),
  });
  db.users.push({
    id: 'USR0002',
    name: 'Rohit Kulkarni',
    email: 'ops@selectmobility.in',
    role: 'operations',
    passwordHash: hashPassword('Ops@2026'),
    status: 'active',
    createdAt: stamp(),
    updatedAt: stamp(),
  });

  const vendors = [
    { name: 'Sai Travels', contact: 'Mahesh Patil', phone: '+91 98220 41122', gstin: '27AABCS1429P1ZQ', rating: 4.5 },
    { name: 'Shree Balaji Transport', contact: 'Anil Jadhav', phone: '+91 98501 77340', gstin: '27AAGCS8821K1Z4', rating: 4.1 },
    { name: 'Metro Fleet Services', contact: 'Farida Shaikh', phone: '+91 90280 55118', gstin: '27AAECM3390L1ZT', rating: 3.8 },
    { name: 'Own Fleet', contact: 'Select Mobility', phone: '+91 20 4890 1200', gstin: '27AABCS1429P1ZQ', rating: 5.0 },
  ];
  vendors.forEach((v, i) => {
    db.vendors.push({ id: `VEN${String(i + 1).padStart(4, '0')}`, status: 'active', contractTill: isoDate(240 + i * 30), ...v, createdAt: stamp(), updatedAt: stamp() });
  });

  const vehicles = [
    { regNo: 'MH-12-AB-4521', model: 'Tata Starbus 40', type: 'bus', seats: 40, vendorId: 'VEN0004', fuelType: 'diesel', odometer: 184320 },
    { regNo: 'MH-12-AB-4522', model: 'Tata Starbus 40', type: 'bus', seats: 40, vendorId: 'VEN0004', fuelType: 'diesel', odometer: 176940 },
    { regNo: 'MH-12-CD-7788', model: 'Ashok Leyland Sunshine', type: 'bus', seats: 32, vendorId: 'VEN0001', fuelType: 'diesel', odometer: 221450 },
    { regNo: 'MH-14-EF-1190', model: 'Force Traveller 17', type: 'van', seats: 17, vendorId: 'VEN0001', fuelType: 'diesel', odometer: 98470 },
    { regNo: 'MH-14-EF-1191', model: 'Force Traveller 17', type: 'van', seats: 17, vendorId: 'VEN0002', fuelType: 'diesel', odometer: 103220 },
    { regNo: 'MH-12-GH-6600', model: 'Eicher Skyline Pro', type: 'bus', seats: 36, vendorId: 'VEN0002', fuelType: 'diesel', odometer: 142880 },
    { regNo: 'MH-12-EV-2201', model: 'Olectra C9 Electric', type: 'bus', seats: 32, vendorId: 'VEN0004', fuelType: 'electric', odometer: 41250 },
    { regNo: 'MH-14-JK-3355', model: 'Mahindra Tourister', type: 'van', seats: 13, vendorId: 'VEN0003', fuelType: 'cng', odometer: 76310 },
  ];
  const vehicleStatuses = ['active', 'active', 'active', 'maintenance', 'active', 'idle', 'active', 'active'];
  vehicles.forEach((v, i) => {
    db.vehicles.push({
      id: `VEH${String(i + 1).padStart(4, '0')}`,
      ...v,
      status: vehicleStatuses[i],
      ownership: v.vendorId === 'VEN0004' ? 'owned' : 'contract',
      insuranceExpiry: isoDate(30 + i * 21),
      permitExpiry: isoDate(75 + i * 17),
      pucExpiry: isoDate(12 + i * 9),
      fitnessExpiry: isoDate(150 + i * 13),
      lastServiceAt: isoDate(-(20 + i * 6)),
      nextServiceKm: v.odometer + (4200 - i * 180),
      createdAt: stamp(),
      updatedAt: stamp(),
    });
  });

  const drivers = [
    { name: 'Ramesh Sawant', phone: '+91 98230 11221', licenceNo: 'MH1220140001234', licenceExpiry: isoDate(420), badge: 'Badge-PNQ-8841', vendorId: 'VEN0004', experience: 14 },
    { name: 'Suresh Pawar', phone: '+91 98230 55412', licenceNo: 'MH1220120009871', licenceExpiry: isoDate(310), badge: 'Badge-PNQ-7734', vendorId: 'VEN0004', experience: 11 },
    { name: 'Imran Qureshi', phone: '+91 90040 33210', licenceNo: 'MH1420160004412', licenceExpiry: isoDate(95), badge: 'Badge-PNQ-6612', vendorId: 'VEN0001', experience: 8 },
    { name: 'Dattatray More', phone: '+91 99870 22145', licenceNo: 'MH1220110003320', licenceExpiry: isoDate(540), badge: 'Badge-PNQ-9921', vendorId: 'VEN0001', experience: 16 },
    { name: 'Sanjay Bhosale', phone: '+91 88880 66123', licenceNo: 'MH1220150007788', licenceExpiry: isoDate(210), badge: 'Badge-PNQ-5520', vendorId: 'VEN0002', experience: 9 },
    { name: 'Kiran Jadhav', phone: '+91 97650 44120', licenceNo: 'MH1420170002231', licenceExpiry: isoDate(28), badge: 'Badge-PNQ-4417', vendorId: 'VEN0002', experience: 6 },
    { name: 'Prakash Gaikwad', phone: '+91 99220 11008', licenceNo: 'MH1220100001190', licenceExpiry: isoDate(600), badge: 'Badge-PNQ-3305', vendorId: 'VEN0003', experience: 19 },
    { name: 'Nitin Chavan', phone: '+91 90110 77230', licenceNo: 'MH1420180009910', licenceExpiry: isoDate(380), badge: 'Badge-PNQ-2288', vendorId: 'VEN0004', experience: 5 },
  ];
  drivers.forEach((d, i) => {
    db.drivers.push({
      id: `DRV${String(i + 1).padStart(4, '0')}`,
      ...d,
      status: i === 7 ? 'on-leave' : 'active',
      assignedVehicleId: i < vehicles.length ? `VEH${String(i + 1).padStart(4, '0')}` : null,
      address: 'Pune, Maharashtra',
      createdAt: stamp(),
      updatedAt: stamp(),
    });
  });

  const shifts = [
    { code: 'S1', name: 'Shift 1 - General', pickupStart: '06:45', pickupEnd: '08:00', dropStart: '17:30', dropEnd: '18:45' },
    { code: 'S2', name: 'Shift 2 - Afternoon', pickupStart: '13:15', pickupEnd: '14:15', dropStart: '22:30', dropEnd: '23:30' },
    { code: 'S3', name: 'Shift 3 - Night', pickupStart: '21:30', pickupEnd: '22:30', dropStart: '06:15', dropEnd: '07:15' },
  ];
  shifts.forEach((s, i) => {
    db.shifts.push({ id: `SHF${String(i + 1).padStart(4, '0')}`, ...s, status: 'active', createdAt: stamp(), updatedAt: stamp() });
  });

  const routeDefs = [
    { code: 'R-01', name: 'Hinjewadi - Wakad Corridor', shiftId: 'SHF0001', distanceKm: 24.5, stops: ['Wakad Chowk', 'Datta Mandir', 'Hinjewadi Phase 1', 'Blue Ridge Gate', 'Plant Gate 2'] },
    { code: 'R-02', name: 'Kothrud - Warje Corridor', shiftId: 'SHF0001', distanceKm: 19.2, stops: ['Kothrud Depot', 'Karve Nagar', 'Warje Bridge', 'Plant Gate 1'] },
    { code: 'R-03', name: 'Pimpri - Chinchwad Corridor', shiftId: 'SHF0002', distanceKm: 27.8, stops: ['Pimpri Chowk', 'Chinchwad Station', 'Nigdi', 'Bhakti Shakti', 'Plant Gate 3'] },
    { code: 'R-04', name: 'Hadapsar - Magarpatta Corridor', shiftId: 'SHF0001', distanceKm: 22.1, stops: ['Hadapsar Gadital', 'Magarpatta Gate', 'Kharadi Bypass', 'Plant Gate 2'] },
    { code: 'R-05', name: 'Katraj - Swargate Night', shiftId: 'SHF0003', distanceKm: 31.4, stops: ['Katraj Chowk', 'Bibwewadi', 'Swargate', 'Shivajinagar', 'Plant Gate 1'] },
  ];
  routeDefs.forEach((r, i) => {
    db.routes.push({ id: `RTE${String(i + 1).padStart(4, '0')}`, ...r, status: 'active', createdAt: stamp(), updatedAt: stamp() });
  });

  const firstNames = ['Aarav', 'Vivaan', 'Aditya', 'Ishaan', 'Kabir', 'Anaya', 'Diya', 'Saanvi', 'Myra', 'Kiara', 'Rohan', 'Sneha', 'Pooja', 'Meera', 'Tanvi', 'Varun', 'Nikhil', 'Shruti', 'Amol', 'Priya'];
  const lastNames = ['Deshmukh', 'Joshi', 'Patil', 'Shinde', 'Kale', 'Chavan', 'Bhosale', 'Naik', 'Kulkarni', 'Ghadge'];
  const departments = ['Production', 'Quality Assurance', 'Logistics', 'IT Services', 'Finance', 'Human Resources', 'Maintenance'];
  let empSeq = 0;
  for (const route of db.routes) {
    for (let i = 0; i < 6; i++) {
      empSeq += 1;
      const first = firstNames[empSeq % firstNames.length];
      const last = lastNames[(empSeq * 3) % lastNames.length];
      db.employees.push({
        id: `EMP${String(empSeq).padStart(4, '0')}`,
        code: `SMI-${String(1000 + empSeq)}`,
        name: `${first} ${last}`,
        email: `${first.toLowerCase()}.${last.toLowerCase()}@selectmobility.in`,
        phone: `+91 9${String(8000000000 + empSeq * 137).slice(0, 9)}`,
        department: departments[empSeq % departments.length],
        shiftId: route.shiftId,
        routeId: route.id,
        stop: route.stops[empSeq % route.stops.length],
        gender: empSeq % 3 === 0 ? 'female' : 'male',
        status: empSeq % 17 === 0 ? 'inactive' : 'active',
        emergencyContact: `+91 9${String(7000000000 + empSeq * 251).slice(0, 9)}`,
        createdAt: stamp(),
        updatedAt: stamp(),
      });
    }
  }

  // Trips for the last 14 days across a subset of routes and vehicles.
  let tripSeq = 0;
  const vehicleIds = db.vehicles.map((v) => v.id);
  const driverIds = db.drivers.map((d) => d.id);
  for (let day = 13; day >= 0; day--) {
    const date = isoDate(-day);
    for (let r = 0; r < db.routes.length; r++) {
      const route = db.routes[r];
      tripSeq += 1;
      const isToday = day === 0;
      const roll = (tripSeq * 7) % 10;
      const status = isToday && roll > 6 ? 'in-progress' : roll === 9 ? 'cancelled' : 'completed';
      const plannedKm = route.distanceKm * 2;
      const actualKm = Number((plannedKm * (0.94 + ((tripSeq % 5) * 0.02))).toFixed(1));
      const trip = {
        id: `TRP${String(tripSeq).padStart(5, '0')}`,
        date,
        shiftId: route.shiftId,
        routeId: route.id,
        vehicleId: vehicleIds[(r + day) % vehicleIds.length],
        driverId: driverIds[(r + day) % driverIds.length],
        departureAt: `${date} ${db.shifts.find((s) => s.id === route.shiftId).pickupStart}:00`,
        arrivalAt: `${date} ${db.shifts.find((s) => s.id === route.shiftId).pickupEnd}:00`,
        plannedKm,
        actualKm,
        fuelCost: Math.round(actualKm * 12.4),
        tollCost: r % 2 === 0 ? 120 : 0,
        passengersAllocated: 0,
        passengersBoarded: 0,
        status,
        notes: status === 'cancelled' ? 'Vehicle breakdown - route merged with R-02' : '',
        createdAt: stamp(),
        updatedAt: stamp(),
      };
      db.trips.push(trip);
    }
  }

  // Bookings + attendance for the most recent 3 days.
  let bookingSeq = 0;
  for (const trip of db.trips) {
    if (trip.date < isoDate(-2)) continue;
    const eligible = db.employees.filter((e) => e.routeId === trip.routeId && e.status === 'active');
    for (const emp of eligible) {
      bookingSeq += 1;
      const bookingId = `BKG${String(bookingSeq).padStart(5, '0')}`;
      const noShow = (bookingSeq * 11) % 23 === 0;
      if (trip.status !== 'completed') {
        db.bookings.push({
          id: bookingId, tripId: trip.id, employeeId: emp.id, stop: emp.stop,
          status: trip.status === 'cancelled' ? 'cancelled' : 'confirmed',
          createdAt: stamp(), updatedAt: stamp(),
        });
        continue;
      }
      db.bookings.push({
        id: bookingId, tripId: trip.id, employeeId: emp.id, stop: emp.stop,
        status: noShow ? 'no-show' : 'completed',
        createdAt: stamp(), updatedAt: stamp(),
      });
      db.attendance.push({
        id: `ATT${String(bookingSeq).padStart(5, '0')}`,
        tripId: trip.id, bookingId, employeeId: emp.id, date: trip.date,
        boarded: !noShow,
        boardedAt: noShow ? null : `${trip.date} ${trip.departureAt.slice(11, 16)}`,
        boardStop: emp.stop,
        markedBy: 'driver-app',
        createdAt: stamp(), updatedAt: stamp(),
      });
    }
  }

  // Recompute passenger counts on trips from their bookings.
  for (const trip of db.trips) {
    const related = db.bookings.filter((b) => b.tripId === trip.id);
    trip.passengersAllocated = related.length;
    trip.passengersBoarded = related.filter((b) => b.status === 'completed').length;
  }

  const maintenanceDefs = [
    { vehicleId: 'VEH0001', type: 'scheduled-service', description: 'Full service, oil + filter change', cost: 12400, workshop: 'Tata Authorised - Wakad', status: 'completed', daysAgo: 21 },
    { vehicleId: 'VEH0001', type: 'tyre', description: 'Two rear tyres replaced', cost: 18600, workshop: 'MRF Tyre Hub, Hinjewadi', status: 'completed', daysAgo: 46 },
    { vehicleId: 'VEH0003', type: 'repair', description: 'Brake pad and air dryer assembly', cost: 9400, workshop: 'Ashok Leyland Service, Chakan', status: 'completed', daysAgo: 33 },
    { vehicleId: 'VEH0004', type: 'breakdown', description: 'Clutch plate failure - towed from Wakad', cost: 16800, workshop: 'Force Motors, Pimpri', status: 'in-progress', daysAgo: 3 },
    { vehicleId: 'VEH0005', type: 'scheduled-service', description: '20,000 km service', cost: 8700, workshop: 'Force Motors, Pimpri', status: 'completed', daysAgo: 58 },
    { vehicleId: 'VEH0006', type: 'inspection', description: 'Quarterly safety inspection + PUC', cost: 1200, workshop: 'RTO Approved Centre, Pune', status: 'completed', daysAgo: 12 },
    { vehicleId: 'VEH0007', type: 'repair', description: 'Battery pack diagnostic and BMS firmware update', cost: 22000, workshop: 'Olectra Service, Chakan', status: 'scheduled', daysAgo: -4 },
    { vehicleId: 'VEH0002', type: 'scheduled-service', description: 'Preventive maintenance 180,000 km', cost: 14200, workshop: 'Tata Authorised - Wakad', status: 'scheduled', daysAgo: -9 },
    { vehicleId: 'VEH0003', type: 'repair', description: 'Alternator replacement', cost: 11250, workshop: 'Ashok Leyland Service, Chakan', status: 'completed', daysAgo: 74 },
  ];
  maintenanceDefs.forEach((m, i) => {
    db.maintenance.push({
      id: `MNT${String(i + 1).padStart(4, '0')}`,
      ...m,
      date: isoDate(-m.daysAgo),
      odometer: db.vehicles.find((v) => v.id === m.vehicleId).odometer - m.daysAgo * 118,
      loggedBy: 'USR0002',
      createdAt: stamp(),
      updatedAt: stamp(),
    });
  });

  const fuelDefs = [
    { vehicleId: 'VEH0001', litres: 92.4, rate: 89.7, station: 'HP Petrol Pump, Wakad' },
    { vehicleId: 'VEH0002', litres: 88.1, rate: 89.7, station: 'IOCL, Hinjewadi Phase 2' },
    { vehicleId: 'VEH0003', litres: 105.6, rate: 89.4, station: 'BPCL, Chakan' },
    { vehicleId: 'VEH0004', litres: 41.2, rate: 89.7, station: 'HP Petrol Pump, Pimpri' },
    { vehicleId: 'VEH0005', litres: 39.8, rate: 89.2, station: 'IOCL, Nigdi' },
    { vehicleId: 'VEH0006', litres: 96.3, rate: 89.7, station: 'BPCL, Wakad' },
    { vehicleId: 'VEH0008', litres: 14.6, rate: 78.5, station: 'MNGL Station, Kothrud' },
  ];
  fuelDefs.forEach((f, i) => {
    const daysAgo = (i * 3) % 20;
    db.fuel.push({
      id: `FUL${String(i + 1).padStart(4, '0')}`,
      ...f,
      date: isoDate(-daysAgo),
      amount: Number((f.litres * f.rate).toFixed(2)),
      odometer: db.vehicles.find((v) => v.id === f.vehicleId).odometer - daysAgo * 118,
      paymentMode: i % 3 === 0 ? 'fuel-card' : 'cash',
      loggedBy: 'USR0002',
      createdAt: stamp(),
      updatedAt: stamp(),
    });
  });

  const docTypes = [
    { type: 'insurance', label: 'Comprehensive Insurance' },
    { type: 'permit', label: 'State Transport Permit' },
    { type: 'puc', label: 'Pollution Under Control' },
    { type: 'fitness', label: 'Fitness Certificate' },
  ];
  let docSeq = 0;
  for (const vehicle of db.vehicles) {
    for (const dt of docTypes) {
      docSeq += 1;
      const expiryField = { insurance: 'insuranceExpiry', permit: 'permitExpiry', puc: 'pucExpiry', fitness: 'fitnessExpiry' }[dt.type];
      db.documents.push({
        id: `DOC${String(docSeq).padStart(4, '0')}`,
        vehicleId: vehicle.id,
        type: dt.type,
        title: dt.label,
        number: `${dt.type.slice(0, 3).toUpperCase()}-${vehicle.regNo.replace(/-/g, '').slice(-6)}`,
        issuedBy: dt.type === 'insurance' ? 'ICICI Lombard' : 'Government of Maharashtra',
        issueDate: isoDate(-330),
        expiryDate: vehicle[expiryField],
        fileRef: `vault/${vehicle.regNo}/${dt.type}.pdf`,
        status: 'valid',
        createdAt: stamp(),
        updatedAt: stamp(),
      });
    }
  }

  const incidentDefs = [
    { vehicleId: 'VEH0004', type: 'breakdown', severity: 'high', description: 'Clutch failure en route to Plant Gate 3, 9 employees transferred to backup van.', status: 'open', daysAgo: 3 },
    { vehicleId: 'VEH0006', type: 'delay', severity: 'low', description: 'Traffic diversion at Kharadi added 35 minutes to morning pickup.', status: 'closed', daysAgo: 8 },
    { vehicleId: 'VEH0002', type: 'accident', severity: 'medium', description: 'Minor rear-end contact at Wakad signal. No injuries. Insurance claim filed.', status: 'under-review', daysAgo: 26 },
    { vehicleId: 'VEH0008', type: 'complaint', severity: 'low', description: 'Employee complaint about AC not working on evening drop.', status: 'closed', daysAgo: 15 },
  ];
  incidentDefs.forEach((inc, i) => {
    db.incidents.push({
      id: `INC${String(i + 1).padStart(4, '0')}`,
      ...inc,
      date: isoDate(-inc.daysAgo),
      routeId: db.routes[i % db.routes.length].id,
      reportedBy: 'USR0002',
      actionTaken: inc.status === 'closed' ? 'Resolved and verified by transport supervisor.' : 'Assigned to vendor for corrective action.',
      createdAt: stamp(),
      updatedAt: stamp(),
    });
  });

  const expenseCats = ['driver-salary', 'vendor-hire', 'fuel', 'maintenance', 'toll', 'insurance', 'misc'];
  let expSeq = 0;
  for (let monthOffset = 2; monthOffset >= 0; monthOffset--) {
    for (const cat of expenseCats) {
      expSeq += 1;
      const base = { 'driver-salary': 218000, 'vendor-hire': 385000, fuel: 142000, maintenance: 74500, toll: 18600, insurance: 42300, misc: 12700 }[cat];
      db.expenses.push({
        id: `EXP${String(expSeq).padStart(4, '0')}`,
        month: isoDate(-(monthOffset * 30)).slice(0, 7),
        category: cat,
        description: `${cat.replace(/-/g, ' ')} expense`,
        amount: Math.round(base * (1 + (monthOffset * 0.03) + (expSeq % 7) * 0.01)),
        vendorId: cat === 'vendor-hire' ? 'VEN0001' : null,
        status: monthOffset === 0 ? 'pending' : 'paid',
        approvedBy: monthOffset === 0 ? null : 'USR0001',
        createdAt: stamp(),
        updatedAt: stamp(),
      });
    }
  }

  db.auditLog.push({
    id: 'AUD0001',
    actor: 'system',
    action: 'database.seeded',
    detail: 'Initial demo dataset generated',
    at: stamp(),
  });

  return db;
}

/**
 * Initialise the data store.
 *
 * On hosts with ephemeral disks the local file may be empty on every boot, so
 * an optional remote copy (S3-compatible) is restored BEFORE the store reads
 * the file. If no remote is configured this is a fast, silent no-op.
 *
 * Async because the restore is a network call. Call `initStore()` once, before
 * serving requests or seeding.
 */
let _storeInitError = null;

/**
 * The store object is created SYNCHRONOUSLY at module load.
 *
 * All fifteen route modules do `const { store } = require('../db/schema')` at
 * import time, so the object must already exist by then. Construction no longer
 * touches the disk - the JsonStore constructor only records the file path and
 * defers the actual read until the first `.data` access (see store.js).
 *
 * That deferral is what makes the async remote restore safe: initStore() awaits
 * the restore and only afterwards does anything read the file. Without it we
 * would load a blank ephemeral disk and then mirror that blank state back over
 * the good remote copy, destroying the customer's data.
 */
const store = new JsonStore(config.databaseFile, EMPTY_DATABASE);

async function initStore() {
  if (store._initialised) return store;
  store._initialised = true;

  const remote = createUploader(config.databaseFile);
  // Attach before the restore so any write triggered by it is mirrored.
  store.remote = remote;

  const restoreResult = await remoteRestore(config.databaseFile);

  if (restoreResult === 'restored') {
    console.log(`[db] Restored latest data from remote storage (${config.databaseFile}).`);
  } else if (restoreResult === 'error') {
    _storeInitError = 'Remote restore failed; started from local file.';
  } else if (remote.isEnabled) {
    console.log('[db] Remote storage configured but no remote copy found yet.');
  }

  return store;
}

function getStore() {
  return store;
}

module.exports.initStoreError = () => _storeInitError;

/** Populate demo data on very first boot (or when explicitly forced). */
function seedIfEmpty(force = false) {
  const s = getStore();
  const isEmpty = s.collection('users').length === 0;
  if (isEmpty || force) {
    const data = buildSeed();
    for (const key of Object.keys(data)) s.data[key] = data[key];
    s.save();
    return true;
  }
  return false;
}

module.exports.store = store;
module.exports.getStore = getStore;
module.exports.initStore = initStore;
module.exports.seedIfEmpty = seedIfEmpty;
module.exports.EMPTY_DATABASE = EMPTY_DATABASE;
