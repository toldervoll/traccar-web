import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROUTE_COLORS,
  isVan,
  mainRouteOf,
  mergeTrace,
  trackingWindow,
  vanColor,
} from './plannedRoutes.js';

const device = (attributes = {}, id = 1) => ({ id, attributes });

test('mainRouteOf parses the route attribute', () => {
  assert.equal(mainRouteOf(device({ route: '3' })), 3);
  assert.equal(mainRouteOf(device({ route: 3 })), 3);
  [undefined, 0, 8, 'abc'].forEach((route) => assert.equal(mainRouteOf(device({ route })), null));
});

test('vanColor: report color, then route color, then palette', () => {
  assert.equal(vanColor(device({ 'web.reportColor': '#123456', route: 2 })), '#123456');
  assert.equal(vanColor(device({ route: 2 })), ROUTE_COLORS[2]);
  assert.match(vanColor(device({}, 5)), /^#[0-9a-f]{6}$/i);
});

test('isVan is false for the manual marks device', () => {
  assert.equal(isVan(device({ manualMarks: true })), false);
  assert.equal(isVan(device({})), true);
});

const oslo = (iso) => new Date(iso); // ISO strings below carry the Oslo offset

test('trackingWindow starts at 17:00 Oslo in summer and winter time', () => {
  assert.equal(
    trackingWindow(oslo('2026-10-09T18:00:00+02:00'), '').from.toISOString(),
    '2026-10-09T15:00:00.000Z',
  );
  assert.equal(
    trackingWindow(oslo('2026-12-09T18:00:00+01:00'), '').from.toISOString(),
    '2026-12-09T16:00:00.000Z',
  );
});

test('trackingWindow has not started before 17:00 and after 04:00', () => {
  assert.equal(trackingWindow(oslo('2026-10-09T16:30:00+02:00'), '').from, null);
  assert.equal(
    trackingWindow(oslo('2026-10-09T17:00:00+02:00'), '').from.toISOString(),
    '2026-10-09T15:00:00.000Z',
  );
  assert.equal(
    trackingWindow(oslo('2026-10-10T01:30:00+02:00'), '').from.toISOString(),
    '2026-10-09T15:00:00.000Z',
  );
  assert.equal(trackingWindow(oslo('2026-10-10T04:30:00+02:00'), '').from, null);
  assert.equal(trackingWindow(oslo('2026-10-09T18:00:00+02:00'), '').to, null);
});

test('trackingWindow takes from and to from the URL', () => {
  const w = trackingWindow(new Date(), '?from=2026-04-10T15:00:00Z&to=2026-04-10T21:30:00Z');
  assert.equal(w.from.toISOString(), '2026-04-10T15:00:00.000Z');
  assert.equal(w.to.toISOString(), '2026-04-10T21:30:00.000Z');
});

const p = (id, x, time) => ({ id, lon: 10.73 + x / 55700, lat: 59.96, time });

test('mergeTrace orders by time, drops duplicate ids and thins', () => {
  const merged = mergeTrace(
    [p(1, 0, 0), p(3, 20, 3000)],
    [p(2, 10, 1000), p(3, 20, 3000), p(4, 21, 4000), p(5, 22, 5000)],
  );
  assert.deepEqual(
    merged.map((q) => q.id),
    [1, 2, 3, 5],
  );
});
