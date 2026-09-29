// Driver link, Traccar Client setup links and the tracking status (plan KTD4, KTD5).
// Pure module: node --test imports it.
import { INTAKE_URL } from '../map/main/plannedRoutes.js';

// Start values; the phone test (U1) checks them. `wakelock` applies to Android only.
export const TRACKER_SETTINGS = {
  accuracy: 'highest',
  distance: 0,
  interval: 1,
  stop_detection: false,
  wakelock: true,
  buffer: true,
};

export const STATUS_MAX_AGE_S = 60;

export const START_LINK = 'org.traccar.client://action/start';
export const STOP_LINK = 'org.traccar.client://action/stop';

export const driverLink = (origin, deviceId, token) =>
  `${origin}/sjafor/${deviceId}?${new URLSearchParams({ token })}`;

// The app asks "Apply new configuration?" before it applies these.
export const configLink = (uniqueId) =>
  `org.traccar.client://config?${new URLSearchParams({ url: INTAKE_URL, id: uniqueId, ...TRACKER_SETTINGS })}`;

// Scanned from the app's settings screen: the server is the address without its query.
export const setupQrAddress = (uniqueId) =>
  `${INTAKE_URL}?${new URLSearchParams({ id: uniqueId, ...TRACKER_SETTINGS })}`;

export const directionsLink = (lat, lon) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;

// state: 'offline' (socket not on), 'tracked' (latest fix at most STATUS_MAX_AGE_S old),
// or 'untracked'. age: seconds since the latest fix, never below zero, null with no fix.
export const trackingStatus = (position, socket, now = new Date()) => {
  const age = position
    ? Math.max(0, Math.round((now.getTime() - Date.parse(position.fixTime)) / 1000))
    : null;
  if (!socket) return { state: 'offline', age };
  return { state: age !== null && age <= STATUS_MAX_AGE_S ? 'tracked' : 'untracked', age };
};
