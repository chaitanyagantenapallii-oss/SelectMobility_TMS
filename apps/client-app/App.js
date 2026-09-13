/**
 * SMI Client - React Native app.
 *
 * Screens: sign in, Live, Staff, History, Statement, Requests.
 *
 * Mirrors client/js/client-app.js. Everything here is scoped by the server to
 * one organisation; this app never filters as a security measure, only for
 * readability. If the API ever returned another organisation's rows the
 * mistake would be visible rather than hidden, which is the point.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
  clientApi,
  clearSession,
  getUser,
  restoreSession,
} from '../mobile-shared/api';
import {
  colors,
  spacing,
  TAP_TARGET,
  compactMoney,
  date,
  dateShort,
  money,
  num,
  statusColor,
  statusLabel,
} from '../mobile-shared/theme';
import SignIn from '../mobile-shared/SignIn';

const TABS = [
  { key: 'overview', label: 'Live' },
  { key: 'roster', label: 'Staff' },
  { key: 'history', label: 'History' },
  { key: 'statement', label: 'Bill' },
  { key: 'requests', label: 'Requests' },
];

const TAB_TITLES = {
  overview: 'Live status',
  roster: 'My staff',
  history: 'Trip history',
  statement: 'Statement',
  requests: 'Requests',
};

export default function App() {
  const [booting, setBooting] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [tab, setTab] = useState('overview');
  const [employeeId, setEmployeeId] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const had = await restoreSession();
      if (!alive) return;
      const u = getUser();
      setSignedIn(had && (!u.role || u.role === 'client' || u.role === 'admin'));
      setBooting(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const signOut = useCallback(async () => {
    await clearSession();
    setEmployeeId(null);
    setTab('overview');
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
        <SignIn title="Client sign in" subtitle="Select Mobility" onSignedIn={setSignedIn} />
      </>
    );
  }

  const changeTab = (key) => {
    setEmployeeId(null);
    setTab(key);
  };

  return (
    <View style={styles.fill}>
      <StatusBar style="light" />
      <View style={styles.header}>
        {employeeId ? (
          <TouchableOpacity style={styles.headerBtn} onPress={() => setEmployeeId(null)}>
            <Text style={styles.headerBtnText}>{'\u2190'}</Text>
          </TouchableOpacity>
        ) : null}
        <View style={styles.fill}>
          <Text style={styles.headerTitle}>
            {employeeId ? 'Travel history' : TAB_TITLES[tab]}
          </Text>
          <Text style={styles.headerSub}>{getUser()?.name || 'Client'}</Text>
        </View>
        <TouchableOpacity style={styles.headerBtn} onPress={signOut} accessibilityLabel="Sign out">
          <Text style={styles.headerBtnText}>{'\u2192'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.fill}>
        {employeeId ? (
          <EmployeeHistory employeeId={employeeId} />
        ) : (
          <>
            {tab === 'overview' && <OverviewScreen onOpenTrip={() => {}} />}
            {tab === 'roster' && <RosterScreen onOpenEmployee={setEmployeeId} />}
            {tab === 'history' && <HistoryScreen />}
            {tab === 'statement' && <StatementScreen />}
            {tab === 'requests' && <RequestsScreen />}
          </>
        )}
      </View>

      {!employeeId && <TabBar tab={tab} onChange={changeTab} />}
    </View>
  );
}

/* --- Chrome -------------------------------------------------------------- */

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
          <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]} numberOfLines={1}>
            {t.label}
          </Text>
          {tab === t.key && <View style={styles.tabUnderline} />}
        </TouchableOpacity>
      ))}
    </View>
  );
}

function Card({ children, style }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

function Badge({ status }) {
  const c = statusColor(status);
  return (
    <View style={[styles.badge, { backgroundColor: `${c}22` }]}>
      <Text style={[styles.badgeText, { color: c }]}>{statusLabel(status)}</Text>
    </View>
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

function Empty({ title, text }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

/** The same load/refresh/error cycle the driver app uses. */
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

  return { data, error, loading, refreshing, refresh: () => run(true), reload: () => run(false) };
}

function Screen({ state, children }) {
  if (state.loading && !state.data) {
    return (
      <View style={styles.busy}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  if (state.error && !state.data) {
    return (
      <ScrollView contentContainerStyle={styles.scrollBody}>
        <Card>
          <Text style={styles.errTitle}>Could not load</Text>
          <Text style={styles.errText}>{state.error}</Text>
          <TouchableOpacity style={styles.btn} onPress={state.reload}>
            <Text style={styles.btnText}>Try again</Text>
          </TouchableOpacity>
        </Card>
      </ScrollView>
    );
  }
  return (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={styles.scrollBody}
      refreshControl={
        <RefreshControl refreshing={state.refreshing} onRefresh={state.refresh} tintColor={colors.brand} />
      }
    >
      {state.error ? (
        <Card>
          <Text style={styles.errText}>{state.error} Showing what we last downloaded.</Text>
        </Card>
      ) : null}
      {children}
    </ScrollView>
  );
}

/* --- Overview ------------------------------------------------------------ */

function OverviewScreen() {
  const state = useLoader(useCallback(() => clientApi.me(), []));

  if (state.loading && !state.data) {
    return (
      <View style={styles.busy}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  if (state.error && !state.data) {
    return (
      <ScrollView contentContainerStyle={styles.scrollBody}>
        <Card>
          <Text style={styles.errTitle}>Could not load</Text>
          <Text style={styles.errText}>{state.error}</Text>
          <TouchableOpacity style={styles.btn} onPress={state.reload}>
            <Text style={styles.btnText}>Try again</Text>
          </TouchableOpacity>
        </Card>
      </ScrollView>
    );
  }

  const s = state.data?.stats || {};
  const trips = state.data?.liveTrips || [];

  return (
    <Screen state={state}>
      <Card style={styles.orgCard}>
        <Text style={styles.orgName}>{state.data.organisation}</Text>
        <Text style={styles.tiny}>Signed in as {state.data.contact?.name}</Text>
      </Card>

      <View style={styles.stats}>
        <Stat k="On the road" v={String(s.onRoad ?? 0)} />
        <Stat k="Done today" v={String(s.completed ?? 0)} />
        <Stat k="Scheduled" v={String(s.tripsScheduledToday ?? 0)} />
        <Stat k="My staff" v={String(s.employeesRegistered ?? 0)} />
      </View>

      <Text style={styles.sectionLabel}>Today's vehicles</Text>
      {!trips.length ? (
        <Empty title="No vehicles out yet" text="Trips for today will appear here as they start." />
      ) : (
        trips.map((t) => {
          // liveTrips carries `ourStaff` rather than `passengers`, because the
          // count that matters to a client is their own people, not the whole
          // vehicle load.
          const ours = t.ourStaff || { booked: 0, boarded: 0 };
          const pct = ours.booked ? Math.min(1, ours.boarded / ours.booked) : 0;
          return (
            <Card key={t.id}>
              <View style={styles.tripTop}>
                <Text style={styles.tripRoute} numberOfLines={1}>
                  {t.route.code} {'\u00B7'} {t.route.name}
                </Text>
                <Badge status={t.status} />
              </View>
              <Text style={styles.tripMeta}>
                {t.vehicle.regNo} {'\u00B7'} {t.driver.name} {'\u00B7'} from {t.shift.pickupStart}
              </Text>
              <Text style={styles.tripCount}>
                <Text style={styles.tripCountNum}>{ours.boarded}</Text> of {ours.booked} of my staff on
                board
              </Text>
              <View style={styles.bar}>
                <View style={[styles.barFill, { width: `${Math.round(pct * 100)}%` }]} />
              </View>
            </Card>
          );
        })
      )}
    </Screen>
  );
}

/* --- Roster -------------------------------------------------------------- */

function RosterScreen({ onOpenEmployee }) {
  const state = useLoader(useCallback(() => clientApi.roster(), []));

  if (state.loading && !state.data) {
    return (
      <View style={styles.busy}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  if (state.error && !state.data) {
    return (
      <ScrollView contentContainerStyle={styles.scrollBody}>
        <Card>
          <Text style={styles.errTitle}>Could not load your staff</Text>
          <Text style={styles.errText}>{state.error}</Text>
          <TouchableOpacity style={styles.btn} onPress={state.reload}>
            <Text style={styles.btnText}>Try again</Text>
          </TouchableOpacity>
        </Card>
      </ScrollView>
    );
  }

  // The list endpoints answer with { data, meta }, not a bare array.
  const rows = state.data?.data || [];

  if (!rows.length) {
    return (
      <ScrollView contentContainerStyle={styles.scrollBody}>
        <Empty
          title="No staff registered"
          text="Your employees will appear here once the office adds them."
        />
      </ScrollView>
    );
  }

  // Group by route, which is how a client thinks about their staff: who is on
  // which bus.
  const byRoute = new Map();
  for (const e of rows) {
    const key =
      e.routeCode && e.routeCode !== '-' ? `${e.routeCode} \u00B7 ${e.routeName}` : 'Not on a route';
    if (!byRoute.has(key)) byRoute.set(key, []);
    byRoute.get(key).push(e);
  }

  return (
    <Screen state={state}>
      <Card style={styles.summaryCard}>
        <Text style={styles.muted}>
          {rows.length} staff across {byRoute.size} route{byRoute.size === 1 ? '' : 's'}
        </Text>
      </Card>

      {[...byRoute.entries()].map(([route, people]) => (
        <Card key={route}>
          <View style={styles.stopHead}>
            <Text style={styles.stopName} numberOfLines={1}>
              {route}
            </Text>
            <Text style={styles.stopCount}>{people.length}</Text>
          </View>
          {people.map((e) => (
            <TouchableOpacity
              key={e.id}
              style={styles.person}
              onPress={() => onOpenEmployee(e.id)}
              activeOpacity={0.8}
            >
              <View style={styles.fill}>
                <Text style={styles.paxName} numberOfLines={1}>
                  {e.name}
                </Text>
                <Text style={styles.paxMeta} numberOfLines={1}>
                  {e.code} {'\u00B7'} {e.department} {'\u00B7'} {e.stop || 'no stop'}
                </Text>
              </View>
              <Badge status={e.status} />
            </TouchableOpacity>
          ))}
        </Card>
      ))}
    </Screen>
  );
}

/* --- Employee history ---------------------------------------------------- */

function EmployeeHistory({ employeeId }) {
  const state = useLoader(
    useCallback(() => clientApi.history(employeeId), [employeeId])
  );

  if (state.loading && !state.data) {
    return (
      <View style={styles.busy}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  if (state.error) {
    return (
      <ScrollView contentContainerStyle={styles.scrollBody}>
        <Card>
          <Text style={styles.errTitle}>Could not load history</Text>
          <Text style={styles.errText}>{state.error}</Text>
        </Card>
      </ScrollView>
    );
  }

  const rows = state.data?.data || [];
  // Each row carries the employee's own name, so the header comes from the
  // first row rather than a second round trip.
  const emp = rows[0] || {};
  const present = rows.filter((r) => r.boardedAt).length;
  const rate = rows.length ? Math.round((present / rows.length) * 100) : 0;

  return (
    <Screen state={state}>
      <Card>
        <Text style={styles.cardTitle}>{emp.employeeName || 'Staff member'}</Text>
        <KV k="Code" v={emp.employeeId || '-'} />
        <KV k="Usual pickup" v={emp.stop || '-'} />
        <KV k="Trips recorded" v={String(rows.length)} />
      </Card>

      <View style={styles.stats}>
        <Stat k="Trips" v={String(rows.length)} />
        <Stat k="Carried" v={String(present)} />
        <Stat k="Used the bus" v={`${rate}%`} />
        <Stat k="No-shows" v={String(rows.filter((r) => r.status === 'no-show').length)} />
      </View>

      <Card>
        <Text style={styles.cardTitle}>Recent trips</Text>
        {!rows.length ? (
          <Text style={styles.muted}>No trips recorded yet.</Text>
        ) : (
          rows.map((r, i) => (
            <View key={`${r.tripId}-${i}`} style={styles.listRow}>
              <View style={styles.fill}>
                <Text style={styles.listStrong}>{date(r.date)}</Text>
                <Text style={styles.tiny}>
                  {r.routeCode} {'\u00B7'} {r.stop || 'no stop'}
                </Text>
              </View>
              <Badge status={r.boardedAt ? 'boarded' : r.status} />
            </View>
          ))
        )}
      </Card>
    </Screen>
  );
}

/* --- History ------------------------------------------------------------- */

function HistoryScreen() {
  const state = useLoader(useCallback(() => clientApi.history(), []));

  if (state.loading && !state.data) {
    return (
      <View style={styles.busy}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  if (state.error && !state.data) {
    return (
      <ScrollView contentContainerStyle={styles.scrollBody}>
        <Card>
          <Text style={styles.errTitle}>Could not load history</Text>
          <Text style={styles.errText}>{state.error}</Text>
          <TouchableOpacity style={styles.btn} onPress={state.reload}>
            <Text style={styles.btnText}>Try again</Text>
          </TouchableOpacity>
        </Card>
      </ScrollView>
    );
  }

  const rows = state.data?.data || [];
  if (!rows.length) {
    return (
      <ScrollView contentContainerStyle={styles.scrollBody}>
        <Empty title="No trips yet" text="Trips carrying your staff will be listed here." />
      </ScrollView>
    );
  }

  const carried = rows.filter((r) => r.boardedAt).length;
  const routes = new Set(rows.map((r) => r.routeCode)).size;

  return (
    <Screen state={state}>
      <Card style={styles.summaryCard}>
        <Text style={styles.muted}>
          {rows.length} staff journeys {'\u00B7'} {routes} route{routes === 1 ? '' : 's'} {'\u00B7'}{' '}
          {carried} carried
        </Text>
      </Card>

      {rows.map((r, i) => (
        <Card key={`${r.tripId}-${i}`} style={styles.historyCard}>
          <View style={styles.tripTop}>
            <Text style={styles.listStrong} numberOfLines={1}>
              {r.employeeName || 'Staff member'}
            </Text>
            <Badge status={r.boardedAt ? 'boarded' : r.status} />
          </View>
          <Text style={styles.tiny}>
            {date(r.date)} {'\u00B7'} {r.routeCode} {'\u00B7'} {r.routeName || ''}
          </Text>
          <Text style={styles.tiny}>{r.stop || 'no stop'}</Text>
        </Card>
      ))}
    </Screen>
  );
}

/* --- Statement ----------------------------------------------------------- */

function StatementScreen() {
  const state = useLoader(useCallback(() => clientApi.statement(), []));

  if (state.loading && !state.data) {
    return (
      <View style={styles.busy}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  if (state.error && !state.data) {
    return (
      <ScrollView contentContainerStyle={styles.scrollBody}>
        <Card>
          <Text style={styles.errTitle}>Could not load the statement</Text>
          <Text style={styles.errText}>{state.error}</Text>
          <TouchableOpacity style={styles.btn} onPress={state.reload}>
            <Text style={styles.btnText}>Try again</Text>
          </TouchableOpacity>
        </Card>
      </ScrollView>
    );
  }

  const lines = state.data?.lines || [];
  const total = state.data?.totals?.amount ?? lines.reduce((a, l) => a + (Number(l.amount) || 0), 0);
  const km = state.data?.totals?.km ?? lines.reduce((a, l) => a + (Number(l.km) || 0), 0);
  const seatKm = lines.reduce((a, l) => a + (Number(l.km) || 0) * (Number(l.staffBoarded) || 0), 0);

  /** Share the statement as plain text; there is no file system here. */
  const share = () => {
    const header = 'Date,Route,Vehicle,Km,Staff booked,Staff boarded,Amount';
    const body = lines
      .map(
        (l) =>
          `${l.date},${l.routeCode},${l.vehicleRegNo || ''},${l.km},${l.staffBooked},${l.staffBoarded},${l.amount}`
      )
      .join('\n');
    const csv = `${header}\n${body}\n\nTotal,,,,,${seatKm},${total}`;
    Alert.alert(
      `Statement ${state.data.month || ''}`,
      csv.length > 1200 ? `${csv.slice(0, 1200)}\n...` : csv
    );
  };

  return (
    <Screen state={state}>
      <View style={styles.stats}>
        <Stat k="Amount due" v={compactMoney(total)} />
        <Stat k="Trips billed" v={String(lines.filter((l) => l.amount > 0).length)} />
        <Stat k="Distance" v={`${num(km, 0)} km`} />
        <Stat k="Staff carried" v={String(lines.reduce((a, l) => a + (l.staffBoarded || 0), 0))} />
      </View>

      <Card>
        <View style={styles.tripTop}>
          <Text style={styles.cardTitle}>{state.data.month || ''}</Text>
          <Text style={styles.muted}>{money(total)}</Text>
        </View>
        <Text style={styles.tiny}>
          Charged on seat-kilometres: a run that carried nobody is not billed for distance.
        </Text>
      </Card>

      {!lines.length ? (
        <Empty title="Nothing billed this month" text="Trips carrying your staff will be itemised here." />
      ) : (
        <Card>
          <View style={styles.tableHead}>
            <Text style={[styles.th, styles.colDate]}>Date</Text>
            <Text style={[styles.th, styles.colRoute]}>Route</Text>
            <Text style={[styles.th, styles.colNum]}>Km</Text>
            <Text style={[styles.th, styles.colStaff]}>Staff</Text>
            <Text style={[styles.th, styles.colAmount]}>Amount</Text>
          </View>
          {lines.map((l, i) => (
            <View key={`${l.tripId}-${i}`} style={styles.tableRow}>
              <Text style={[styles.td, styles.colDate]}>{dateShort(l.date)}</Text>
              <Text style={[styles.td, styles.colRoute]} numberOfLines={1}>
                {l.routeCode}
              </Text>
              <Text style={[styles.td, styles.colNum]}>{num(l.km, 1)}</Text>
              <Text style={[styles.td, styles.colStaff]}>
                {l.staffBoarded}/{l.staffBooked}
              </Text>
              <Text style={[styles.td, styles.colAmount, l.amount ? styles.tdBold : null]}>
                {l.amount ? money(l.amount) : '\u2014'}
              </Text>
            </View>
          ))}
          <View style={[styles.tableRow, styles.tableFoot]}>
            <Text style={[styles.td, styles.colDate]}>Total</Text>
            <Text style={[styles.td, styles.colRoute]} />
            <Text style={[styles.td, styles.colNum, styles.tdBold]}>{num(km, 1)}</Text>
            <Text style={[styles.td, styles.colStaff, styles.tdBold]}>{seatKm}</Text>
            <Text style={[styles.td, styles.colAmount, styles.tdBold]}>{money(total)}</Text>
          </View>
        </Card>
      )}

      <TouchableOpacity style={styles.btn} onPress={share}>
        <Text style={styles.btnText}>Export as CSV</Text>
      </TouchableOpacity>
    </Screen>
  );
}

/* --- Requests ------------------------------------------------------------ */

function RequestsScreen() {
  const state = useLoader(useCallback(() => clientApi.requests(), []));
  const [category, setCategory] = useState('route-change');
  const [priority, setPriority] = useState('normal');
  const [subject, setSubject] = useState('');
  const [detail, setDetail] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const categories = [
    { key: 'route-change', label: 'Add or change a pickup point' },
    { key: 'timing', label: 'Change a shift timing' },
    { key: 'vehicle', label: 'Extra vehicle on a route' },
    { key: 'new-employee', label: 'Add a staff member' },
    { key: 'missed-pickup', label: 'A pickup was missed' },
    { key: 'other', label: 'Something else' },
  ];

  const send = async () => {
    // The API requires three characters; checking here only saves a round trip.
    if (subject.trim().length < 3) {
      setErr('Give the request a summary the office will understand.');
      return;
    }
    setErr('');
    setBusy(true);
    try {
      // The record field is `subject`; the label says "summary" because that
      // reads better. Do not send `title` - the API ignores it.
      await clientApi.raiseRequest({
        category,
        priority,
        subject: subject.trim(),
        detail: detail.trim(),
      });
      setSubject('');
      setDetail('');
      state.reload();
      Alert.alert('Request sent', 'The transport desk will respond shortly.');
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (state.loading && !state.data) {
    return (
      <View style={styles.busy}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  const rows = state.data?.data || [];

  return (
    <Screen state={state}>
      <Card>
        <Text style={styles.cardTitle}>Raise a request</Text>
        <Text style={styles.muted}>
          Ask for a new pickup point, a shift change, or an extra vehicle.
        </Text>

        {categories.map((c) => (
          <TouchableOpacity
            key={c.key}
            style={styles.choice}
            onPress={() => setCategory(c.key)}
            accessibilityRole="radio"
            accessibilityState={{ selected: category === c.key }}
          >
            <View style={[styles.radio, category === c.key && styles.radioOn]} />
            <Text style={styles.choiceText}>{c.label}</Text>
          </TouchableOpacity>
        ))}

        <View style={styles.priorityRow}>
          {[
            { key: 'normal', label: 'Normal' },
            { key: 'high', label: 'Urgent' },
            { key: 'low', label: 'Whenever' },
          ].map((p) => (
            <TouchableOpacity
              key={p.key}
              style={[styles.chip, priority === p.key && styles.chipOn]}
              onPress={() => setPriority(p.key)}
            >
              <Text style={[styles.chipText, priority === p.key && styles.chipTextOn]}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Field label="Short summary">
          <TextInput
            style={styles.input}
            value={subject}
            onChangeText={setSubject}
            maxLength={80}
            placeholder="e.g. Extra pickup at Blue Ridge Gate"
            placeholderTextColor={colors.textDim}
          />
        </Field>

        <Field label="Details (optional)">
          <TextInput
            style={[styles.input, styles.textarea]}
            value={detail}
            onChangeText={setDetail}
            multiline
            placeholder="Anything the office should know"
            placeholderTextColor={colors.textDim}
          />
        </Field>

        {err ? <Text style={styles.fieldErr}>{err}</Text> : null}

        <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={send} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnPrimaryText}>Send request</Text>}
        </TouchableOpacity>
      </Card>

      <Card>
        <Text style={styles.cardTitle}>Previous requests ({rows.length})</Text>
        {!rows.length ? (
          <Text style={styles.muted}>Nothing raised yet.</Text>
        ) : (
          rows.map((r) => (
            <View key={r.id} style={styles.listRow}>
              <View style={styles.fill}>
                <Text style={styles.listStrong} numberOfLines={2}>
                  {r.subject}
                </Text>
                <Text style={styles.tiny}>
                  {statusLabel(r.category)}
                  {r.priority && r.priority !== 'normal' ? ` \u00B7 ${r.priority}` : ''}
                  {` \u00B7 raised ${date(r.createdAt)}`}
                </Text>
                {r.detail ? <Text style={styles.tiny}>{r.detail}</Text> : null}
                {r.response ? <Text style={styles.responseText}>Office: {r.response}</Text> : null}
              </View>
              <Badge status={r.status} />
            </View>
          ))
        )}
      </Card>
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
  tabText: { fontSize: 11.5, fontWeight: '600', color: colors.textDim },
  tabTextActive: { color: colors.brand },
  tabUnderline: { marginTop: 4, width: 18, height: 2, borderRadius: 2, backgroundColor: colors.brand },

  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  summaryCard: { paddingVertical: 12 },
  orgCard: { paddingVertical: 12 },
  orgName: { fontSize: 16, fontWeight: '700', color: colors.text },
  historyCard: { paddingVertical: 12 },

  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: colors.textDim,
    marginBottom: spacing.sm,
  },

  tripTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 4 },
  tripRoute: { flex: 1, fontSize: 15.5, fontWeight: '700', color: colors.text },
  tripMeta: { fontSize: 13, color: colors.textDim },
  tripCount: { fontSize: 13, color: colors.text, marginTop: 6 },
  tripCountNum: { fontWeight: '700' },
  bar: { height: 5, borderRadius: 3, backgroundColor: colors.surface2, marginTop: 9, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: colors.ok, borderRadius: 3 },

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
  stopName: {
    flex: 1,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: colors.brandDark,
  },
  stopCount: { fontSize: 12, fontWeight: '600', color: colors.textDim },

  person: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 11,
    marginBottom: spacing.sm,
  },
  paxName: { fontSize: 15.5, fontWeight: '600', color: colors.text },
  paxMeta: { fontSize: 12.5, color: colors.textDim },

  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  listStrong: { fontSize: 15, fontWeight: '600', color: colors.text },
  responseText: { fontSize: 12.5, color: colors.ok, marginTop: 4 },

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
  btnPrimary: { backgroundColor: colors.brand, borderColor: colors.brand },
  btnPrimaryText: { fontSize: 16, fontWeight: '700', color: '#fff' },

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
  field: { marginBottom: spacing.md },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 6 },
  fieldErr: { fontSize: 12.5, color: colors.danger, marginBottom: spacing.sm },

  choice: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  choiceText: { flex: 1, fontSize: 14.5, color: colors.text },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.border },
  radioOn: { borderColor: colors.brand, borderWidth: 6 },

  priorityRow: { flexDirection: 'row', gap: spacing.sm, marginVertical: spacing.md },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.brandSoft, borderColor: colors.brand },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.textDim },
  chipTextOn: { color: colors.brandDark },

  kv: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  kvK: { color: colors.textDim, fontSize: 14 },
  kvV: { fontWeight: '600', color: colors.text, fontSize: 14, textAlign: 'right' },

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
  statV: { fontSize: 20, fontWeight: '800', color: colors.text, marginTop: 3 },

  tableHead: {
    flexDirection: 'row',
    borderBottomWidth: 2,
    borderBottomColor: colors.border,
    paddingBottom: 6,
    marginBottom: 4,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tableFoot: { borderTopWidth: 2, borderTopColor: colors.border, borderBottomWidth: 0, marginTop: 4 },
  th: { fontSize: 10.5, fontWeight: '800', textTransform: 'uppercase', color: colors.textDim },
  td: { fontSize: 13, color: colors.text },
  tdBold: { fontWeight: '700' },
  colDate: { flex: 1.1 },
  colRoute: { flex: 0.9 },
  colNum: { flex: 0.8, textAlign: 'right' },
  colStaff: { flex: 0.8, textAlign: 'right' },
  colAmount: { flex: 1.1, textAlign: 'right' },

  muted: { fontSize: 14, color: colors.textDim },
  tiny: { fontSize: 12, color: colors.textDim, marginTop: 2 },

  busy: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  empty: { alignItems: 'center', paddingVertical: spacing.xl },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 4 },
  emptyText: { fontSize: 14, color: colors.textDim, textAlign: 'center' },
  errTitle: { fontSize: 15, fontWeight: '700', color: colors.danger, marginBottom: 4 },
  errText: { fontSize: 14, color: colors.text, marginBottom: spacing.md },
});
