// Dev-only route editor, served by `npm start` at /route-editor.html.
// Keys 1-7 pick the route, a click on a stretch adds it to the route or removes it,
// Export downloads routes.geojson for public/.
import 'maplibre-gl/dist/maplibre-gl.css';
import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { ROUTE_COLORS, routeColorExpression } from '../src/map/main/plannedRoutes.js';

maplibregl.setWorkerUrl(maplibreWorkerUrl);

const [roads, planned] = await Promise.all(
  ['/routes/roads.geojson', '/routes.geojson'].map((url) => fetch(url).then((r) => r.json())),
);
const points = planned.features.filter((f) => f.geometry.type === 'Point');
let lines = planned.features.filter((f) => f.geometry.type === 'LineString');
let route = 1;
let dirty = false;

const status = document.getElementById('status');
const routeColor = routeColorExpression('#000');

const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors',
      },
    },
    layers: [{ id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-opacity': 0.6 } }],
  },
  bounds: [
    [10.715, 59.94],
    [10.78, 59.97],
  ],
});

window.map = map; // for debugging from the console

const update = () => {
  map.getSource('planned')?.setData({ type: 'FeatureCollection', features: lines });
  map.setPaintProperty('planned', 'line-opacity', [
    'case',
    ['==', ['get', 'route'], route],
    0.9,
    0.25,
  ]);
  document
    .querySelectorAll('button.route')
    .forEach((b) => b.classList.toggle('active', Number(b.dataset.route) === route));
  document.getElementById('scan-image').src = `/routes/rute-${route}.jpg`;
  const count = lines.filter((f) => f.properties.route === route).length;
  status.textContent = `Rute ${route}: ${count} stretches${dirty ? ' (unsaved)' : ''}`;
};

map.on('load', () => {
  map.addSource('roads', { type: 'geojson', data: roads });
  map.addSource('planned', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: lines },
  });
  map.addLayer({
    id: 'roads',
    type: 'line',
    source: 'roads',
    paint: { 'line-color': '#555', 'line-width': 2 },
  });
  map.addLayer({
    id: 'planned',
    type: 'line',
    source: 'planned',
    layout: { 'line-cap': 'round' },
    paint: {
      'line-color': routeColor,
      'line-width': 5,
      'line-offset': ['*', ['-', ['get', 'route'], 4], 2],
    },
  });
  map.addLayer({
    id: 'labels',
    type: 'symbol',
    source: 'roads',
    minzoom: 16,
    layout: { 'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-size': 11 },
    paint: { 'text-halo-color': '#fff', 'text-halo-width': 1.5 },
  });
  update();
});

map.on('click', (e) => {
  const { x, y } = e.point;
  const [hit] = map.queryRenderedFeatures(
    [
      [x - 6, y - 6],
      [x + 6, y + 6],
    ],
    { layers: ['roads'] },
  );
  if (!hit) return;
  const { id, name } = hit.properties;
  const exists = lines.some((f) => f.properties.id === id && f.properties.route === route);
  if (exists) {
    lines = lines.filter((f) => !(f.properties.id === id && f.properties.route === route));
  } else {
    const road = roads.features.find((f) => f.properties.id === id);
    lines = [
      ...lines,
      { type: 'Feature', geometry: road.geometry, properties: { id, route, name } },
    ];
  }
  dirty = true;
  update();
});

map.on('mousemove', 'roads', (e) => {
  map.getCanvas().style.cursor = 'pointer';
  map.getCanvas().title = `${e.features[0].properties.name} ${e.features[0].properties.id}`;
});
map.on('mouseleave', 'roads', () => {
  map.getCanvas().style.cursor = '';
});

Object.keys(ROUTE_COLORS).forEach((key) => {
  const button = document.createElement('button');
  button.className = 'route';
  button.dataset.route = key;
  button.textContent = key;
  button.style.background = ROUTE_COLORS[key];
  button.onclick = () => {
    route = Number(key);
    update();
  };
  document.getElementById('routes').append(button);
});

document.addEventListener('keydown', (e) => {
  if (ROUTE_COLORS[e.key]) {
    route = Number(e.key);
    update();
  }
});

document.getElementById('export').onclick = () => {
  const sorted = [...lines].sort((a, b) => a.properties.route - b.properties.route);
  const text = `{"type":"FeatureCollection","features":[\n${[...sorted, ...points].map((f) => JSON.stringify(f)).join(',\n')}\n]}\n`;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([text], { type: 'application/geo+json' }));
  link.download = 'routes.geojson';
  link.click();
  dirty = false;
  update();
};

window.addEventListener('beforeunload', (e) => {
  if (dirty) e.preventDefault();
});
