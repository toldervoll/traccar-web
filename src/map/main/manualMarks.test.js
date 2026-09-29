import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMarkReport, marksFromPositions } from './manualMarks.js';

const known = new Set(['A', 'B', 'C']);
let nextId = 1;
const report = (attributes, fixTime = '2026-10-09T16:00:00Z') => ({
  id: nextId++,
  fixTime,
  attributes,
});
const marks = (positions) => marksFromPositions(positions, known);

test('on reports mark stretches', () => {
  assert.deepEqual(
    Object.keys(
      marks([report({ stretches: 'A', on: true }), report({ stretches: 'B', on: true })]).stretches,
    ),
    ['A', 'B'],
  );
});

test('the last report per stretch wins', () => {
  assert.deepEqual(
    marks([report({ stretches: 'A', on: true }), report({ stretches: 'A', on: false })]).stretches,
    {},
  );
  assert.deepEqual(
    Object.keys(
      marks([report({ stretches: 'A', on: false }), report({ stretches: 'A', on: true })])
        .stretches,
    ),
    ['A'],
  );
});

test('reports are ordered by position id, not fix time', () => {
  const first = report({ stretches: 'A', on: true }, '2026-10-09T17:00:00Z');
  const second = report({ stretches: 'A', on: false }, '2026-10-09T16:00:00Z');
  assert.deepEqual(marks([second, first]).stretches, {});
});

test('one report can mark several stretches, with the server time', () => {
  const result = marks([report({ stretches: 'A,B,C', on: true })]);
  assert.deepEqual(Object.keys(result.stretches), ['A', 'B', 'C']);
  assert.equal(result.stretches.A, Date.parse('2026-10-09T16:00:00Z'));
});

test('route reports close and open a route', () => {
  assert.deepEqual(Object.keys(marks([report({ markRoute: 4, on: true })]).routes), ['4']);
  assert.deepEqual(
    marks([report({ markRoute: 4, on: true }), report({ markRoute: 4, on: false })]).routes,
    {},
  );
  assert.deepEqual(marks([report({ markRoute: 9, on: true })]).routes, {});
});

test('malformed reports are ignored', () => {
  const result = marks([
    report({}),
    report({ stretches: 5, on: true }),
    report({ stretches: 'A,X', on: true }),
    report({ stretches: 'A', on: 'yes' }),
    { id: 99 },
  ]);
  assert.deepEqual(result, { stretches: {}, routes: {} });
});

test('buildMarkReport carries the unique id and no time', () => {
  const params = new URLSearchParams(
    buildMarkReport({ uniqueId: 'secret', lon: 10.7, lat: 59.9, stretches: ['A', 'B'], on: true }),
  );
  assert.equal(params.get('id'), 'secret');
  assert.equal(params.get('stretches'), 'A,B');
  assert.equal(params.get('on'), 'true');
  assert.equal(params.get('timestamp'), null);
  const route = new URLSearchParams(
    buildMarkReport({ uniqueId: 'x', lon: 1, lat: 2, route: 4, on: false }),
  );
  assert.equal(route.get('markRoute'), '4');
  assert.equal(route.get('on'), 'false');
  assert.equal(route.get('stretches'), null);
});
