// Builds the road network and a draft of the planned routes from OpenStreetMap.
//
//   node scripts/build-route-network.mjs [--osm cache.json]
//
// With --osm, the Overpass response is read from the file, or fetched and saved
// there when the file does not exist. OVERPASS_URL selects another Overpass server.
//
// Writes routes/roads.geojson (every drivable stretch, for the route editor) and
// public/routes.geojson (the draft routes plus intersections and traffic lights).
// Stretch ids are `<way id>-<index>`. They change when OSM changes, so do not
// rerun this once the routes have been corrected by hand: it overwrites them.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const BBOX = [59.938, 10.712, 59.972, 10.782]; // south, west, north, east
const STRETCH_MAX_M = 100;

const DRIVABLE =
  'residential|living_street|unclassified|tertiary|secondary|primary|service|tertiary_link|secondary_link|primary_link';

const query = `[out:json][timeout:90];
(
  way["highway"~"^(${DRIVABLE})$"]["service"!~"^(driveway|parking_aisle|drive-through)$"]["access"!~"^(private|no)$"](${BBOX});
  node["highway"="traffic_signals"](${BBOX});
  node["crossing"="traffic_signals"](${BBOX});
);
out body;
>;
out skel qt;`;

const loadOsm = async () => {
  const flag = process.argv.indexOf('--osm');
  const cache = flag > 0 ? process.argv[flag + 1] : null;
  if (cache && existsSync(cache)) return JSON.parse(readFileSync(cache, 'utf8'));
  const response = await fetch(
    `${process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter'}`,
    {
      method: 'POST',
      headers: {
        'User-Agent': 'traccar-web route builder (kart.koredu.no)',
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ data: query }),
    },
  );
  if (!response.ok) throw new Error(`Overpass: ${response.status} ${await response.text()}`);
  const text = await response.text();
  if (cache) writeFileSync(cache, text);
  return JSON.parse(text);
};

const distance = ([lon1, lat1], [lon2, lat2]) => {
  const x = (lon2 - lon1) * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
  return Math.hypot(x, lat2 - lat1) * 111320;
};

const round = ([lon, lat]) => [Math.round(lon * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6];

// Cuts a polyline into `count` pieces of equal length.
const cut = (coords, count) => {
  const lengths = coords.slice(1).map((c, i) => distance(coords[i], c));
  const step = lengths.reduce((a, b) => a + b, 0) / count;
  const pieces = [];
  let piece = [coords[0]];
  let left = step;
  for (let i = 0; i < lengths.length; i += 1) {
    const [a, b] = [coords[i], coords[i + 1]];
    let pos = 0;
    while (pieces.length < count - 1 && lengths[i] > 0 && lengths[i] - pos >= left) {
      pos += left;
      const t = pos / lengths[i];
      const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      piece.push(p);
      pieces.push(piece);
      piece = [p];
      left = step;
    }
    left -= lengths[i] - pos;
    piece.push(coords[i + 1]);
  }
  pieces.push(piece);
  return pieces;
};

const osm = await loadOsm();
const nodes = new Map();
const ways = [];
const signals = [];
osm.elements.forEach((e) => {
  if (e.type === 'node') {
    nodes.set(e.id, [e.lon, e.lat]);
    if (e.tags?.highway === 'traffic_signals' || e.tags?.crossing === 'traffic_signals') {
      signals.push(e.id);
    }
  } else if (e.type === 'way' && e.tags?.highway) {
    ways.push(e);
  }
});

// Node degree: an endpoint of a way adds 1, an inner node adds 2. A node where two
// ways of the same street meet end to end has degree 2 and is no intersection.
const degree = (filter) => {
  const result = new Map();
  ways.filter(filter).forEach((way) => {
    way.nodes.forEach((id, i) => {
      const end = i === 0 || i === way.nodes.length - 1;
      result.set(id, (result.get(id) || 0) + (end ? 1 : 2));
    });
  });
  return result;
};
const splitDegree = degree(() => true);
const streetDegree = degree((way) => way.tags.highway !== 'service');

const stretches = [];
ways.forEach((way) => {
  let index = 0;
  let part = [];
  way.nodes.forEach((id, i) => {
    part.push(nodes.get(id));
    const last = i === way.nodes.length - 1;
    if (part.length > 1 && (last || splitDegree.get(id) >= 3)) {
      const length = part.slice(1).reduce((sum, c, j) => sum + distance(part[j], c), 0);
      cut(part, Math.max(1, Math.ceil(length / STRETCH_MAX_M))).forEach((coords) => {
        stretches.push({
          id: `${way.id}-${index}`,
          name: way.tags.name || '',
          coords: coords.map(round),
        });
        index += 1;
      });
      part = [nodes.get(id)];
    }
  });
});

const middle = (s) => s.coords[Math.floor(s.coords.length / 2)];

const config = JSON.parse(readFileSync('routes/route-streets.json', 'utf8'));
const routeFeatures = [];
// A street is a name, or [name, west, south, east, north] to use its own box
// instead of the route's box.
Object.entries(config).forEach(([route, { box, streets }]) => {
  streets.forEach((street) => {
    const [name, ...own] = Array.isArray(street) ? street : [street];
    const [west, south, east, north] = own.length ? own : box;
    const matches = stretches.filter((s) => {
      const [x, y] = middle(s);
      return s.name === name && x >= west && x <= east && y >= south && y <= north;
    });
    matches.forEach((s) => {
      routeFeatures.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: s.coords },
        properties: { id: s.id, route: Number(route), name: s.name },
      });
    });
    console.log(`route ${route}: ${name}: ${matches.length || 'NO MATCH'}`);
  });
});

const area = routeFeatures.flatMap((f) => f.geometry.coordinates);
const box = [
  Math.min(...area.map((p) => p[0])) - 0.005,
  Math.min(...area.map((p) => p[1])) - 0.003,
  Math.max(...area.map((p) => p[0])) + 0.005,
  Math.max(...area.map((p) => p[1])) + 0.003,
];
const near = ([x, y]) => x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3];
const pointFeatures = [
  ...[...streetDegree].filter(([, d]) => d >= 3).map(([id]) => ['intersection', id]),
  ...signals.map((id) => ['signal', id]),
]
  .map(([kind, id]) => [kind, round(nodes.get(id))])
  .filter(([, coords]) => near(coords))
  .map(([kind, coords]) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: coords },
    properties: { kind },
  }));

const collection = (features) =>
  `{"type":"FeatureCollection","features":[\n${features.map((f) => JSON.stringify(f)).join(',\n')}\n]}\n`;

writeFileSync(
  'routes/roads.geojson',
  collection(
    stretches
      .filter((s) => near(middle(s)))
      .map((s) => ({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: s.coords },
        properties: { id: s.id, name: s.name },
      })),
  ),
);
writeFileSync('public/routes.geojson', collection([...routeFeatures, ...pointFeatures]));
console.log(
  `${stretches.length} stretches, ${routeFeatures.length} route stretches, ${pointFeatures.length} points`,
);
