// Route colors and tuning constants for the planned routes. Pure module: no app
// imports, so node --test and the route editor can import it.

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

// Start values from the April 2026 event, see the plan's Tuning Constants.
export const STOP_MAX_SPEED = 1.5; // m/s
export const STOP_SEG_MAX_M = 60;
export const STOP_MIN_S = 40;
export const STOP_MAX_S = 1200;
export const INTERSECTION_RADIUS_M = 25;
export const SIGNAL_RADIUS_M = 40;
export const TRAFFIC_MAX_S = 120;
export const SERVICE_REACH_M = 75;
export const LINK_MAX_M = 300;
export const COVER_RADIUS_M = 20;
export const SAMPLE_STEP_M = 10;
export const BASE = [10.751, 59.9535]; // lon, lat: Tåsen skole
export const BASE_RADIUS_M = 150;
export const THIN_STEP_M = 5;
export const MAX_GAP_M = 500;

export const ETA_MIN_PROGRESS = 0.2;
export const STRIPE_WIDTH = 8;

export const FALLBACK_COLORS = [
  '#e6194b',
  '#3cb44b',
  '#4363d8',
  '#f58231',
  '#911eb4',
  '#42d4f4',
  '#f032e6',
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

// 17:00 Oslo time on the Oslo date of `date`.
const osloFivePm = (date) => {
  const { year, month, day } = osloParts(date);
  const guess = new Date(Date.UTC(year, month - 1, day, 17));
  return new Date(guess.getTime() - (osloParts(guess).hour - 17) * 3600000);
};

// The time window of the event: from 17:00 Oslo, no end. Between 04:00 and 17:00
// it has not started (from is null). The URL parameters from and to override it.
export const trackingWindow = (now = new Date(), search = window.location.search) => {
  const params = new URLSearchParams(search);
  if (params.get('from')) {
    return {
      from: new Date(params.get('from')),
      to: params.get('to') ? new Date(params.get('to')) : null,
    };
  }
  const { hour } = osloParts(now);
  if (hour >= 4 && hour < 17) return { from: null, to: null };
  return { from: osloFivePm(hour < 4 ? new Date(now.getTime() - 5 * 3600000) : now), to: null };
};

const meters = (a, b) =>
  Math.hypot((a.lon - b.lon) * Math.cos((a.lat * Math.PI) / 180), a.lat - b.lat) * 111320;

// Merges new positions into a trace: time order, no duplicate ids, and a position
// kept only when it is THIN_STEP_M from the last kept one. The latest is always kept.
export const mergeTrace = (trace, positions) => {
  const byId = new Map([...trace, ...positions].map((q) => [q.id, q]));
  const sorted = [...byId.values()].sort((a, b) => a.time - b.time || a.id - b.id);
  const kept = [];
  sorted.forEach((q, i) => {
    if (
      !kept.length ||
      i === sorted.length - 1 ||
      meters(q, kept[kept.length - 1]) >= THIN_STEP_M
    ) {
      kept.push(q);
    }
  });
  return kept;
};

// OsmAnd intake for manual marks when the page is not served over https (dev server).
export const INTAKE_URL = 'https://inntak.koredu.no/';
