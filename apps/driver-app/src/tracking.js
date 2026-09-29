import { useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { driverApi } from './api';

/*
 * Foreground location reporting while a trip is running.
 *
 * The desk's Live Tracking page is only worth having if positions actually
 * arrive, so this runs on a timer for the duration of an in-progress trip and
 * stops the moment the trip ends or the screen closes.
 *
 * Deliberately foreground-only. A background-location build needs an extra
 * Android permission, a persistent notification on Android 14+, and an App
 * Store justification on iOS; none of that is worth blocking the feature on.
 * While the driver has the app open - which is exactly when they are driving -
 * the desk sees the bus move.
 */

/** How often to sample. Ten seconds is plenty for a bus and gentle on battery. */
export const PING_INTERVAL_MS = 10000;

/**
 * One reading, shaped for the API.
 *
 * `expo-location` reports speed in metres per second and a null when the device
 * cannot tell (common indoors, at the first fix, or when stationary on some
 * handsets). Converting here rather than server-side keeps the wire format
 * honest, and a null is left off entirely so the server derives it.
 */
export function toPing(loc, tripId) {
  if (!loc || !loc.coords) return null;
  const { latitude, longitude, speed, heading, accuracy } = loc.coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  // 0,0 is what a device reports when it has no fix at all.
  if (latitude === 0 && longitude === 0) return null;

  const ping = { lat: latitude, lon: longitude, tripId };
  if (Number.isFinite(speed) && speed >= 0) {
    ping.speedKph = Math.round(speed * 3.6 * 10) / 10;
  }
  if (Number.isFinite(heading) && heading >= 0) ping.heading = Math.round(heading);
  if (Number.isFinite(accuracy)) ping.accuracyM = Math.round(accuracy);
  return ping;
}

/**
 * Report the driver's position every PING_INTERVAL_MS while `active`.
 *
 * @param {boolean} active  true while a trip is running
 * @param {string}  tripId  the trip to attribute the positions to
 * @returns {{ reporting:boolean, lastAt:Date|null, lastError:string|null, sent:number }}
 */
export function useTripTracking(active, tripId) {
  const [reporting, setReporting] = useState(false);
  const [lastAt, setLastAt] = useState(null);
  const [lastError, setLastError] = useState(null);
  const [sent, setSent] = useState(0);

  // Held in a ref so the interval callback always sees the current values
  // without being torn down and rebuilt on every state change.
  const stopRef = useRef(false);

  useEffect(() => {
    if (!active || !tripId) {
      setReporting(false);
      return undefined;
    }

    stopRef.current = false;
    let timer = null;
    let cancelled = false;

    const tick = async () => {
      if (cancelled || stopRef.current) return;
      try {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const ping = toPing(loc, tripId);
        // A fix we cannot use is not an error worth showing the driver; the
        // next tick will almost certainly succeed.
        if (!ping) return;
        await driverApi.location(ping);
        if (cancelled) return;
        setLastAt(new Date());
        setLastError(null);
        setSent((n) => n + 1);
      } catch (err) {
        if (cancelled) return;
        // Position reporting failing must never interrupt a driver's work, so
        // this is surfaced quietly rather than as a blocking alert.
        setLastError(err.message || 'Could not report position.');
      }
    };

    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          if (!cancelled) {
            setLastError('Location permission was not granted, so the office cannot see this vehicle.');
            setReporting(false);
          }
          return;
        }
        if (cancelled) return;
        setReporting(true);
        await tick();
        timer = setInterval(tick, PING_INTERVAL_MS);
      } catch (err) {
        if (!cancelled) setLastError(err.message || 'Could not start location reporting.');
      }
    })();

    return () => {
      cancelled = true;
      stopRef.current = true;
      if (timer) clearInterval(timer);
      setReporting(false);
    };
  }, [active, tripId]);

  return { reporting, lastAt, lastError, sent };
}

export default useTripTracking;
