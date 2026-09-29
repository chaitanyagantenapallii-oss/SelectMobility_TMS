'use strict';

/**
 * Database schema definition + initial seed data.
 *
 * Collections:
 *   users         - application logins (admin / operations / viewer)
 *   organisations - corporate client companies the shuttle service is billed to
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
 *   vehicleLocations - driver position pings, newest last
 *   trackingState - one row per vehicle holding its most recent position
 *   settings      - desk-wide key/value settings (map tiles)
 */

const { JsonStore } = require('./store');
const supabaseBackup = require('./supabase-backup');
const d1Backup = require('./d1-backup');
const s3Backup = require('./remote-backup');
const config = require('../config');
const { hashPassword } = require('../utils/password');

const EMPTY_DATABASE = {
  users: [],
  organisations: [],
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
  // Raised from the client app and worked through by the transport desk.
  serviceRequests: [],
  // Driver position pings (append-only, pruned) and the latest state per
  // vehicle, so the desk live view is one cheap pass rather than a scan of
  // every ping ever recorded.
  vehicleLocations: [],
  trackingState: [],
  // Desk-wide key/value settings, currently just the map tile provider.
  settings: [],
  invoices: [],
  commercials: [],
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
    accountType: 'demo',
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
    accountType: 'demo',
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

  /*
   * `stops` stays a plain array of names because the roster and every existing
   * screen match staff to stops by name. `stopPoints` carries the same stops
   * with real positions, which is what the tracking map plots when no map tile
   * key has been supplied - so the desk can still see which stop a bus is near.
   */
  const routeDefs = [
    {
      code: 'R-01',
      name: 'Hinjewadi - Wakad Corridor',
      shiftId: 'SHF0001',
      distanceKm: 24.5,
      stops: ['Wakad Chowk', 'Datta Mandir', 'Hinjewadi Phase 1', 'Blue Ridge Gate', 'Plant Gate 2'],
      stopPoints: [
        { name: 'Wakad Chowk', lat: 18.5983, lon: 73.7625 },
        { name: 'Datta Mandir', lat: 18.6055, lon: 73.7490 },
        { name: 'Hinjewadi Phase 1', lat: 18.5915, lon: 73.7100 },
        { name: 'Blue Ridge Gate', lat: 18.5850, lon: 73.6990 },
        { name: 'Plant Gate 2', lat: 18.6275, lon: 73.7420 },
      ],
    },
    {
      code: 'R-02',
      name: 'Kothrud - Warje Corridor',
      shiftId: 'SHF0001',
      distanceKm: 19.2,
      stops: ['Kothrud Depot', 'Karve Nagar', 'Warje Bridge', 'Plant Gate 1'],
      stopPoints: [
        { name: 'Kothrud Depot', lat: 18.5074, lon: 73.8077 },
        { name: 'Karve Nagar', lat: 18.4900, lon: 73.8180 },
        { name: 'Warje Bridge', lat: 18.4830, lon: 73.7990 },
        { name: 'Plant Gate 1', lat: 18.5300, lon: 73.8450 },
      ],
    },
    {
      code: 'R-03',
      name: 'Pimpri - Chinchwad Corridor',
      shiftId: 'SHF0002',
      distanceKm: 27.8,
      stops: ['Pimpri Chowk', 'Chinchwad Station', 'Nigdi', 'Bhakti Shakti', 'Plant Gate 3'],
      stopPoints: [
        { name: 'Pimpri Chowk', lat: 18.6280, lon: 73.8000 },
        { name: 'Chinchwad Station', lat: 18.6410, lon: 73.7950 },
        { name: 'Nigdi', lat: 18.6510, lon: 73.7620 },
        { name: 'Bhakti Shakti', lat: 18.6580, lon: 73.7530 },
        { name: 'Plant Gate 3', lat: 18.6275, lon: 73.7420 },
      ],
    },
    {
      code: 'R-04',
      name: 'Hadapsar - Magarpatta Corridor',
      shiftId: 'SHF0001',
      distanceKm: 22.1,
      stops: ['Hadapsar Gadital', 'Magarpatta Gate', 'Kharadi Bypass', 'Plant Gate 2'],
      stopPoints: [
        { name: 'Hadapsar Gadital', lat: 18.5089, lon: 73.9260 },
        { name: 'Magarpatta Gate', lat: 18.5150, lon: 73.9280 },
        { name: 'Kharadi Bypass', lat: 18.5520, lon: 73.9430 },
        { name: 'Plant Gate 2', lat: 18.6275, lon: 73.7420 },
      ],
    },
    {
      code: 'R-05',
      name: 'Katraj - Swargate Night',
      shiftId: 'SHF0003',
      distanceKm: 31.4,
      stops: ['Katraj Chowk', 'Bibwewadi', 'Swargate', 'Shivajinagar', 'Plant Gate 1'],
      stopPoints: [
        { name: 'Katraj Chowk', lat: 18.4530, lon: 73.8570 },
        { name: 'Bibwewadi', lat: 18.4750, lon: 73.8630 },
        { name: 'Swargate', lat: 18.5010, lon: 73.8580 },
        { name: 'Shivajinagar', lat: 18.5310, lon: 73.8470 },
        { name: 'Plant Gate 1', lat: 18.5300, lon: 73.8450 },
      ],
    },
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

  /* ------------------------------------------------------------------------
     Mobile app accounts
     Added after drivers and employees exist so they can be linked by id.
     Client organisations let the Client app's scoping be seen working:
     a client account must never see another company's staff.
     ------------------------------------------------------------------------ */

  /*
   * Companies are real records now, not loose strings, so the desk can onboard
   * a new corporate customer without a code change. `name` is the join key the
   * employees and client logins below store, so it must match exactly.
   */
  db.organisations.push(
    {
      id: 'ORG0001',
      name: 'Bharat Forge Ltd',
      code: 'BFL',
      industry: 'Forging & Auto Components',
      status: 'active',
      contactName: 'Kavita Rao',
      contactRole: 'Facilities Manager',
      contactPhone: '+91 98220 41155',
      contactEmail: 'kavita.rao@bharatforge.example',
      address: 'Mundhwa, Pune - 411036',
      city: 'Pune, Maharashtra, India',
      gstin: '27AAACB1234C1Z5',
      billingCycle: 'monthly',
      contractTill: isoDate(210),
      ratePerTrip: 1850,
      dailyPackageRate: 48000,
      operatingDaysPerMonth: 22,
      includedSedanTripsPerDay: 3,
      extraSedanTripRate: 600,
      gstRate: 18,
      notes: 'Two shifts served. Gate 3 is the primary boarding point.',
      contacts: [
        { name: 'Kavita Rao', role: 'Facilities Manager', email: 'kavita.rao@bharatforge.example', phone: '+91 98220 41155' },
      ],
      createdAt: stamp(-90000),
      updatedAt: stamp(-90000),
    },
    {
      id: 'ORG0002',
      name: 'Kirloskar Pneumatic',
      code: 'KPC',
      industry: 'Industrial Machinery',
      status: 'active',
      contactName: 'Sandeep Joshi',
      contactRole: 'Admin Head',
      contactPhone: '+91 98814 22907',
      contactEmail: 'sandeep.joshi@kirloskar.example',
      address: 'Hadapsar Industrial Estate, Pune - 411013',
      city: 'Pune, Maharashtra, India',
      gstin: '27AAACK7788D1Z2',
      billingCycle: 'monthly',
      contractTill: isoDate(95),
      ratePerTrip: 1720,
      notes: 'Evening drop only on the Wakad corridor.',
      contacts: [
        { name: 'Sandeep Joshi', role: 'Admin Head', email: 'sandeep.joshi@kirloskar.example', phone: '+91 98814 22907' },
      ],
      createdAt: stamp(-88000),
      updatedAt: stamp(-88000),
    },
  );

  // Tag employees with a company so the Client app has something to scope.
  const CLIENT_ORGS = db.organisations.map((o) => o.name);
  db.employees.forEach((emp, i) => {
    emp.organisation = CLIENT_ORGS[i % CLIENT_ORGS.length];
  });

  const firstDriver = db.drivers[0];
  if (firstDriver) {
    // Link the demo driver to a user account so the Driver app can sign in.
    db.users.push({
      id: 'USR0003',
      name: firstDriver.name,
      email: 'driver@selectmobility.in',
      role: 'driver',
      driverId: firstDriver.id,
      passwordHash: hashPassword('Driver@2026'),
      status: 'active',
      createdAt: stamp(),
      updatedAt: stamp(),
    });
    firstDriver.userId = 'USR0003';
  }

  db.users.push({
    id: 'USR0004',
    name: 'Kavita Rao',
    email: 'client@selectmobility.in',
    role: 'client',
    organisation: CLIENT_ORGS[0],
    passwordHash: hashPassword('Client@2026'),
    status: 'active',
    accountType: 'demo',
    createdAt: stamp(),
    updatedAt: stamp(),
  });

  // A real open request so the Client app is not empty on first run.
  //
  // `kind: 'general'` and `status: 'pending'` match what the Client app now
  // writes. It was seeded as 'open', which the new request workflow does not
  // recognise, so the desk's request list would have shown a status it could not
  // filter or act on.
  db.serviceRequests.push({
    id: 'SRQ0001',
    organisation: CLIENT_ORGS[0],
    raisedBy: 'client@selectmobility.in',
    raisedByName: 'Kavita Rao',
    kind: 'general',
    category: 'new-employee',
    priority: 'normal',
    subject: 'Add two new joiners to the S1 pickup',
    detail: 'Two quality engineers join on the 1st and will need the Hadapsar pickup at 07:05.',
    status: 'pending',
    response: '',
    createdAt: stamp(),
    updatedAt: stamp(),
  });

  // Bharat Forge scale simulation: enough data to exercise pagination,
  // allocation, KYC, tracking and billing screens without using fake KPI math.
  const bharatForge = CLIENT_ORGS[0];
  const vehicleModels = ['Maruti Ertiga', 'Toyota Rumion', 'Kia Carens', 'Force Traveller 17', 'Tata Winger'];
  const vendorNames = ['Apex Mobility', 'BlueLine Travels', 'CityRide Fleet', 'Deccan Transport', 'Elite Commute'];
  while (db.vendors.length < 50) {
    const n = db.vendors.length + 1;
    db.vendors.push({ id: `VEN${String(n).padStart(4, '0')}`, name: `${vendorNames[n % vendorNames.length]} ${String(n).padStart(2, '0')}`, contact: `Vendor Manager ${n}`, phone: `+91 98${String(20000000 + n * 137).slice(0, 8)}`, gstin: `27AA${String(1000000 + n).slice(0, 7)}P1Z5`, rating: Number((3.6 + (n % 14) / 10).toFixed(1)), status: n % 17 === 0 ? 'onboarding' : 'active', contractTill: isoDate(120 + n * 5), createdAt: stamp(), updatedAt: stamp() });
  }
  while (db.vehicles.length < 200) {
    const n = db.vehicles.length + 1;
    const vendor = db.vendors[(n - 1) % db.vendors.length];
    db.vehicles.push({ id: `VEH${String(n).padStart(4, '0')}`, regNo: `MH-${n % 2 ? '12' : '14'}-${String.fromCharCode(65 + (n % 26))}${String.fromCharCode(65 + ((n + 7) % 26))}-${String(1000 + n).slice(-4)}`, model: vehicleModels[n % vehicleModels.length], type: 'car', seats: 4, vendorId: vendor.id, fuelType: n % 9 === 0 ? 'electric' : n % 4 === 0 ? 'cng' : 'diesel', status: n % 23 === 0 ? 'maintenance' : n % 19 === 0 ? 'idle' : 'active', ownership: 'contract', odometer: 28000 + n * 613, insuranceExpiry: isoDate(30 + n % 270), permitExpiry: isoDate(60 + n % 210), pucExpiry: isoDate(20 + n % 150), fitnessExpiry: isoDate(120 + n % 300), createdAt: stamp(), updatedAt: stamp() });
  }
  while (db.drivers.length < 200) {
    const n = db.drivers.length + 1;
    const vehicle = db.vehicles[(n - 1) % db.vehicles.length];
    db.drivers.push({ id: `DRV${String(n).padStart(4, '0')}`, name: `Driver ${String(n).padStart(3, '0')}`, phone: `+91 97${String(30000000 + n * 173).slice(0, 8)}`, licenceNo: `MH12${String(201500000000 + n)}`, licenceExpiry: isoDate(90 + n % 500), badge: `BF-BDG-${String(n).padStart(4, '0')}`, vendorId: vehicle.vendorId, assignedVehicleId: vehicle.id, experience: 3 + n % 18, address: 'Pune, Maharashtra', status: n % 31 === 0 ? 'on-leave' : 'active', createdAt: stamp(), updatedAt: stamp() });
  }
  while (db.employees.length < 450) {
    const n = db.employees.length + 1;
    const route = db.routes[(n - 1) % db.routes.length];
    db.employees.push({ id: `EMP${String(n).padStart(5, '0')}`, code: `BF${String(n).padStart(4, '0')}`, name: `Bharat Forge Staff ${String(n).padStart(3, '0')}`, email: `staff${n}@bharatforge.example`, phone: `+91 96${String(40000000 + n * 149).slice(0, 8)}`, department: ['Operations', 'Quality', 'Engineering', 'Finance', 'HR'][n % 5], organisation: bharatForge, routeId: route.id, shiftId: route.shiftId, stop: route.stops[n % route.stops.length], status: n % 29 === 0 ? 'inactive' : 'active', emergencyContact: `+91 95${String(50000000 + n * 101).slice(0, 8)}`, createdAt: stamp(), updatedAt: stamp() });
  }
  // A traceable request-to-invoice sample: 24 requests, 24 allocated trips,
  // completed bookings and monthly invoice rows for the client dashboard.
  for (let n = 2; n <= 25; n += 1) db.serviceRequests.push({ id: `SRQ${String(n).padStart(4, '0')}`, organisation: bharatForge, raisedBy: 'client@selectmobility.in', raisedByName: 'Kavita Rao', kind: 'adhoc', category: 'employee-transport', priority: n % 7 === 0 ? 'high' : 'normal', subject: `Ad-hoc staff transport request ${n}`, detail: 'Generated workflow test request for Bharat Forge.', status: n <= 4 ? 'pending' : 'approved', createdAt: stamp(-n * 90), updatedAt: stamp(-n * 60) });
  const bfEmployees = db.employees.filter((e) => e.organisation === bharatForge && e.status === 'active');
  for (let n = 0; n < 24; n += 1) {
    const tripId = `BFT${String(n + 1).padStart(4, '0')}`;
    const route = db.routes[n % db.routes.length];
    const vehicle = db.vehicles[n % db.vehicles.length];
    const driver = db.drivers[n % db.drivers.length];
    const tripDate = isoDate(-(n % 18));
    const trip = { id: tripId, date: tripDate, shiftId: route.shiftId, routeId: route.id, vehicleId: vehicle.id, driverId: driver.id, departureAt: `${tripDate} 07:00:00`, arrivalAt: `${tripDate} 08:15:00`, plannedKm: route.distanceKm * 2, actualKm: Number((route.distanceKm * 2.04).toFixed(1)), fuelCost: Math.round(route.distanceKm * 2 * 11.8), tollCost: 120, passengersAllocated: 0, passengersBoarded: 0, status: n < 2 ? 'in-progress' : 'completed', notes: '', organisation: bharatForge, billingRate: 1850, createdAt: stamp(-n * 90), updatedAt: stamp(-n * 60) };
    db.trips.push(trip);
    const riders = bfEmployees.slice((n * 7) % Math.max(1, bfEmployees.length - 8), ((n * 7) % Math.max(1, bfEmployees.length - 8)) + 8);
    riders.forEach((emp, i) => { const bookingId = `BFB${String(n * 10 + i + 1).padStart(5, '0')}`; db.bookings.push({ id: bookingId, tripId, employeeId: emp.id, stop: emp.stop, status: trip.status === 'completed' ? 'completed' : 'confirmed', createdAt: stamp(-n * 90), updatedAt: stamp(-n * 60) }); });
    trip.passengersAllocated = riders.length; trip.passengersBoarded = trip.status === 'completed' ? riders.length - (n % 5 === 0 ? 1 : 0) : 0;
  }
  for (let month = 0; month < 3; month += 1) db.invoices.push({ id: `INV-BF-${String(month + 1).padStart(3, '0')}`, organisation: bharatForge, period: isoDate(-(month * 30)).slice(0, 7), status: month === 0 ? 'draft' : 'paid', includedTrips: 66, additionalTrips: month === 0 ? 0 : 12, dailyPackageRate: 48000, operatingDays: 22, extraTripRate: 600, baseAmount: 1056000, extraAmount: month === 0 ? 0 : 7200, subtotal: month === 0 ? 1056000 : 1063200, gstRate: 18, gstAmount: month === 0 ? 190080 : 191376, total: month === 0 ? 1246080 : 1254576, createdAt: stamp(-month * 30 * 24 * 60), dueAt: isoDate(15 - month * 30) });
  db.commercials.push({ id: 'COM0001', name: 'Bharat Forge sedan monthly package', type: 'client', organisation: bharatForge, vehicleType: 'sedan', operatingDays: 22, includedTripsPerDay: 3, monthlyRate: 60000, extraTripRate: 900, vendorCost: 48000, vendorExtraTripRate: 600, gstRate: 18, status: 'active', createdAt: stamp(), updatedAt: stamp() });

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

  const backup = supabaseBackup.isEnabled()
    ? supabaseBackup
    : (d1Backup.isEnabled() ? d1Backup : s3Backup);
  const remote = backup.createUploader(config.databaseFile);
  // Attach before the restore so any write triggered by it is mirrored.
  store.remote = remote;

  const restoreResult = await backup.restore(config.databaseFile);

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
    ensureLiveAdmin(s);
    ensureConfiguredAdmin(s);
    ensureDemoAccounts(s);
    ensureSmiplMasterAdmin(s);
    s.save();
    return true;
  }
  ensureLiveAdmin(s);
  ensureConfiguredAdmin(s);
  ensureDemoAccounts(s);
  ensureSmiplMasterAdmin(s);
  return false;
}

/** Keep the SMIPL tenant master login available after every deployment. */
function ensureSmiplMasterAdmin(s) {
  const email = 'admin@selectmobility.in';
  let user = s.find('users', (u) => String(u.email || '').toLowerCase() === email);
  const org = s.find('organisations', (o) => o.name === 'Bharat Forge Ltd');
  const patch = {
    name: 'SMIPL Master Administrator', email, role: 'admin',
    organisation: org ? org.name : null, status: 'active',
    passwordHash: hashPassword('Admin@2026'), accountType: 'tenant-admin',
    updatedAt: new Date().toISOString(),
  };
  if (user) {
    Object.assign(user, patch);
  } else {
    s.data.users.push({ id: s.nextId('users', 'USR'), ...patch, createdAt: new Date().toISOString() });
  }
  s.save();
  return true;
}

/** Keep the platform administrator aligned with the configured platform login. */
function ensureConfiguredAdmin(s) {
  const email = String(config.admin.email || '').trim().toLowerCase();
  if (!email) return false;
  // Keep the provider administrator separate from the SMIPL tenant administrator.
  // The old fallback matched the SMIPL account and rewrote it as the platform user.
  let admin = s.find('users', (u) => u.role === 'admin' && (
    String(u.email || '').toLowerCase() === email || u.accountType === 'platform'
  ));
  if (!admin) return false;
  const changed = admin.email !== email || admin.passwordHash !== hashPassword(config.admin.password);
  admin.email = email;
  admin.passwordHash = hashPassword(config.admin.password);
  admin.name = config.admin.name;
  admin.accountType = 'platform';
  admin.updatedAt = new Date().toISOString();
  if (changed) s.save();
  return changed;
}

function ensureDemoAccounts(s) {
  const demoEmails = new Set([
    'admin@selectmobility.in', 'ops@selectmobility.in',
    'driver@selectmobility.in', 'client@selectmobility.in',
  ]);
  let changed = false;
  s.collection('users').forEach((user) => {
    if (demoEmails.has(String(user.email || '').toLowerCase()) && user.accountType !== 'demo') {
      user.accountType = 'demo';
      changed = true;
    }
  });
  if (changed) s.save();
  return changed;
}

/** Provision a separate live administrator without replacing demo accounts. */
function ensureLiveAdmin(s) {
  const live = config.liveAdmin;
  if (!live.email || !live.password) return false;
  const email = live.email.trim().toLowerCase();
  const existing = s.find('users', (u) => u.email.toLowerCase() === email);
  if (existing) return false;
  s.data.users.push({
    id: s.nextId('users', 'USR'),
    name: live.name,
    email,
    role: 'admin',
    passwordHash: hashPassword(live.password),
    status: 'active',
    accountType: 'live',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return true;
}

module.exports.store = store;
module.exports.getStore = getStore;
module.exports.initStore = initStore;
module.exports.seedIfEmpty = seedIfEmpty;
module.exports.EMPTY_DATABASE = EMPTY_DATABASE;
