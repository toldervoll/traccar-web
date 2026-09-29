import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE } from '../map/main/plannedRoutes.js';
import {
  MANAGER,
  MSG_LOAD_RETRIES,
  MSG_LOAD_RETRY_S,
  MSG_PREFIX,
  buildMessageReport,
  messageError,
  messagesFromPositions,
  messageWindow,
  okAnswers,
  retryDelay,
  unreadCount,
  visibleTo,
} from './messages.js';

const vans = new Set(['3', '5', '7']);
const body = (fields) => Object.fromEntries(new URLSearchParams(buildMessageReport(fields)));

// A position as the server returns it, from a report body.
const position = (id, attributes, fixTime = '2026-10-09T18:00:00Z') => ({
  id,
  fixTime,
  attributes,
});
const fromBody = (id, fields) => {
  const attributes = body(fields);
  ['id', 'lat', 'lon'].forEach((key) => delete attributes[key]);
  const parsed = Object.fromEntries(
    Object.entries(attributes).map(([k, v]) => [k, /^\d+$/.test(v) ? Number(v) : v]),
  );
  return position(id, parsed);
};

test('a report from the manager to van 3 carries the fields and no time', () => {
  const report = body({ uniqueId: 'virtual-1', from: MANAGER, to: '3', text: 'Hei' });
  assert.deepEqual(Object.keys(report).sort(), ['id', 'lat', 'lon', 'msgFrom', 'msgText', 'msgTo']);
  assert.equal(report.msgFrom, 'leder');
  assert.equal(report.msgTo, '3');
  assert.equal(report.msgText, `${MSG_PREFIX}Hei`);
});

test('the report carries the coordinates of BASE', () => {
  const report = body({ uniqueId: 'virtual-1', from: MANAGER, to: '3', text: 'Hei' });
  assert.equal(Number(report.lon), BASE[0]);
  assert.equal(Number(report.lat), BASE[1]);
});

test('texts that look like a number or a boolean come back as text (AE10)', () => {
  const messages = messagesFromPositions(
    [
      fromBody(1, { uniqueId: 'v', from: '3', to: MANAGER, text: '10' }),
      fromBody(2, { uniqueId: 'v', from: '3', to: MANAGER, text: 'true' }),
    ],
    vans,
  );
  assert.deepEqual(
    messages.map((m) => m.text),
    ['10', 'true'],
  );
});

test('Norwegian letters survive the report body and the reader (R26)', () => {
  const text = 'Kjør til Tåsen, så ferdig';
  const [message] = messagesFromPositions(
    [fromBody(1, { uniqueId: 'v', from: MANAGER, to: 'alle', text })],
    vans,
  );
  assert.equal(message.text, text);
});

test('an empty text, spaces only, and 501 characters are rejected; 500 is accepted', () => {
  assert.ok(messageError(''));
  assert.ok(messageError('   '));
  assert.equal(messageError('x'.repeat(500)), null);
  assert.ok(messageError('x'.repeat(501)));
  assert.throws(() => buildMessageReport({ uniqueId: 'v', from: MANAGER, to: '3', text: ' ' }));
});

test('an OK answer carries OK, the recipient leder and the answered id', () => {
  const report = body({ uniqueId: 'v', from: '3', to: MANAGER, text: 'OK', re: 120 });
  assert.equal(report.msgText, `${MSG_PREFIX}OK`);
  assert.equal(report.msgTo, 'leder');
  assert.equal(report.msgRe, '120');
});

const msg = (id, from, to, text = 'x', extra = {}) =>
  position(id, { msgFrom: from, msgTo: to, msgText: `${MSG_PREFIX}${text}`, ...extra });

test('the reader orders by position id as a number, not by fix time', () => {
  const messages = messagesFromPositions(
    [
      position(1000, { msgFrom: 'leder', msgTo: 'alle', msgText: 't:b' }, '2026-10-09T17:00:00Z'),
      position(999, { msgFrom: 'leder', msgTo: 'alle', msgText: 't:a' }, '2026-10-09T18:00:00Z'),
    ],
    vans,
  );
  assert.deepEqual(
    messages.map((m) => m.id),
    [999, 1000],
  );
});

test('the reader accepts van ids as numbers and as strings', () => {
  const messages = messagesFromPositions([msg(1, 3, 'leder'), msg(2, 'leder', '3')], vans);
  assert.deepEqual(
    messages.map((m) => [m.from, m.to]),
    [
      ['3', 'leder'],
      ['leder', '3'],
    ],
  );
});

test('the reader ignores bad reports and never throws', () => {
  const bad = [
    position(1, { stretches: 'a', on: true }),
    position(2, { msgFrom: 'leder', msgTo: '3', msgText: 'no prefix' }),
    position(3, { msgFrom: 'leder', msgTo: '3', msgText: 10 }),
    position(4, { msgFrom: 'leder', msgText: 't:x' }),
    msg(5, 'leder', '3', 'x'.repeat(5000)),
    msg(6, 'sjef', '3'),
    msg(7, '9', 'leder'),
    msg(8, 'leder', '9'),
    { id: 9 },
  ];
  assert.deepEqual(messagesFromPositions(bad, vans), []);
});

test('HTML and links come back unchanged', () => {
  const messages = messagesFromPositions(
    [msg(1, 'leder', 'alle', '<b>x</b>'), msg(2, 'leder', 'alle', 'https://example.com')],
    vans,
  );
  assert.deepEqual(
    messages.map((m) => m.text),
    ['<b>x</b>', 'https://example.com'],
  );
});

const sample = messagesFromPositions(
  [msg(1, 'leder', '3'), msg(2, 'leder', 'alle'), msg(3, '3', 'leder'), msg(4, '5', 'leder')],
  vans,
);
const ids = (messages) => messages.map((m) => m.id);

test('visibility: to van 3, to alle, from van 3 (AE6)', () => {
  assert.deepEqual(ids(visibleTo(sample, '3')), [1, 2, 3]);
  assert.deepEqual(ids(visibleTo(sample, '5')), [2, 4]);
  assert.deepEqual(ids(visibleTo(sample, MANAGER)), [1, 2, 3, 4]);
});

const answers = messagesFromPositions(
  [
    msg(120, 'leder', 'alle'),
    msg(121, '3', 'leder', 'OK', { msgRe: 120 }),
    msg(122, '5', 'leder', 'OK', { msgRe: 120 }),
    msg(123, '3', 'leder', 'OK', { msgRe: 120 }),
    msg(124, '7', 'leder', 'OK', { msgRe: 999 }),
    msg(125, 'leder', '3'),
  ],
  vans,
);
const byId = (id) => answers.find((m) => m.id === id);

test('OK answers list each van once (AE7)', () => {
  assert.deepEqual(okAnswers(answers, byId(120), ['3', '5', '7']), {
    ok: ['3', '5'],
    missing: ['7'],
  });
});

test('an OK answer to an unknown id is a normal message', () => {
  assert.equal(byId(124).text, 'OK');
  assert.equal(byId(124).re, 999);
});

test('a message to alle expects every van; one to van 3 expects van 3 (AE21)', () => {
  const one = messagesFromPositions(
    [msg(1, 'leder', 'alle'), msg(2, '3', 'leder', 'OK', { msgRe: 1 }), msg(3, 'leder', '3')],
    vans,
  );
  assert.deepEqual(okAnswers(one, one[0], ['3', '5', '7']), { ok: ['3'], missing: ['5', '7'] });
  assert.deepEqual(okAnswers(one, one[2], ['3', '5', '7']), { ok: [], missing: ['3'] });
});

test('a message from a driver has no list of answers', () => {
  assert.equal(okAnswers(answers, byId(121), ['3', '5', '7']), null);
});

test('retryDelay doubles and stops after MSG_LOAD_RETRIES', () => {
  assert.equal(retryDelay(1), MSG_LOAD_RETRY_S);
  assert.equal(retryDelay(2), 2 * MSG_LOAD_RETRY_S);
  assert.equal(retryDelay(MSG_LOAD_RETRIES + 1), null);
});

test('unreadCount counts incoming messages above the last read id', () => {
  const list = messagesFromPositions(
    [
      msg(120, 'leder', '3'),
      msg(121, 'leder', '3'),
      msg(122, 'leder', 'alle'),
      msg(123, '3', 'leder'),
    ],
    vans,
  );
  assert.equal(unreadCount(list, '3', 120), 2);
  assert.equal(unreadCount(list, '3', null), 3);
  assert.equal(unreadCount(list, MANAGER, 122), 1);
});

test('with the last read id 999, message 1000 is unread', () => {
  const list = messagesFromPositions([msg(999, 'leder', '3'), msg(1000, 'leder', '3')], vans);
  assert.equal(unreadCount(list, '3', 999), 1);
});

test('messageWindow is the event day, and a message from 23:50 and 01:00 is in it at 01:30 (AE9)', () => {
  const inside = (w, iso) => new Date(iso) >= w.from && new Date(iso) < w.to;
  const night = messageWindow(new Date('2026-10-10T01:30:00+02:00'), '');
  assert.ok(inside(night, '2026-10-09T23:50:00+02:00'));
  assert.ok(inside(night, '2026-10-10T01:00:00+02:00'));
  const morning = messageWindow(new Date('2026-10-10T04:30:00+02:00'), '');
  assert.ok(!inside(morning, '2026-10-09T23:50:00+02:00'));
  assert.ok(!inside(morning, '2026-10-10T01:00:00+02:00'));
});
