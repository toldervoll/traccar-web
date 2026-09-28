// Turns planned routes, van traces and manual marks into serviced samples,
// progress and ETA. Pure module (see plannedRoutes.js).
import {
  BASE,
  BASE_RADIUS_M,
  COVER_RADIUS_M,
  ETA_MIN_PROGRESS,
  INTERSECTION_RADIUS_M,
  LINK_MAX_M,
  MANUAL_COLOR,
  MAX_GAP_M,
  SAMPLE_STEP_M,
  SERVICE_REACH_M,
  SIGNAL_RADIUS_M,
  SLOW_DRIVE_SPEED,
  SLOW_SEG_MAX_M,
  STOP_MAX_S,
  STOP_MAX_SPEED,
  STOP_MIN_S,
  STOP_SEG_MAX_M,
  STRIPE_WIDTH,
  TRAFFIC_MAX_S,
} from './plannedRoutes.js';

// Equirectangular projection to meters, good enough within a city.
const K_LAT = 111320;
const K_LON = K_LAT * Math.cos((59.95 * Math.PI) / 180);
const project = ([lon, lat]) => [lon * K_LON, lat * K_LAT];
const CELL = 25;
const BASE_XY = project(BASE);

const cellKey = (cx, cy) => `${cx},${cy}`;

const makeGrid = () => new Map();

const addToGrid = (grid, x, y, value) => {
  const key = cellKey(Math.floor(x / CELL), Math.floor(y / CELL));
  if (!grid.has(key)) grid.set(key, []);
  grid.get(key).push(value);
};

// Values in the cells that overlap the box, expanded by r.
const queryGrid = (grid, x0, y0, x1, y1, r) => {
  const result = [];
  for (
    let cx = Math.floor((Math.min(x0, x1) - r) / CELL);
    cx <= Math.floor((Math.max(x0, x1) + r) / CELL);
    cx += 1
  ) {
    for (
      let cy = Math.floor((Math.min(y0, y1) - r) / CELL);
      cy <= Math.floor((Math.max(y0, y1) + r) / CELL);
      cy += 1
    ) {
      const values = grid.get(cellKey(cx, cy));
      if (values) result.push(...values);
    }
  }
  return result;
};

const segmentDistance = (px, py, ax, ay, bx, by) => {
  const [dx, dy] = [bx - ax, by - ay];
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

const cumulative = (xy) => {
  const cum = [0];
  for (let i = 1; i < xy.length; i += 1) {
    cum.push(cum[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
  }
  return cum;
};

// Point at distance d along a polyline, as [lon, lat].
const along = (coords, cum, d) => {
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i += 1;
  const span = cum[i] - cum[i - 1];
  const t = span ? Math.max(0, Math.min(1, (d - cum[i - 1]) / span)) : 0;
  return [
    coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t,
    coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t,
  ];
};

const slice = (coords, cum, from, to) => [
  along(coords, cum, from),
  ...coords.filter((_, i) => cum[i] > from && cum[i] < to),
  along(coords, cum, to),
];

export const buildRouteIndex = (geojson) => {
  const stretches = [];
  const samples = [];
  const grid = makeGrid();
  const nodes = { intersection: makeGrid(), signal: makeGrid() };
  const routes = {};
  geojson.features.forEach((feature) => {
    const { geometry, properties } = feature;
    if (geometry.type === 'Point') {
      const [x, y] = project(geometry.coordinates);
      if (nodes[properties.kind]) addToGrid(nodes[properties.kind], x, y, [x, y]);
      return;
    }
    if (geometry.type !== 'LineString') return;
    // Every stretch runs west to east (south to north), so stripes keep their side.
    const [first, last] = [geometry.coordinates[0], geometry.coordinates.at(-1)];
    const reversed = first[0] > last[0] || (first[0] === last[0] && first[1] > last[1]);
    const coords = reversed ? [...geometry.coordinates].reverse() : geometry.coordinates;
    const xy = coords.map(project);
    const cum = cumulative(xy);
    const length = cum[cum.length - 1];
    const count = Math.max(1, Math.round(length / SAMPLE_STEP_M));
    const stretch = { ...properties, coords, cum, length, samples: [] };
    stretches.push(stretch);
    routes[properties.route] ||= { length: 0, samples: [] };
    routes[properties.route].length += length;
    for (let i = 0; i < count; i += 1) {
      const d = ((i + 0.5) * length) / count;
      const [lon, lat] = along(coords, cum, d);
      const [x, y] = project([lon, lat]);
      const index = samples.length;
      samples.push({
        route: properties.route,
        id: properties.id,
        stretch: stretches.length - 1,
        lon,
        lat,
        x,
        y,
        w: length / count,
        from: (i * length) / count,
        to: ((i + 1) * length) / count,
      });
      stretch.samples.push(index);
      routes[properties.route].samples.push(index);
      addToGrid(grid, x, y, index);
    }
  });
  return { stretches, samples, grid, nodes, routes };
};

const prepare = (trace) => {
  const points = [...trace]
    .sort((a, b) => a.time - b.time || a.id - b.id)
    .map((p) => ({ ...p, xy: project([p.lon, p.lat]) }));
  return { points, cum: cumulative(points.map((p) => p.xy)) };
};

const near = (grid, [x, y], r) =>
  queryGrid(grid, x, y, x, y, r).some(([nx, ny]) => Math.hypot(nx - x, ny - y) <= r);

const findStops = ({ points, cum }, index) => {
  const candidates = [];
  let run = null;
  const close = () => {
    if (run && run.a > 0) {
      const duration = (points[run.b].time - points[run.a].time) / 1000;
      const at = points[run.longest].xy;
      if (
        duration >= STOP_MIN_S &&
        duration <= STOP_MAX_S &&
        Math.hypot(at[0] - BASE_XY[0], at[1] - BASE_XY[1]) > BASE_RADIUS_M
      ) {
        const { lon, lat } = points[run.longest];
        candidates.push({
          start: points[run.a].time,
          end: points[run.b].time,
          lon,
          lat,
          xy: at,
          startAt: cum[run.a],
          endAt: cum[run.b],
          duration,
        });
      }
    }
    run = null;
  };
  for (let i = 0; i < points.length - 1; i += 1) {
    const dt = (points[i + 1].time - points[i].time) / 1000;
    if (dt > 0) {
      const d = cum[i + 1] - cum[i];
      if (d <= STOP_SEG_MAX_M && d / dt < STOP_MAX_SPEED) {
        if (!run) run = { a: i, b: i + 1, longest: i, longestDt: dt };
        run.b = i + 1;
        if (dt > run.longestDt) Object.assign(run, { longest: i, longestDt: dt });
      } else {
        close();
      }
    }
  }
  close();
  return candidates.map((stop) => {
    const atCrossing =
      near(index.nodes.intersection, stop.xy, INTERSECTION_RADIUS_M) ||
      near(index.nodes.signal, stop.xy, SIGNAL_RADIUS_M);
    const isolated = !candidates.some(
      (other) =>
        other !== stop &&
        other.startAt - stop.endAt <= LINK_MAX_M &&
        stop.startAt - other.endAt <= LINK_MAX_M,
    );
    return { ...stop, traffic: atCrossing && isolated && stop.duration < TRAFFIC_MAX_S };
  });
};

const publicStop = ({ start, end, lon, lat, traffic }) => ({ start, end, lon, lat, traffic });

// Pickup stops of one trace. With `withTraffic`, traffic stops are included and flagged.
export const detectStops = (trace, index, { withTraffic = false } = {}) =>
  findStops(prepare(trace), index)
    .filter((stop) => withTraffic || !stop.traffic)
    .map(publicStop);

const mark = (coverage, i, van, time) => {
  coverage[i] ||= { vans: {} };
  if (van === 'manual') {
    if (coverage[i].manual === undefined || time < coverage[i].manual) coverage[i].manual = time;
  } else if (coverage[i].vans[van] === undefined || time < coverage[i].vans[van]) {
    coverage[i].vans[van] = time;
  }
};

// Per sample: undefined, or { vans: { vanId: first service time }, manual: time }.
// marks: { stretches: { stretchId: time }, routes: { route: time } }, the marks that are on.
export const computeCoverage = (index, traces, marks = { stretches: {}, routes: {} }) => {
  const coverage = new Array(index.samples.length);
  const markNear = (van, time, ax, ay, bx, by) => {
    queryGrid(index.grid, ax, ay, bx, by, COVER_RADIUS_M).forEach((s) => {
      const sample = index.samples[s];
      if (segmentDistance(sample.x, sample.y, ax, ay, bx, by) <= COVER_RADIUS_M) {
        mark(coverage, s, van, time);
      }
    });
  };
  Object.entries(traces).forEach(([van, trace]) => {
    const prepared = prepare(trace);
    const { points, cum } = prepared;
    // Slow driving away from the base counts as service: vans crawl while collecting.
    for (let i = 0; i < points.length - 1; i += 1) {
      const length = cum[i + 1] - cum[i];
      const dt = (points[i + 1].time - points[i].time) / 1000;
      const [a, b] = [points[i].xy, points[i + 1].xy];
      const middle = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (
        dt > 0 &&
        length > 0 &&
        length <= SLOW_SEG_MAX_M &&
        length / dt < SLOW_DRIVE_SPEED &&
        i > 0 &&
        Math.hypot(middle[0] - BASE_XY[0], middle[1] - BASE_XY[1]) > BASE_RADIUS_M
      ) {
        markNear(van, points[i].time, a[0], a[1], b[0], b[1]);
      }
    }
    const stops = findStops(prepared, index).filter((stop) => !stop.traffic);
    stops.forEach((stop, k) => {
      const from = stop.startAt - SERVICE_REACH_M;
      let to = stop.endAt + SERVICE_REACH_M;
      const next = stops[k + 1];
      if (next && next.startAt - stop.endAt <= LINK_MAX_M) to = Math.max(to, next.startAt);
      for (let i = 0; i < points.length - 1; i += 1) {
        const length = cum[i + 1] - cum[i];
        if (cum[i + 1] >= from && cum[i] <= to && length <= MAX_GAP_M) {
          const [a, b] = [points[i].xy, points[i + 1].xy];
          const t0 = length ? Math.max(0, (from - cum[i]) / length) : 0;
          const t1 = length ? Math.min(1, (to - cum[i]) / length) : 1;
          const [ax, ay] = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0];
          const [bx, by] = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
          markNear(van, stop.start, ax, ay, bx, by);
        }
      }
    });
  });
  index.stretches.forEach((stretch) => {
    const time = marks.stretches?.[stretch.id];
    if (time !== undefined) stretch.samples.forEach((s) => mark(coverage, s, 'manual', time));
  });
  Object.entries(marks.routes || {}).forEach(([route, time]) => {
    index.routes[route]?.samples.forEach((s) => {
      if (!coverage[s]) mark(coverage, s, 'manual', time);
    });
  });
  return coverage;
};

// The earliest servicer of a sample: a van id, or 'manual'.
const firstServicer = (entry) => {
  let [owner, first] = entry.manual !== undefined ? ['manual', entry.manual] : [null, Infinity];
  Object.entries(entry.vans).forEach(([van, time]) => {
    if (time < first) [owner, first] = [van, time];
  });
  return [owner, first];
};

// Per route: progress (0-1), shares per van and manual (they add up to progress),
// start time of the first service, and the ETA (null outside the 20-100% range).
export const routeStatus = (index, coverage, now) => {
  const result = {};
  Object.entries(index.routes).forEach(([route, { length, samples }]) => {
    const shares = {};
    let [serviced, manual, start] = [0, 0, null];
    samples.forEach((s) => {
      const entry = coverage[s];
      if (!entry) return;
      const { w } = index.samples[s];
      const [owner, time] = firstServicer(entry);
      serviced += w;
      if (owner === 'manual') manual += w;
      else shares[owner] = (shares[owner] || 0) + w;
      if (start === null || time < start) start = time;
    });
    let progress = length ? serviced / length : 0;
    if (progress > 1 - 1e-9) progress = 1;
    Object.keys(shares).forEach((van) => {
      shares[van] /= length;
    });
    const eta =
      progress > ETA_MIN_PROGRESS && progress < 1 - 1e-9 ? start + (now - start) / progress : null;
    result[route] = { progress, shares, manual: length ? manual / length : 0, start, eta };
  });
  return result;
};

// Line features for the serviced stripes: one per run of samples per servicer,
// with color, width and offset so several servicers show side by side.
export const servicedFeatures = (index, coverage, colorOf) => {
  const features = [];
  index.stretches.forEach((stretch) => {
    const entries = stretch.samples.map((s) => coverage[s]);
    const servicers = [
      ...new Set(
        entries.flatMap((e) =>
          e ? [...Object.keys(e.vans), ...(e.manual !== undefined ? ['manual'] : [])] : [],
        ),
      ),
    ];
    if (!servicers.length) return;
    servicers.sort(
      (a, b) =>
        (a === 'manual') - (b === 'manual') || a.localeCompare(b, undefined, { numeric: true }),
    );
    const width = STRIPE_WIDTH / servicers.length;
    servicers.forEach((servicer, slot) => {
      const has = (e) =>
        e && (servicer === 'manual' ? e.manual !== undefined : e.vans[servicer] !== undefined);
      let first = null;
      entries.forEach((entry, i) => {
        if (has(entry) && first === null) first = i;
        if (first !== null && (i === entries.length - 1 || !has(entries[i + 1]))) {
          const from = index.samples[stretch.samples[first]].from;
          const to = index.samples[stretch.samples[i]].to;
          const coordinates = slice(stretch.coords, stretch.cum, from, to);
          features.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates },
            properties: {
              route: stretch.route,
              van: servicer,
              color: servicer === 'manual' ? MANUAL_COLOR : colorOf(servicer),
              width,
              offset: (slot - (servicers.length - 1) / 2) * width,
            },
          });
          first = null;
        }
      });
    });
  });
  return features;
};
