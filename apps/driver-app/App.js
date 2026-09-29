/**
 * SMI Driver - React Native app.
 *
 * Screens: sign in, Today, Manifest, History, Log (breakdown + fuel), Me.
 *
 * This mirrors client/js/driver-app.js deliberately, down to the field names
 * and the two guards that matter: a passenger is only marked boarded after the
 * server confirms it, and a closing odometer below the starting reading is
 * refused before it is sent. Anything the web app learned the hard way is
 * carried across rather than rediscovered.
 *
 * No navigation library. The app has five screens and no deep links worth
 * preserving, so a `screen` string in state is simpler than a router and keeps
 * the dependency list to Expo's own packages.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

import {
  ApiError,
  driverApi,
  api,
  clearSession,
  getUser,
  restoreSession,
} from './src/api';
import {
  colors,
  spacing,
  TAP_TARGET,
  date,
  num,
  statusColor,
  statusLabel,
} from './src/theme';
import SignIn from './src/SignIn';
import { useTripTracking } from './src/tracking';

const TABS = [
  { key: 'today', label: 'Today' },
  { key: 'history', label: 'History' },
  { key: 'log', label: 'Log' },
  { key: 'me', label: 'Me' },
];

export default function App() {
  const [booting, setBooting] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [tab, setTab] = useState('today');
  const [openTripId, setOpenTripId] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const had = await restoreSession();
      if (!alive) return;
      // A saved token for the wrong role would show this user a screen full of
      // errors, so treat it as signed out rather than half-signed in.
      const u = getUser();
      setSignedIn(had && (!u.role || u.role === 'driver' || u.role === 'admin'));
      setBooting(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const signOut = useCallback(async () => {
    await clearSession();
    setOpenTripId(null);
    setTab('today');
    setSignedIn(false);
  }, []);

  if (booting) {
    return (
      <View style={[styles.fill, styles.centre]}>
        <ActivityIndicator color={colors.brand} size="large" />
      </View>
    );
  }

  if (!signedIn) {
    return (
      <>
        <StatusBar style="light" />
        <SignIn
          title="Driver sign in"
          subtitle="Select Mobility"
          onSignedIn={setSignedIn}
        />
      </>
    );
  }

  return (
    <View style={styles.fill}>
      <StatusBar style="light" />
      <Header
        title={openTripId ? 'Manifest' : TAB_TITLES[tab]}
        subtitle={getUser()?.name || 'Driver'}
        onBack={openTripId ? () => setOpenTripId(null) : null}
        onSignOut={signOut}
      />

      <View style={styles.fill}>
        {openTripId ? (
          <ManifestScreen tripId={openTripId} onClose={() => setOpenTripId(null)} />
        ) : (
          <>
            {tab === 'today' && <TodayScreen onOpenTrip={setOpenTripId} />}
            {tab === 'history' && <HistoryScreen onOpenTrip={setOpenTripId} />}
            {tab === 'log' && <LogScreen />}
            {tab === 'me' && <MeScreen onSignOut={signOut} />}
          </>
        )}
      </View>

      {!openTripId && (
        <TabBar tab={tab} onChange={setTab} />
      )}
    </View>
  );
}

const TAB_TITLES = {
  today: "Today's trip",
  history: 'My history',
  log: 'Log something',
  me: 'My details',
};

/* --- Chrome -------------------------------------------------------------- */

function Header({ title, subtitle, onBack, onSignOut }) {
  return (
    <View style={styles.header}>
      {onBack ? (
        <TouchableOpacity onPress={onBack} style={styles.headerBtn} accessibilityLabel="Back">
          <Text style={styles.headerBtnText}>{'\u2190'}</Text>
        </TouchableOpacity>
      ) : null}
      <View style={styles.fill}>
        <Text style={styles.headerTitle}>{title}</Text>
        <Text style={styles.headerSub}>{subtitle}</Text>
      </View>
      {onSignOut ? (
        <TouchableOpacity onPress={onSignOut} style={styles.headerBtn} accessibilityLabel="Sign out">
          <Text style={styles.headerBtnText}>{'\u2192'}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function TabBar({ tab, onChange }) {
  return (
    <View style={styles.tabbar}>
      {TABS.map((t) => (
        <TouchableOpacity
          key={t.key}
          style={styles.tab}
          onPress={() => onChange(t.key)}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === t.key }}
        >
          <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
          {tab === t.key && <View style={styles.tabUnderline} />}
        </TouchableOpacity>
      ))}
    </View>
  );
}

function Card({ children, style }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

function Busy({ label = 'Loading' }) {
  return (
    <View style={styles.busy}>
      <ActivityIndicator color={colors.brand} />
      <Text style={styles.busyText}>{label}</Text>
    </View>
  );
}

function Empty({ title, text }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

function ErrorBox({ message, onRetry }) {
  return (
    <Card>
      <Text style={styles.errTitle}>Something went wrong</Text>
      <Text style={styles.errText}>{message}</Text>
      {onRetry && (
        <TouchableOpacity style={styles.btn} onPress={onRetry}>
          <Text style={styles.btnText}>Try again</Text>
        </TouchableOpacity>
      )}
    </Card>
  );
}

function Badge({ status }) {
  const c = statusColor(status);
  return (
    <View style={[styles.badge, { backgroundColor: `${c}22` }]}>
      <Text style={[styles.badgeText, { color: c }]}>{statusLabel(status)}</Text>
    </View>
  );
}

/**
 * A small wrapper that owns the load/refresh/error cycle.
 *
 * Every screen in this app does the same three things - fetch on mount, pull
 * to refresh, surface an error with a retry - so it is written once here. The
 * alternative is five copies that drift apart.
 */
function useLoader(load) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const run = useCallback(
    async (isRefresh) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      try {
        setData(await load());
        setError(null);
      } catch (err) {
        // A 401 is handled by clearing the session; the sign-in screen will
        // take over, so there is nothing useful to show here.
        if (!(err instanceof ApiError) || err.status !== 401) {
          setError(err.message || 'Could not load.');
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [load]
  );

  useEffect(() => {
    run(false);
  }, [run]);

  return { data, setData, error, loading, refreshing, refresh: () => run(true), reload: () => run(false) };
}

function Screen({ state, children }) {
  if (state.loading && !state.data) return <Busy />;
  if (state.error && !state.data) return <ErrorBox message={state.error} onRetry={state.reload} />;
  return (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={styles.scrollBody}
      refreshControl={
        <RefreshControl refreshing={state.refreshing} onRefresh={state.refresh} tintColor={colors.brand} />
      }
    >
      {state.error ? <ErrorBox message={`${state.error} Showing what we last downloaded.`} /> : null}
      {children}
    </ScrollView>
  );
}

/* --- Today --------------------------------------------------------------- */

function TodayScreen({ onOpenTrip }) {
  const state = useLoader(useCallback(() => driverApi.me(), []));

  if (state.loading && !state.data) return <Busy />;
  if (state.error && !state.data) return <ErrorBox message={state.error} onRetry={state.reload} />;

  const live = state.data?.today || [];
  const upcoming = state.data?.upcoming || [];

  return (
    <Screen state={state}>
      {!live.length && !upcoming.length ? (
        <Empty
          title="No trips assigned"
          text="Nothing is scheduled for you yet. The office assigns trips from the desk."
        />
      ) : null}

      {live.length > 0 && <Text style={styles.sectionLabel}>On now</Text>}
      {live.map((t) => (
        <TripCard key={t.id} trip={t} onPress={() => onOpenTrip(t.id)} />
      ))}

      {upcoming.length > 0 && <Text style={styles.sectionLabel}>Coming up</Text>}
      {upcoming.map((t) => (
        <TripCard key={t.id} trip={t} onPress={() => onOpenTrip(t.id)} />
      ))}
    </Screen>
  );
}

function TripCard({ trip, onPress }) {
  const p = trip.passengers || { allocated: 0, boarded: 0, noShow: 0 };
  const outstanding = Math.max(0, p.allocated - p.boarded - p.noShow);
  const pct = p.allocated ? Math.min(1, p.boarded / p.allocated) : 0;

  return (
    <TouchableOpacity style={styles.trip} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.tripTop}>
        <Text style={styles.tripRoute} numberOfLines={1}>
          {trip.route.name}
        </Text>
        <Badge status={trip.status} />
      </View>
      <Text style={styles.tripMeta}>
        {trip.shift.pickupStart}
        {'\u2013'}
        {trip.shift.pickupEnd} {'\u00B7'} {trip.vehicle.regNo} {'\u00B7'} {date(trip.date)}
      </Text>
      <Text style={styles.tripCount}>
        <Text style={styles.tripCountNum}>{p.boarded}</Text> of {p.allocated} boarded
        {outstanding ? ` \u00B7 ${outstanding} still to go` : ''}
      </Text>
      <View style={styles.bar}>
        <View style={[styles.barFill, { width: `${Math.round(pct * 100)}%` }]} />
      </View>
    </TouchableOpacity>
  );
}

/* --- Manifest ------------------------------------------------------------ */

/**
 * A quiet line telling the driver that the office can see them.
 *
 * Worth showing: a driver who does not know they are being tracked assumes
 * either that they are not (and may not worry about a failed permission) or
 * that they are being watched without being told. Saying so plainly, and
 * showing when the last position actually went, is the honest version.
 */
function TrackingBanner({ tracking }) {
  const { reporting, lastAt, lastError, sent } = tracking;

  if (lastError) {
    return (
      <View style={styles.trackBannerWarn}>
        <Text style={styles.trackTextWarn}>{lastError}</Text>
      </View>
    );
  }
  if (!reporting) {
    return (
      <View style={styles.trackBannerWarn}>
        <Text style={styles.trackTextWarn}>Starting location sharing...</Text>
      </View>
    );
  }

  return (
    <View style={styles.trackBanner}>
      <View style={styles.trackDot} />
      <Text style={styles.trackText}>
        Sharing this vehicle's location with the office
        {lastAt ? ` \u00B7 last sent ${lastAt.toLocaleTimeString('en-IN', { hour12: false })}` : ''}
        {sent ? ` \u00B7 ${sent} update${sent === 1 ? '' : 's'}` : ''}
      </Text>
    </View>
  );
}

function ManifestScreen({ tripId, onClose }) {
  const state = useLoader(useCallback(() => driverApi.trip(tripId), [tripId]));
  const [busyBooking, setBusyBooking] = useState(null);

  /**
   * Mark one passenger. The server is told first and the UI follows, never
   * the other way round - a driver who believes they boarded somebody the
   * server never heard about is worse off than one who sees an error.
   */
  const toggle = useCallback(
    async (person) => {
      const on = person.status === 'completed' || person.status === 'boarded';
      const next = on ? 'confirmed' : 'completed';
      setBusyBooking(person.bookingId);
      try {
        await driverApi.attendance(tripId, [{ bookingId: person.bookingId, status: next }]);
        state.reload();
      } catch (err) {
        Alert.alert('Could not update', err.message);
      } finally {
        setBusyBooking(null);
      }
    },
    [tripId, state]
  );

  if (state.loading && !state.data) return <Busy />;
  if (state.error && !state.data) return <ErrorBox message={state.error} onRetry={state.reload} />;

  const t = state.data.trip;
  const pax = state.data.passengers || [];
  const p = t.passengers || { allocated: 0, boarded: 0, noShow: 0 };

  // Group by stop in the route's own order, because that is the order the
  // driver physically reaches them.
  const order = t.route.stops || [];
  const groups = new Map();
  for (const person of pax) {
    const key = person.stop || 'Unassigned';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(person);
  }
  const stops = [...groups.keys()].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  const open = t.status === 'scheduled';
  const running = t.status === 'in-progress';
  const [acceptBusy, setAcceptBusy] = useState(false);

  const acceptAssignment = async () => {
    setAcceptBusy(true);
    try {
      await driverApi.accept(tripId);
      state.reload();
    } catch (err) {
      Alert.alert('Could not accept assignment', err.message);
    } finally {
      setAcceptBusy(false);
    }
  };

  const requestReassignment = () => {
    Alert.alert(
      'Request reassignment',
      'Ask the SMIPL desk to reassign this trip if you are unavailable.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Request',
          onPress: async () => {
            setAcceptBusy(true);
            try {
              await driverApi.reject(tripId, 'Driver unavailable; reassignment requested from Driver app.');
              state.reload();
            } catch (err) {
              Alert.alert('Could not request reassignment', err.message);
            } finally {
              setAcceptBusy(false);
            }
          },
        },
      ],
    );
  };

  /*
   * Keep the office informed of where this bus is while the trip is running.
   * The hook starts reporting when `running` flips true and stops the moment
   * the driver completes the trip or leaves this screen.
   */
  const tracking = useTripTracking(running, tripId);

  return (
    <Screen state={state}>
      <Card>
        <View style={styles.tripTop}>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {t.route.name}
          </Text>
          <Badge status={t.status} />
        </View>
        {running ? <TrackingBanner tracking={tracking} /> : null}
        <KV k="Date" v={`${date(t.date)}`} />
        <KV k="Shift" v={`${t.shift.name} (${t.shift.pickupStart}\u2013${t.shift.pickupEnd})`} />
        <KV k="Vehicle" v={`${t.vehicle.regNo} \u00B7 ${t.vehicle.model}`} />
        <KV
          k="On board"
          v={`${p.boarded} / ${p.allocated}${p.noShow ? ` \u00B7 ${p.noShow} no-show` : ''}`}
        />
        {t.odometerStart ? <KV k="Odometer at start" v={`${num(t.odometerStart)} km`} /> : null}
        {t.actualKm ? <KV k="Distance run" v={`${num(t.actualKm, 1)} km`} /> : null}
      </Card>

      {open && (
        <>
          {t.driverAcceptance === 'pending' ? (
            <Card>
              <Text style={styles.cardTitle}>Assignment awaiting your response</Text>
              <Text style={styles.muted}>Accept this trip before the start odometer becomes available.</Text>
              <View style={styles.btnRow}>
                <TouchableOpacity style={[styles.btn, styles.btnCancel]} onPress={requestReassignment} disabled={acceptBusy}>
                  <Text style={styles.btnText}>Request reassignment</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btn, styles.btnOk]} onPress={acceptAssignment} disabled={acceptBusy}>
                  {acceptBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnPrimaryText}>Accept assignment</Text>}
                </TouchableOpacity>
              </View>
            </Card>
          ) : null}
          {t.driverAcceptance === 'accepted' ? <StartTrip trip={t} onStart={() => state.reload()} /> : null}
        </>
      )}
      {running && (
        <CloseOutTrip trip={t} tripId={tripId} onDone={() => state.reload()} />
      )}

      {!pax.length ? (
        <Card>
          <Empty title="Nobody booked on this trip" text="No staff are allocated to this route yet." />
        </Card>
      ) : (
        stops.map((stop) => {
          const people = groups.get(stop);
          const done = people.filter((x) => x.status === 'completed' || x.status === 'boarded').length;
          return (
            <Card key={stop}>
              <View style={styles.stopHead}>
                <Text style={styles.stopName}>{stop}</Text>
                <Text style={styles.stopCount}>
                  {done}/{people.length}
                </Text>
              </View>
              {people.map((person) => {
                const on = person.status === 'completed' || person.status === 'boarded';
                const off = person.status === 'no-show';
                const locked = !open && !running;
                return (
                  <View key={person.bookingId} style={[styles.pax, on && styles.paxDone, off && styles.paxOff]}>
                    <View style={styles.fill}>
                      <Text style={styles.paxName} numberOfLines={1}>
                        {person.name}
                      </Text>
                      <Text style={styles.paxMeta} numberOfLines={1}>
                        {person.code} {'\u00B7'} {person.department}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.tick, on && styles.tickOn]}
                      disabled={locked || busyBooking === person.bookingId}
                      onPress={() => toggle(person)}
                      accessibilityLabel={`${on ? 'Undo boarding for' : 'Board'} ${person.name}`}
                    >
                      {busyBooking === person.bookingId ? (
                        <ActivityIndicator color={on ? '#fff' : colors.textDim} size="small" />
                      ) : (
                        <Text style={[styles.tickText, on && styles.tickTextOn]}>
                          {on ? '\u2713' : '\u2610'}
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                );
              })}
            </Card>
          );
        })
      )}
    </Screen>
  );
}

/**
 * Starting a trip needs a beginning odometer reading, and the server rejects a
 * start without one. A brand-new trip has no reading recorded, so the old
 * version of this button sent `undefined` every time and could never succeed —
 * it just showed "Enter a valid starting odometer reading." with nowhere to
 * type one. Collecting it inline, the same way closing out does, fixes that.
 */
function StartTrip({ trip, onStart }) {
  const [open, setOpen] = useState(false);
  const [odo, setOdo] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const value = Number(odo);
    if (!value) {
      setErr('Enter the odometer reading.');
      return;
    }
    setErr('');
    setBusy(true);
    try {
      await driverApi.start(trip.id, value);
      setOpen(false);
      onStart();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <TouchableOpacity
        style={[styles.btn, styles.btnPrimary]}
        onPress={() => setOpen(true)}
      >
        <Text style={styles.btnPrimaryText}>Start this trip</Text>
      </TouchableOpacity>
    );
  }

  return (
    <Card>
      <Text style={styles.cardTitle}>Start this trip</Text>
      <Field label="Odometer reading now (km)">
        <TextInput
          style={styles.input}
          value={odo}
          onChangeText={setOdo}
          keyboardType="numeric"
          placeholder="41234"
          placeholderTextColor={colors.textDim}
        />
      </Field>
      <Text style={styles.tiny}>
        The distance you run is worked out from this reading, so enter what the
        dashboard shows now.
      </Text>
      {err ? <Text style={styles.fieldErr}>{err}</Text> : null}
      <TouchableOpacity
        style={[styles.btn, styles.btnPrimary]}
        onPress={submit}
        disabled={busy}
      >
        <Text style={styles.btnPrimaryText}>{busy ? 'Starting\u2026' : 'Start trip'}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.btn} onPress={() => { setOpen(false); setErr(''); }}>
        <Text style={styles.btnText}>Cancel</Text>
      </TouchableOpacity>
    </Card>
  );
}

/** Closing out needs the odometer, so it expands inline rather than in a modal. */
function CloseOutTrip({ trip, tripId, onDone }) {
  const [open, setOpen] = useState(false);
  const [odo, setOdo] = useState('');
  const [notes, setNotes] = useState(trip.notes || '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const value = Number(odo);
    if (!value) {
      setErr('Enter the odometer reading.');
      return;
    }
    // Catch a dropped or extra digit, which would otherwise be recorded as a
    // real distance against the vehicle.
    if (trip.odometerStart && value < Number(trip.odometerStart)) {
      setErr(`This is below the starting reading of ${num(trip.odometerStart)} km.`);
      return;
    }
    setErr('');
    setBusy(true);
    try {
      await driverApi.complete(tripId, { odometerEnd: value, notes: notes.trim() });
      setOpen(false);
      onDone();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <TouchableOpacity style={[styles.btn, styles.btnOk]} onPress={() => setOpen(true)}>
        <Text style={styles.btnPrimaryText}>Close out trip</Text>
      </TouchableOpacity>
    );
  }

  return (
    <Card>
      <Text style={styles.cardTitle}>Close out trip</Text>
      <Field label="Odometer reading now (km)">
        <TextInput
          style={styles.input}
          value={odo}
          onChangeText={setOdo}
          keyboardType="numeric"
          placeholder={trip.odometerStart ? String(Number(trip.odometerStart) + 42) : '41234'}
          placeholderTextColor={colors.textDim}
        />
      </Field>
      <Text style={styles.tiny}>
        Started at {trip.odometerStart ? `${num(trip.odometerStart)} km` : 'an unrecorded reading'}. The
        distance is worked out from the difference.
      </Text>
      <Field label="Anything to report? (optional)">
        <TextInput
          style={[styles.input, styles.textarea]}
          value={notes}
          onChangeText={setNotes}
          multiline
          placeholder="Traffic, a diversion, a passenger issue..."
          placeholderTextColor={colors.textDim}
        />
      </Field>
      {err ? <Text style={styles.fieldErr}>{err}</Text> : null}
      <View style={styles.btnRow}>
        <TouchableOpacity style={styles.btn} onPress={() => setOpen(false)} disabled={busy}>
          <Text style={styles.btnText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, styles.btnOk]} onPress={submit} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnPrimaryText}>Close trip</Text>}
        </TouchableOpacity>
      </View>
    </Card>
  );
}

/* --- History ------------------------------------------------------------- */

function HistoryScreen({ onOpenTrip }) {
  const state = useLoader(useCallback(() => driverApi.trips(), []));

  if (state.loading && !state.data) return <Busy />;
  if (state.error && !state.data) return <ErrorBox message={state.error} onRetry={state.reload} />;

  // List endpoints answer with the standard { data, meta } envelope.
  const rows = state.data?.data || [];
  const done = rows.filter((r) => r.status === 'completed');
  const km = done.reduce((a, r) => a + (Number(r.actualKm) || 0), 0);

  return (
    <Screen state={state}>
      {!rows.length ? (
        <Empty title="Nothing driven yet" text="Completed trips will appear here." />
      ) : (
        <>
          <View style={styles.stats}>
            <Stat k="Trips" v={String(rows.length)} />
            <Stat k="Completed" v={String(done.length)} />
            <Stat k="Distance" v={`${num(km, 0)} km`} />
            <Stat k="Open" v={String(rows.length - done.length)} />
          </View>
          {rows.map((t) => (
            <TripCard key={t.id} trip={t} onPress={() => onOpenTrip(t.id)} />
          ))}
        </>
      )}
    </Screen>
  );
}

function Stat({ k, v }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statK}>{k}</Text>
      <Text style={styles.statV}>{v}</Text>
    </View>
  );
}

function KV({ k, v }) {
  return (
    <View style={styles.kv}>
      <Text style={styles.kvK}>{k}</Text>
      <Text style={styles.kvV}>{v}</Text>
    </View>
  );
}

function Field({ label, children }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

/* --- Log ----------------------------------------------------------------- */

function LogScreen() {
  return (
    <ScrollView style={styles.fill} contentContainerStyle={styles.scrollBody}>
      <BreakdownForm />
      <FuelForm />
    </ScrollView>
  );
}

function BreakdownForm() {
  const [severity, setSeverity] = useState('medium');
  const [description, setDescription] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const severities = [
    { key: 'high', label: 'Cannot move - passengers stranded' },
    { key: 'medium', label: 'Can continue but needs attention' },
    { key: 'low', label: 'Minor, not affecting the trip' },
  ];

  const send = async () => {
    if (description.trim().length < 8) {
      setErr('Describe the problem in a few words so the office can act on it.');
      return;
    }
    setErr('');
    setBusy(true);
    try {
      await driverApi.breakdown({ severity, description: description.trim() });
      setDescription('');
      setDone(true);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Text style={styles.cardTitle}>Report a breakdown</Text>
      <Text style={styles.muted}>Tell the office now so a replacement can be arranged.</Text>

      {severities.map((s) => (
        <TouchableOpacity
          key={s.key}
          style={styles.choice}
          onPress={() => setSeverity(s.key)}
          accessibilityRole="radio"
          accessibilityState={{ selected: severity === s.key }}
        >
          <View style={[styles.radio, severity === s.key && styles.radioOn]} />
          <Text style={styles.choiceText}>{s.label}</Text>
        </TouchableOpacity>
      ))}

      <Field label="What happened?">
        <TextInput
          style={[styles.input, styles.textarea]}
          value={description}
          onChangeText={setDescription}
          multiline
          placeholder="e.g. Rear tyre punctured near Wakad Chowk"
          placeholderTextColor={colors.textDim}
        />
      </Field>
      {err ? <Text style={styles.fieldErr}>{err}</Text> : null}
      {done ? <Text style={styles.okNote}>Reported. The office has been told.</Text> : null}

      <TouchableOpacity style={[styles.btn, styles.btnDanger]} onPress={send} disabled={busy}>
        {busy ? <ActivityIndicator color={colors.danger} /> : <Text style={styles.btnDangerText}>Report breakdown</Text>}
      </TouchableOpacity>
    </Card>
  );
}

function FuelForm() {
  const [form, setForm] = useState({ litres: '', cost: '', odometer: '', station: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const send = async () => {
    const litres = Number(form.litres);
    const cost = Number(form.cost);
    if (!litres || litres <= 0) {
      setErr('Enter how many litres you put in.');
      return;
    }
    if (!cost || cost <= 0) {
      setErr('Enter the total cost.');
      return;
    }
    setErr('');
    setBusy(true);
    try {
      // No vehicleId is sent. Most drivers have exactly one vehicle and the
      // server infers it; a driver at a pump knows their registration, not our
      // internal id, so requiring one would block the common case.
      await driverApi.fuel({
        litres,
        // The API field is `amount`, not `cost`. Sending `cost` made every
        // fuel entry fail validation with "Enter the amount paid." even though
        // the amount had been typed in — the value was silently dropped.
        amount: cost,
        odometer: Number(form.odometer) || undefined,
        station: form.station.trim() || undefined,
        date: new Date().toISOString().slice(0, 10),
      });
      setForm({ litres: '', cost: '', odometer: '', station: '' });
      setOk(true);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Text style={styles.cardTitle}>Log fuel</Text>
      <Text style={styles.muted}>Record a fill so the office can reconcile it against distance run.</Text>

      <View style={styles.btnRow}>
        <View style={styles.fill}>
          <Field label="Litres">
            <TextInput
              style={styles.input}
              value={form.litres}
              onChangeText={set('litres')}
              keyboardType="numeric"
              placeholder="40"
              placeholderTextColor={colors.textDim}
            />
          </Field>
        </View>
        <View style={styles.fill}>
          <Field label="Cost (Rs)">
            <TextInput
              style={styles.input}
              value={form.cost}
              onChangeText={set('cost')}
              keyboardType="numeric"
              placeholder="3600"
              placeholderTextColor={colors.textDim}
            />
          </Field>
        </View>
      </View>

      <Field label="Odometer (km)">
        <TextInput
          style={styles.input}
          value={form.odometer}
          onChangeText={set('odometer')}
          keyboardType="numeric"
          placeholder="41234"
          placeholderTextColor={colors.textDim}
        />
      </Field>

      <Field label="Where did you fill up? (optional)">
        <TextInput
          style={styles.input}
          value={form.station}
          onChangeText={set('station')}
          placeholder="e.g. HP pump, Hinjewadi Phase 1"
          placeholderTextColor={colors.textDim}
        />
      </Field>

      {err ? <Text style={styles.fieldErr}>{err}</Text> : null}
      {ok ? <Text style={styles.okNote}>Fuel entry saved.</Text> : null}

      <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={send} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnPrimaryText}>Save fuel entry</Text>}
      </TouchableOpacity>
    </Card>
  );
}

/* --- Me ------------------------------------------------------------------ */

function MeScreen({ onSignOut }) {
  const state = useLoader(useCallback(() => driverApi.me(), []));

  if (state.loading && !state.data) return <Busy />;
  if (state.error && !state.data) return <ErrorBox message={state.error} onRetry={state.reload} />;

  const d = state.data.driver;

  // Licence expiry is the one date a driver genuinely needs warning about.
  const expiry = d.licenceExpiry ? new Date(`${d.licenceExpiry}T00:00:00`) : null;
  const daysToExpiry = expiry ? Math.round((expiry.getTime() - Date.now()) / 86400000) : null;

  return (
    <Screen state={state}>
      <Card>
        <Text style={styles.cardTitle}>{d.name}</Text>
        <KV k="Driver ID" v={d.id} />
        <KV k="Phone" v={d.phone} />
        <KV k="Status" v={statusLabel(d.status)} />
      </Card>

      <Card>
        <Text style={styles.cardTitle}>Licence</Text>
        <KV k="Number" v={d.licenceNo} />
        <KV k="Expires" v={d.licenceExpiry ? date(d.licenceExpiry) : '-'} />
        {daysToExpiry !== null && daysToExpiry < 45 ? (
          <Text
            style={[
              styles.tiny,
              { color: daysToExpiry < 0 ? colors.danger : colors.warn, marginTop: spacing.sm },
            ]}
          >
            {daysToExpiry < 0
              ? `Expired ${Math.abs(daysToExpiry)} days ago`
              : `${daysToExpiry} days left`}{' '}
            - tell the office so it can be renewed.
          </Text>
        ) : null}
      </Card>

      <Card>
        <Text style={styles.cardTitle}>Today at a glance</Text>
        <KV k="Trips on the board" v={String((state.data.today || []).length + (state.data.upcoming || []).length)} />
        <KV k="Vehicles you may use" v={String((state.data.vehicles || []).length || 'none assigned')} />
        <KV k="Trips completed" v={String(state.data.stats?.tripsCompleted ?? 0)} />
        <KV k="Distance driven" v={`${num(state.data.stats?.kmDriven || 0, 0)} km`} />
      </Card>

      <TouchableOpacity style={styles.btn} onPress={onSignOut}>
        <Text style={styles.btnText}>Sign out</Text>
      </TouchableOpacity>
    </Screen>
  );
}

/* --- Styles -------------------------------------------------------------- */

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centre: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  scrollBody: { padding: spacing.md, paddingBottom: spacing.xl * 2 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: Platform.OS === 'ios' ? 52 : 34,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.brand,
  },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '600' },
  headerSub: { color: 'rgba(255,255,255,0.85)', fontSize: 12 },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBtnText: { color: '#fff', fontSize: 18, fontWeight: '600' },

  tabbar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingBottom: Platform.OS === 'ios' ? 20 : 8,
    paddingTop: 8,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 6 },
  tabText: { fontSize: 12, fontWeight: '600', color: colors.textDim },
  tabTextActive: { color: colors.brand },
  tabUnderline: {
    marginTop: 4,
    width: 22,
    height: 2,
    borderRadius: 2,
    backgroundColor: colors.brand,
  },

  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },

  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: colors.textDim,
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
  },

  trip: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  tripTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 4 },
  tripRoute: { flex: 1, fontSize: 16, fontWeight: '700', color: colors.text },
  tripMeta: { fontSize: 13, color: colors.textDim },
  tripCount: { fontSize: 13, color: colors.text, marginTop: 6 },
  tripCountNum: { fontWeight: '700' },
  bar: { height: 5, borderRadius: 3, backgroundColor: colors.surface2, marginTop: 9, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: colors.ok, borderRadius: 3 },

  // Location sharing. Deliberately low-key: it is reassurance, not an alert.
  trackBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.okSoft,
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: spacing.sm + 2,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  trackDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.ok },
  trackText: { flex: 1, fontSize: 12, color: colors.ok, lineHeight: 16 },
  trackBannerWarn: {
    backgroundColor: colors.warnSoft,
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: spacing.sm + 2,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  trackTextWarn: { fontSize: 12, color: colors.warn, lineHeight: 16 },

  badge: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  badgeText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },

  stopHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: 6,
    marginBottom: spacing.sm,
  },
  stopName: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, color: colors.brandDark },
  stopCount: { fontSize: 12, fontWeight: '600', color: colors.textDim },

  pax: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 10,
    marginBottom: spacing.sm,
  },
  paxDone: { backgroundColor: colors.okSoft, borderColor: '#a9dcc3' },
  paxOff: { backgroundColor: colors.surface2, opacity: 0.75 },
  paxName: { fontSize: 15.5, fontWeight: '600', color: colors.text },
  paxMeta: { fontSize: 12.5, color: colors.textDim },

  tick: {
    width: 48,
    height: 48,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickOn: { backgroundColor: colors.ok, borderColor: colors.ok },
  tickText: { fontSize: 22, fontWeight: '700', color: colors.textDim },
  tickTextOn: { color: '#fff' },

  btn: {
    minHeight: TAP_TARGET,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  btnText: { fontSize: 16, fontWeight: '600', color: colors.text },
  btnCancel: { backgroundColor: colors.surface2, borderColor: colors.border },
  btnPrimary: { backgroundColor: colors.brand, borderColor: colors.brand },
  btnPrimaryText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  btnOk: { backgroundColor: colors.ok, borderColor: colors.ok },
  btnDanger: { borderColor: colors.danger, backgroundColor: colors.surface },
  btnDangerText: { fontSize: 16, fontWeight: '700', color: colors.danger },
  btnRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' },

  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 11,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  textarea: { minHeight: 84, textAlignVertical: 'top' },
  field: { marginBottom: spacing.md, flex: 1 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 6 },
  fieldErr: { fontSize: 12.5, color: colors.danger, marginBottom: spacing.sm },
  okNote: { fontSize: 13, color: colors.ok, fontWeight: '600', marginBottom: spacing.sm },

  choice: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
  choiceText: { flex: 1, fontSize: 14.5, color: colors.text },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.border,
  },
  radioOn: { borderColor: colors.brand, borderWidth: 6 },

  kv: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    borderStyle: 'dashed',
  },
  kvK: { color: colors.textDim, fontSize: 14 },
  kvV: { fontWeight: '600', color: colors.text, fontSize: 14, flexShrink: 1, textAlign: 'right' },

  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  stat: {
    flexGrow: 1,
    flexBasis: '47%',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 13,
  },
  statK: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, color: colors.textDim },
  statV: { fontSize: 22, fontWeight: '800', color: colors.text, marginTop: 3 },

  muted: { fontSize: 14, color: colors.textDim, marginBottom: spacing.md },
  tiny: { fontSize: 12, color: colors.textDim, marginBottom: spacing.md },

  busy: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.bg },
  busyText: { color: colors.textDim, fontSize: 14 },

  empty: { alignItems: 'center', paddingVertical: spacing.xl },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 4 },
  emptyText: { fontSize: 14, color: colors.textDim, textAlign: 'center' },

  errTitle: { fontSize: 15, fontWeight: '700', color: colors.danger, marginBottom: 4 },
  errText: { fontSize: 14, color: colors.text, marginBottom: spacing.md },
});
