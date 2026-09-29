import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, INTAKE_URL } from '../map/main/plannedRoutes.js';
import {
  START_LINK,
  STATUS_MAX_AGE_S,
  STOP_LINK,
  TRACKER_SETTINGS,
  configLink,
  directionsLink,
  driverLink,
  eventDayWindow,
  formatAge,
  setupQrAddress,
  trackingStatus,
  untrackedVans,
} from './driverLink.js';

const query = (link) => new URLSearchParams(link.slice(link.indexOf('?') + 1));

test('driverLink puts the device id in the path and the token in the query', () => {
  const link = new URL(driverLink('https://kart.example', 12, 'abc'));
  assert.equal(link.pathname, '/sjafor/12');
  assert.equal(link.searchParams.get('token'), 'abc');
});

test('driverLink percent-encodes + / = in the token', () => {
  const link = driverLink('https://kart.example', 12, 'a+b/c=');
  assert.ok(link.endsWith('?token=a%2Bb%2Fc%3D'));
  assert.equal(new URL(link).searchParams.get('token'), 'a+b/c=');
});

test('configLink carries the intake address, the id and the settings', () => {
  const link = configLink('van-3');
  assert.ok(link.startsWith('org.traccar.client://config?'));
  assert.ok(link.includes(`url=${encodeURIComponent(INTAKE_URL)}`));
  assert.equal(query(link).get('id'), 'van-3');
});

test('configLink and setupQrAddress carry the same settings', () => {
  const config = query(configLink('van-3'));
  const qr = query(setupQrAddress('van-3'));
  Object.entries(TRACKER_SETTINGS).forEach(([key, value]) => {
    assert.equal(config.get(key), String(value));
    assert.equal(qr.get(key), String(value));
  });
});

test('setupQrAddress starts with the intake address and carries id, not url', () => {
  const address = setupQrAddress('van-3');
  assert.ok(address.startsWith(`${INTAKE_URL}?`));
  assert.equal(query(address).get('id'), 'van-3');
  assert.equal(query(address).get('url'), null);
});

test('a uniqueId with a space or & survives both forms', () => {
  [configLink('van 3&x'), setupQrAddress('van 3&x')].forEach((link) => {
    assert.ok(!link.includes('van 3&x'));
    assert.equal(query(link).get('id'), 'van 3&x');
  });
});

test('start and stop links', () => {
  assert.equal(START_LINK, 'org.traccar.client://action/start');
  assert.equal(STOP_LINK, 'org.traccar.client://action/stop');
});

test('directionsLink puts the latitude before the longitude', () => {
  const [lon, lat] = BASE;
  const link = new URL(directionsLink(lat, lon));
  assert.equal(link.searchParams.get('destination'), `${lat},${lon}`);
  assert.equal(link.searchParams.get('api'), '1');
});

const now = new Date('2026-10-09T16:30:00+02:00');
const at = (secondsAgo) => ({ fixTime: new Date(now.getTime() - secondsAgo * 1000).toISOString() });

test('trackingStatus: 10 s old with the socket on is tracked (AE2)', () => {
  assert.deepEqual(trackingStatus(at(10), true, now), { state: 'tracked', age: 10 });
});

test('trackingStatus: 5 min old is not tracked (AE3)', () => {
  assert.deepEqual(trackingStatus(at(300), true, now), { state: 'untracked', age: 300 });
});

test('trackingStatus: exactly STATUS_MAX_AGE_S old is tracked', () => {
  assert.equal(trackingStatus(at(STATUS_MAX_AGE_S), true, now).state, 'tracked');
  assert.equal(trackingStatus(at(STATUS_MAX_AGE_S + 1), true, now).state, 'untracked');
});

test('trackingStatus: no position is not tracked with no age', () => {
  assert.deepEqual(trackingStatus(undefined, true, now), { state: 'untracked', age: null });
});

test('trackingStatus: socket off or not yet connected is no contact (AE4)', () => {
  assert.equal(trackingStatus(at(10), false, now).state, 'offline');
  assert.equal(trackingStatus(at(10), null, now).state, 'offline');
});

test('trackingStatus: a fix time in the future gives age 0', () => {
  assert.deepEqual(trackingStatus(at(-30), true, now), { state: 'tracked', age: 0 });
});

test('formatAge: seconds, minutes, hours', () => {
  assert.equal(formatAge(10), '10 s');
  assert.equal(formatAge(300), '5 min');
  assert.equal(formatAge(3 * 3600 + 120), '3 t 2 min');
  assert.equal(formatAge(null), '');
});

const iso = (date) => date.toISOString();

test('eventDayWindow runs from 04:00 to 04:00 Oslo (AE9)', () => {
  const night = eventDayWindow(new Date('2026-10-10T01:30:00+02:00'), '');
  assert.equal(iso(night.from), '2026-10-09T02:00:00.000Z');
  assert.equal(iso(night.to), '2026-10-10T02:00:00.000Z');
  const morning = eventDayWindow(new Date('2026-10-10T04:30:00+02:00'), '');
  assert.equal(iso(morning.from), '2026-10-10T02:00:00.000Z');
  assert.equal(iso(morning.to), '2026-10-11T02:00:00.000Z');
});

test('eventDayWindow starts at 04:00 exactly', () => {
  const w = eventDayWindow(new Date('2026-10-10T04:00:00+02:00'), '');
  assert.equal(iso(w.from), '2026-10-10T02:00:00.000Z');
});

test('eventDayWindow starts at 04:00 Oslo in winter time and on clock-change days', () => {
  assert.equal(
    iso(eventDayWindow(new Date('2026-12-09T12:00:00+01:00'), '').from),
    '2026-12-09T03:00:00.000Z',
  );
  // 2026-03-29: clocks go forward at 02:00. 2026-10-25: clocks go back at 03:00.
  const spring = eventDayWindow(new Date('2026-03-29T12:00:00+02:00'), '');
  assert.equal(iso(spring.from), '2026-03-29T02:00:00.000Z');
  assert.equal(iso(spring.to), '2026-03-30T02:00:00.000Z');
  const autumn = eventDayWindow(new Date('2026-10-25T12:00:00+01:00'), '');
  assert.equal(iso(autumn.from), '2026-10-25T03:00:00.000Z');
  assert.equal(iso(autumn.to), '2026-10-26T03:00:00.000Z');
});

test('eventDayWindow takes from and to from the URL', () => {
  const w = eventDayWindow(new Date(), '?from=2026-04-10T15:00:00Z&to=2026-04-10T21:30:00Z');
  assert.equal(iso(w.from), '2026-04-10T15:00:00.000Z');
  assert.equal(iso(w.to), '2026-04-10T21:30:00.000Z');
});

const van = (id, name) => ({ id, name, attributes: {} });
const markDevice = { id: 99, name: 'Markering', attributes: { manualMarks: true } };
const devices = { 3: van(3, 'Bil 3'), 6: van(6, 'Bil 6'), 99: markDevice };
const evening = new Date('2026-10-09T18:45:00+02:00');
const dayWindow = eventDayWindow(evening, '');
const fix = (secondsAgo, time = evening) => ({
  fixTime: new Date(time.getTime() - secondsAgo * 1000).toISOString(),
});
const names = (result) => result.vans.map((v) => v.device.name);

test('untrackedVans lists a van 5 min old with its age, not one 10 s old (AE20)', () => {
  const result = untrackedVans(
    devices,
    { 3: fix(10), 6: fix(300), 99: fix(3600) },
    evening,
    dayWindow,
    [],
  );
  assert.deepEqual(
    result.vans.map((v) => [v.device.name, v.age]),
    [['Bil 6', 300]],
  );
});

test('untrackedVans lists a van with no position, also at 16:30 (AE20)', () => {
  const afternoon = new Date('2026-10-09T16:30:00+02:00');
  const result = untrackedVans(devices, {}, afternoon, eventDayWindow(afternoon, ''), []);
  assert.deepEqual(names(result), ['Bil 3', 'Bil 6']);
  assert.equal(result.vans[0].age, null);
});

test('untrackedVans never lists the virtual device, and sorts by name', () => {
  const many = { ...devices, 10: van(10, 'Bil 10') };
  assert.deepEqual(names(untrackedVans(many, {}, evening, dayWindow, [])), [
    'Bil 3',
    'Bil 6',
    'Bil 10',
  ]);
});

test('untrackedVans is empty when the window ended', () => {
  const past = eventDayWindow(evening, '?from=2026-04-10T15:00:00Z&to=2026-04-10T21:30:00Z');
  assert.deepEqual(untrackedVans(devices, {}, evening, past, []).vans, []);
});

test('untrackedVans: a done van is left out and keeps its mark while it is silent (AE23)', () => {
  const result = untrackedVans(devices, { 3: fix(10), 6: fix(600) }, evening, dayWindow, [6]);
  assert.deepEqual(result.vans, []);
  assert.deepEqual(result.done, [6]);
});

test('untrackedVans: a done van that reports loses its mark, then is listed again (AE23)', () => {
  const reporting = untrackedVans(devices, { 3: fix(10), 6: fix(10) }, evening, dayWindow, [6]);
  assert.deepEqual(reporting.done, []);
  const silent = untrackedVans(
    devices,
    { 3: fix(10), 6: fix(300) },
    evening,
    dayWindow,
    reporting.done,
  );
  assert.deepEqual(names(silent), ['Bil 6']);
});
