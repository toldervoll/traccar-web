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
  setupQrAddress,
  trackingStatus,
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
