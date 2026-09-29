// Driver link, Traccar Client setup links and the tracking status (plan KTD4, KTD5).
// Pure module: node --test imports it.
import { INTAKE_URL, isVan, osloHour } from '../map/main/plannedRoutes.js';

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

export const formatAge = (age) => {
  if (age === null) return '';
  if (age < 60) return `${age} s`;
  if (age < 3600) return `${Math.floor(age / 60)} min`;
  return `${Math.floor(age / 3600)} t ${Math.floor((age % 3600) / 60)} min`;
};

const DAY_MS = 24 * 3600000;

// The event day: from the latest 04:00 Oslo that is not after `now`, to 24 hours later
// (plan KTD9). The URL parameters from and to override it.
export const eventDayWindow = (now = new Date(), search = window.location.search) => {
  const params = new URLSearchParams(search);
  const from = new Date(params.get('from'));
  if (params.get('from') && !Number.isNaN(from.getTime())) {
    // new Date(null) is the epoch, so a missing `to` needs its own check.
    const to = params.get('to') ? new Date(params.get('to')) : null;
    return { from, to: to && !Number.isNaN(to.getTime()) ? to : new Date(from.getTime() + DAY_MS) };
  }
  let start = osloHour(now, 4);
  if (start > now) start = osloHour(new Date(now.getTime() - DAY_MS), 4);
  return { from: start, to: osloHour(new Date(start.getTime() + DAY_MS + 3 * 3600000), 4) };
};

// The vans that are not tracked, by name, and the done marks to keep: a van loses its
// mark when it is tracked again (plan KTD21). Empty once the window has ended.
export const untrackedVans = (devices, positions, now, dayWindow, done) => {
  const vans = Object.values(devices).filter(isVan);
  const keep = done.filter((id) => trackingStatus(positions[id], true, now).state !== 'tracked');
  if (dayWindow.to <= now) return { vans: [], done: keep };
  return {
    vans: vans
      .filter((device) => !keep.includes(device.id))
      .map((device) => ({ device, ...trackingStatus(positions[device.id], true, now) }))
      .filter((entry) => entry.state === 'untracked')
      .map(({ device, age }) => ({ device, age }))
      .sort((a, b) => a.device.name.localeCompare(b.device.name, 'nb', { numeric: true })),
    done: keep,
  };
};
