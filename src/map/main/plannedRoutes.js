// Planned routes: colors, tuning constants, the tracking window, van helpers, trace
// merging and the manual-mark transport settings. Pure module: no app imports, so
// node --test and the route editor can import it.

export const ROUTE_COLORS = {
  1: '#e6194b',
  2: '#3cb44b',
  3: '#4363d8',
  4: '#f58231',
  5: '#911eb4',
  6: '#42d4f4',
  7: '#f032e6',
};

export const MANUAL_COLOR = '#757575';

// Calibrated against the April 2026 event (all routes finished 23:00-24:00): stops
// alone reached 80-94% on the routes whose vans reported often, so slow driving counts too.
export const STOP_MAX_SPEED = 2.5; // m/s
export const STOP_SEG_MAX_M = 60;
export const STOP_MIN_S = 20;
export const STOP_MAX_S = 1200;
export const INTERSECTION_RADIUS_M = 25;
export const SIGNAL_RADIUS_M = 40;
export const TRAFFIC_MAX_S = 120;
export const SERVICE_REACH_M = 100;
export const LINK_MAX_M = 300;
export const COVER_RADIUS_M = 20;
export const SAMPLE_STEP_M = 10;
export const BASE = [10.751, 59.9535]; // lon, lat: Tåsen skole
export const BASE_RADIUS_M = 150;
export const THIN_STEP_M = 5;
export const MAX_GAP_M = 500;
export const SLOW_DRIVE_SPEED = 3; // m/s, about 11 km/h
export const SLOW_SEG_MAX_M = 100;

export const ETA_MIN_PROGRESS = 0.2;
export const STRIPE_WIDTH = 8;

// Colors for vans without a report color or main route, none of them a route color.
export const FALLBACK_COLORS = [
  '#bfef45',
  '#fabed4',
  '#469990',
  '#dcbeff',
  '#9A6324',
  '#800000',
  '#aaffc3',
  '#808000',
  '#000075',
  '#a9a9a9',
  '#e6beff',
  '#ffe119',
  '#ff6961',
];

export const mainRouteOf = (device) => {
  const route = Number(device?.attributes?.route);
  return ROUTE_COLORS[route] ? route : null;
};

export const vanColor = (device) =>
  device?.attributes?.['web.reportColor'] ||
  ROUTE_COLORS[mainRouteOf(device)] ||
  FALLBACK_COLORS[(device?.id || 0) % FALLBACK_COLORS.length];

export const isVan = (device) => !device?.attributes?.manualMarks;

const osloParts = (date) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Oslo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map(({ type, value }) => [type, Number(value)]),
  );

// `hour`:00 Oslo time on the Oslo date of `date`.
export const osloHour = (date, hour) => {
  const { year, month, day } = osloParts(date);
  const guess = new Date(Date.UTC(year, month - 1, day, hour));
  return new Date(guess.getTime() - (osloParts(guess).hour - hour) * 3600000);
};

// The time window of the event: from 17:00 Oslo, no end. Between 04:00 and 17:00
// it has not started (from is null). The URL parameters from and to override it.
export const trackingWindow = (now = new Date(), search = window.location.search) => {
  const params = new URLSearchParams(search);
  const from = new Date(params.get('from'));
  if (params.get('from') && !Number.isNaN(from.getTime())) {
    const to = new Date(params.get('to'));
    return { from, to: params.get('to') && !Number.isNaN(to.getTime()) ? to : null };
  }
  const { hour } = osloParts(now);
  if (hour >= 4 && hour < 17) return { from: null, to: null };
  return { from: osloHour(hour < 4 ? new Date(now.getTime() - 5 * 3600000) : now, 17), to: null };
};

// No end to the window: the positions API needs a `to`.
export const FAR_FUTURE = '2100-01-01T00:00:00Z';

export const routeColorExpression = (fallback) => [
  'match',
  ['get', 'route'],
  ...Object.entries(ROUTE_COLORS).flatMap(([route, color]) => [Number(route), color]),
  fallback,
];

export const meters = (a, b) =>
  Math.hypot((a.lon - b.lon) * Math.cos((a.lat * Math.PI) / 180), a.lat - b.lat) * 111320;

// Merges new positions into a trace: time order, no duplicate ids, and a position
// kept only when it is THIN_STEP_M from the last kept one or from the next one. The
// latest is always kept. Keeping the last point before a move keeps the end of a
// dwell, which stop detection needs when the phone reports only every few seconds.
export const mergeTrace = (trace, positions) => {
  // Fast path for one newer position, the common websocket case: same result as below.
  const last = trace[trace.length - 1];
  if (positions.length === 1 && last && positions[0].time > last.time) {
    const keepLast =
      trace.length === 1 ||
      meters(last, trace[trace.length - 2]) >= THIN_STEP_M ||
      meters(positions[0], last) >= THIN_STEP_M;
    return [...trace.slice(0, -1), ...(keepLast ? [last] : []), positions[0]];
  }
  const byId = new Map([...trace, ...positions].map((q) => [q.id, q]));
  const sorted = [...byId.values()].sort((a, b) => a.time - b.time || a.id - b.id);
  const kept = [];
  sorted.forEach((q, i) => {
    if (
      !kept.length ||
      i === sorted.length - 1 ||
      meters(q, kept[kept.length - 1]) >= THIN_STEP_M ||
      meters(sorted[i + 1], q) >= THIN_STEP_M
    ) {
      kept.push(q);
    }
  });
  return kept;
};

// OsmAnd intake for manual marks. MARK_TARGET 'origin' posts to the page's own origin
// over https, as the emulator does; set it to 'intake' if the web origin rejects reports.
// A page served over http (the dev server) always uses the intake.
export const INTAKE_URL = 'https://inntak.koredu.no/';
export const MARK_TARGET = 'origin';
