import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COVER_RADIUS_M, SERVICE_REACH_M, STOP_MIN_S } from './plannedRoutes.js';
import {
  buildRouteIndex,
  detectStops,
  computeCoverage,
  routeStatus,
  servicedFeatures,
} from './routeCoverage.js';

// Synthetic street grid about 1 km from the base. Positions in meters from ORIGIN.
const ORIGIN = [10.73, 59.96];
const M_LAT = 1 / 111320;
const M_LON = M_LAT / Math.cos((ORIGIN[1] * Math.PI) / 180);
const pt = (x, y) => [ORIGIN[0] + x * M_LON, ORIGIN[1] + y * M_LAT];
const T0 = Date.UTC(2026, 9, 9, 16, 0); // 18:00 Oslo
const MIN = 60000;
const close = (actual, expected, eps = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < eps, `${actual} != ${expected}`);

const line = (id, route, from, to, name = 'Gata') => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: [pt(...from), pt(...to)] },
  properties: { id, route, name },
});
const point = (kind, x, y) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: pt(x, y) },
  properties: { kind },
});

// Route 2 is a street along the x axis from 0 to 800 m, in 8 stretches of 100 m.
const street = Array.from({ length: 8 }, (_, i) =>
  line(`a-${i}`, 2, [i * 100, 0], [(i + 1) * 100, 0]),
);
const index = (extra = []) =>
  buildRouteIndex({ type: 'FeatureCollection', features: [...street, ...extra] });

// Builds a trace from steps: ['drive', x, y] at 10 m/s, or ['wait', seconds].
// One position per second, starting at x0,y0 at time t0.
const trace = (steps, { x0 = -200, y0 = 0, t0 = T0 } = {}) => {
  let [x, y, t] = [x0, y0, t0];
  const positions = [{ id: 1, lon: pt(x, y)[0], lat: pt(x, y)[1], time: t }];
  const push = () =>
    positions.push({ id: positions.length + 1, lon: pt(x, y)[0], lat: pt(x, y)[1], time: t });
  steps.forEach(([kind, a, b]) => {
    if (kind === 'wait') {
      for (let i = 0; i < a; i += 1) {
        t += 1000;
        push();
      }
    } else {
      const [dx, dy] = [a - x, b - y];
      const n = Math.max(1, Math.round(Math.hypot(dx, dy) / 10));
      const [sx, sy] = [dx / n, dy / n];
      for (let i = 0; i < n; i += 1) {
        x += sx;
        y += sy;
        t += 1000;
        push();
      }
    }
  });
  return positions;
};

const servicedRange = (idx, coverage, route = 2) => {
  const xs = idx.samples
    .map((s, i) => [s, coverage[i]])
    .filter(([s, c]) => s.route === route && c)
    .map(([s]) => Math.round((s.lon - ORIGIN[0]) / M_LON));
  return xs.length ? [Math.min(...xs), Math.max(...xs)] : null;
};

test('AE1: driving a whole street without stopping services nothing', () => {
  const idx = index();
  const t = trace([['drive', 1000, 0]]);
  assert.equal(detectStops(t, idx).length, 0);
  assert.equal(servicedRange(idx, computeCoverage(idx, { 1: t })), null);
});

test('AE2: two close stops service the path between them and the reach beyond', () => {
  const idx = index();
  const t = trace([
    ['drive', 200, 0],
    ['wait', 60],
    ['drive', 350, 0],
    ['wait', 60],
    ['drive', 1000, 0],
  ]);
  assert.equal(detectStops(t, idx).length, 2);
  const [from, to] = servicedRange(idx, computeCoverage(idx, { 1: t }));
  assert.ok(
    from >= 200 - SERVICE_REACH_M - COVER_RADIUS_M && from <= 200 - SERVICE_REACH_M + 5,
    `from ${from}`,
  );
  assert.ok(
    to <= 350 + SERVICE_REACH_M + COVER_RADIUS_M && to >= 350 + SERVICE_REACH_M - 5,
    `to ${to}`,
  );
});

test('two stops 600 m apart service only the reach around each', () => {
  const idx = index();
  const t = trace([
    ['drive', 100, 0],
    ['wait', 60],
    ['drive', 700, 0],
    ['wait', 60],
    ['drive', 1000, 0],
  ]);
  const coverage = computeCoverage(idx, { 1: t });
  const at = (x) =>
    coverage[idx.samples.findIndex((s) => Math.abs((s.lon - ORIGIN[0]) / M_LON - x) < 5)];
  assert.ok(at(105));
  assert.ok(at(695));
  assert.equal(at(405), undefined);
});

test('AE3: a van with another main route services the route it stops on', () => {
  const idx = index();
  const t = trace([
    ['drive', 300, 0],
    ['wait', 60],
    ['drive', 1000, 0],
  ]);
  const status = routeStatus(idx, computeCoverage(idx, { 7: t }), T0 + 30 * MIN);
  assert.ok(status[2].progress > 0);
  assert.ok(status[2].shares[7] > 0);
});

test('AE4: two vans on one stretch give two entries, counted once in progress', () => {
  const idx = index();
  const t = trace([
    ['drive', 300, 0],
    ['wait', 60],
    ['drive', 1000, 0],
  ]);
  const one = routeStatus(idx, computeCoverage(idx, { 1: t }), T0 + 30 * MIN)[2].progress;
  const coverage = computeCoverage(idx, { 1: t, 2: t });
  const serviced = coverage.filter(Boolean);
  assert.ok(serviced.every((c) => c.vans[1] && c.vans[2]));
  close(routeStatus(idx, coverage, T0 + 30 * MIN)[2].progress, one);
});

test('AE5: a long dwell at the base gives no stop', () => {
  const idx = index();
  const base = [10.751, 59.9535];
  const t = [0, 900].map((s, i) => ({ id: i, lon: base[0], lat: base[1], time: T0 + s * 1000 }));
  assert.equal(detectStops(t, idx).length, 0);
  const t2 = trace([['wait', 300]]).map((p) => ({ ...p, lon: base[0], lat: base[1] }));
  assert.equal(
    detectStops([{ ...t2[0], time: T0 - 5000, lon: base[0] + 0.01 }, ...t2], idx).length,
    0,
  );
});

test('dwell length limits: just under and over STOP_MIN_S, and 25 min', () => {
  const idx = index();
  const run = (s) =>
    detectStops(
      trace([
        ['drive', 300, 0],
        ['wait', s],
        ['drive', 1000, 0],
      ]),
      idx,
    ).length;
  assert.equal(run(STOP_MIN_S - 5), 0);
  assert.equal(run(STOP_MIN_S + 5), 1);
  assert.equal(run(25 * 60), 0);
});

test('a long reporting gap is no stop', () => {
  const idx = index();
  const t = [
    { id: 1, lon: pt(0, 0)[0], lat: pt(0, 0)[1], time: T0 },
    { id: 2, lon: pt(1, 0)[0], lat: pt(1, 0)[1], time: T0 + 1000 },
    { id: 3, lon: pt(401, 0)[0], lat: pt(401, 0)[1], time: T0 + 20 * MIN },
    { id: 4, lon: pt(420, 0)[0], lat: pt(420, 0)[1], time: T0 + 20 * MIN + 2000 },
  ];
  assert.equal(detectStops(t, idx).length, 0);
});

test('a slow crawl is one stop spanning the crawl', () => {
  const idx = index();
  const crawl = Array.from({ length: 180 }, (_, i) => ['drive', 200 + ((i + 1) * 80) / 180, 0]);
  const t = trace([['drive', 200, 0], ...crawl, ['drive', 1000, 0]]);
  const stops = detectStops(t, idx);
  assert.equal(stops.length, 1);
  assert.ok(stops[0].end - stops[0].start >= 170 * 1000);
});

test('sparse reporting: two positions 60 m and 90 s apart give a stop', () => {
  const idx = index();
  const t = [
    ...trace([['drive', 200, 0]]),
    { id: 100, lon: pt(259, 0)[0], lat: pt(259, 0)[1], time: T0 + 40000 + 90000 },
  ];
  t.push({ id: 101, lon: pt(400, 0)[0], lat: pt(400, 0)[1], time: T0 + 40000 + 105000 });
  assert.equal(detectStops(t, idx).length, 1);
});

test('dense zero-speed reporting gives one stop, not many', () => {
  const idx = index();
  assert.equal(
    detectStops(
      trace([
        ['drive', 300, 0],
        ['wait', 60],
        ['drive', 1000, 0],
      ]),
      idx,
    ).length,
    1,
  );
});

test('order and duplicates do not change the stops', () => {
  const idx = index();
  const t = trace([
    ['drive', 300, 0],
    ['wait', 60],
    ['drive', 1000, 0],
  ]);
  const expected = detectStops(t, idx);
  const shuffled = [...t];
  [shuffled[40], shuffled[41]] = [shuffled[41], shuffled[40]];
  assert.deepEqual(detectStops(shuffled, idx), expected);
  const duplicated = [...t.slice(0, 50), t[49], ...t.slice(50)];
  assert.deepEqual(detectStops(duplicated, idx), expected);
});

test('AE11: an isolated short stop at an intersection is a traffic stop', () => {
  const idx = index([point('intersection', 310, 0)]);
  const run = (s, extra = []) =>
    detectStops(trace([['drive', 300, 0], ['wait', s], ...extra, ['drive', 1500, 0]]), idx).length;
  assert.equal(run(70), 0);
  assert.equal(run(150), 1);
});

test('AE12: a stop at a corner with another stop nearby counts', () => {
  const idx = index([point('intersection', 310, 0)]);
  const t = trace([
    ['drive', 300, 0],
    ['wait', 70],
    ['drive', 380, 0],
    ['wait', 70],
    ['drive', 1500, 0],
  ]);
  assert.equal(detectStops(t, idx).length, 2);
});

test('an isolated short stop away from intersections counts', () => {
  const idx = index([point('intersection', 360, 0)]);
  assert.equal(
    detectStops(
      trace([
        ['drive', 300, 0],
        ['wait', 70],
        ['drive', 1500, 0],
      ]),
      idx,
    ).length,
    1,
  );
});

test('an isolated short stop near a traffic light is a traffic stop', () => {
  const idx = index([point('signal', 335, 0)]);
  assert.equal(
    detectStops(
      trace([
        ['drive', 300, 0],
        ['wait', 70],
        ['drive', 1500, 0],
      ]),
      idx,
    ).length,
    0,
  );
});

test('a traffic stop between two pickup stops does not break their link', () => {
  const idx = index([point('intersection', 450, 0)]);
  // Pickups at 300 and 550 (250 m apart), a traffic wait at 450 between them.
  const t = trace([
    ['drive', 300, 0],
    ['wait', 60],
    ['drive', 450, 0],
    ['wait', 60],
    ['drive', 550, 0],
    ['wait', 60],
    ['drive', 2000, 0],
  ]);
  const stops = detectStops(t, idx);
  assert.equal(stops.length, 3); // the wait at 450 is not isolated, so it counts too
  const [from, to] = servicedRange(idx, computeCoverage(idx, { 1: t }));
  assert.ok(from <= 230 && to >= 620);
});

test('AE10: a dwell under way at the first position is no stop', () => {
  const idx = index();
  const t = trace(
    [
      ['wait', 120],
      ['drive', 300, 0],
      ['wait', 60],
      ['drive', 1000, 0],
    ],
    { x0: 100 },
  );
  const stops = detectStops(t, idx);
  assert.equal(stops.length, 1);
  assert.ok(stops[0].start > T0 + 120 * 1000);
});

test('a stop on a parallel street 40 m away services nothing', () => {
  const idx = index();
  const t = trace(
    [
      ['drive', 300, 40],
      ['wait', 60],
      ['drive', 1000, 40],
    ],
    { y0: 40 },
  );
  assert.equal(servicedRange(idx, computeCoverage(idx, { 1: t })), null);
});

test('a sample across a grid cell border is found', () => {
  // The route runs 15 m north of the trace, around the grid cell size boundary.
  const features = Array.from({ length: 20 }, (_, i) =>
    line(`b-${i}`, 3, [i * 50, 15], [(i + 1) * 50, 15]),
  );
  const idx = buildRouteIndex({ type: 'FeatureCollection', features });
  const t = trace([
    ['drive', 300, 0],
    ['wait', 60],
    ['drive', 1000, 0],
  ]);
  const coverage = computeCoverage(idx, { 1: t });
  assert.ok(coverage.filter(Boolean).length >= 10);
});

test('a trace segment longer than MAX_GAP_M next to a stop is not serviced path', () => {
  const idx = index();
  const t = [
    ...trace(
      [
        ['drive', 300, 0],
        ['wait', 60],
      ],
      { x0: 290 },
    ),
  ];
  const last = t[t.length - 1];
  t.push({ id: 999, lon: pt(1000, 0)[0], lat: pt(1000, 0)[1], time: last.time + 60000 });
  const [, to] = servicedRange(idx, computeCoverage(idx, { 1: t }));
  assert.ok(to < 400, `to ${to}`);
});

test('a sample shared by two routes is serviced for both', () => {
  const shared = street.map((f) => ({ ...f, properties: { ...f.properties, route: 5 } }));
  const idx = index(shared);
  const t = trace([
    ['drive', 300, 0],
    ['wait', 60],
    ['drive', 1000, 0],
  ]);
  const status = routeStatus(idx, computeCoverage(idx, { 1: t }), T0 + 30 * MIN);
  assert.ok(status[2].progress > 0);
  close(status[5].progress, status[2].progress);
});

test('manual marks service their stretch; closed routes fill the rest', () => {
  const idx = index();
  const marked = computeCoverage(idx, {}, { stretches: { 'a-0': T0 }, routes: {} });
  close(routeStatus(idx, marked, T0)[2].progress, 1 / 8);
  const t = trace([
    ['drive', 300, 0],
    ['wait', 60],
    ['drive', 1000, 0],
  ]);
  const open = routeStatus(idx, computeCoverage(idx, { 1: t }), T0 + 30 * MIN)[2];
  const closedCoverage = computeCoverage(
    idx,
    { 1: t },
    { stretches: {}, routes: { 2: T0 + 20 * MIN } },
  );
  const closed = routeStatus(idx, closedCoverage, T0 + 30 * MIN)[2];
  assert.equal(closed.progress, 1);
  close(closed.shares[1], open.shares[1]);
  assert.ok(Math.abs(closed.manual - (1 - open.progress)) < 1e-9);
  assert.equal(closed.eta, null);
});

test('AE6 and AE7: ETA shows only between 20% and 100%', () => {
  const idx = index();
  const quarter = { stretches: { 'a-0': T0, 'a-1': T0 }, routes: {} };
  const status = routeStatus(idx, computeCoverage(idx, {}, quarter), T0 + 30 * MIN)[2];
  close(status.progress, 0.25);
  close(status.eta, T0 + 120 * MIN, 1000);
  const little = routeStatus(
    idx,
    computeCoverage(idx, {}, { stretches: { 'a-0': T0 }, routes: {} }),
    T0 + 30 * MIN,
  )[2];
  assert.equal(little.eta, null);
  const none = routeStatus(idx, computeCoverage(idx, {}), T0)[2];
  assert.equal(none.progress, 0);
  assert.equal(none.eta, null);
});

test('shares go to the first servicer and add up to the progress', () => {
  const idx = index();
  const t = trace([
    ['drive', 300, 0],
    ['wait', 60],
    ['drive', 1000, 0],
  ]);
  const later = t.map((p) => ({ ...p, time: p.time + 60 * MIN }));
  const coverage = computeCoverage(
    idx,
    { 1: t, 2: later },
    { stretches: { 'a-7': T0 }, routes: {} },
  );
  const status = routeStatus(idx, coverage, T0 + 90 * MIN)[2];
  assert.ok(status.shares[1] > 0);
  assert.equal(status.shares[2] || 0, 0);
  const sum = Object.values(status.shares).reduce((a, b) => a + b, 0) + status.manual;
  assert.ok(Math.abs(sum - status.progress) < 1e-9);
});

test('servicedFeatures draws one stripe per servicer, side by side', () => {
  const idx = index();
  const t = trace([
    ['drive', 300, 0],
    ['wait', 60],
    ['drive', 1000, 0],
  ]);
  const features = servicedFeatures(
    idx,
    computeCoverage(idx, { 1: t, 2: t }),
    (van) => ({ 1: '#111', 2: '#222' })[van],
  );
  const colors = new Set(features.map((f) => f.properties.color));
  assert.deepEqual([...colors].sort(), ['#111', '#222']);
  const offsets = new Set(features.map((f) => f.properties.offset));
  assert.equal(offsets.size, 2);
  const manual = servicedFeatures(
    idx,
    computeCoverage(idx, {}, { stretches: { 'a-0': T0 }, routes: {} }),
    () => '#111',
  );
  assert.equal(manual.length, 1);
  assert.equal(manual[0].properties.offset, 0);
});

test('slow driving services the street, normal driving does not', () => {
  const idx = index();
  const slow = [];
  let t = T0;
  for (let x = 0; x <= 500; x += 2.8) {
    t += 1000;
    slow.push({ id: slow.length + 1, lon: pt(x, 0)[0], lat: pt(x, 0)[1], time: t });
  }
  const [from, to] = servicedRange(idx, computeCoverage(idx, { 1: slow }));
  assert.ok(from <= 20 && to >= 480, `${from}-${to}`);
  assert.equal(servicedRange(idx, computeCoverage(idx, { 1: trace([['drive', 1000, 0]]) })), null);
});

test('a stop survives trace thinning when the phone reports every 10 s', async () => {
  const { mergeTrace } = await import('./plannedRoutes.js');
  const idx = index();
  const sparse = trace([
    ['drive', 300, 0],
    ['wait', 120],
    ['drive', 1000, 0],
  ]).filter((_, i) => i % 10 === 0);
  assert.equal(detectStops(sparse, idx).length, 1);
  const bulk = mergeTrace([], sparse);
  const live = sparse.reduce((t, q) => mergeTrace(t, [q]), []);
  assert.equal(detectStops(bulk, idx).length, 1);
  assert.deepEqual(live, bulk);
});

test('a route closed by hand is exactly 100% on the real route file', async () => {
  const { readFileSync } = await import('node:fs');
  const geojson = JSON.parse(
    readFileSync(new URL('../../../public/routes.geojson', import.meta.url)),
  );
  const idx = buildRouteIndex(geojson);
  const routes = Object.fromEntries(Object.keys(idx.routes).map((r) => [r, T0]));
  const status = routeStatus(idx, computeCoverage(idx, {}, { stretches: {}, routes }), T0);
  Object.values(status).forEach((s) => assert.equal(s.progress, 1));
});
