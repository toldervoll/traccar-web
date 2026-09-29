import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADDRESS_MAX_MATCHES,
  ADDRESS_MUNICIPALITY,
  parseMatches,
  searchText,
  searchUrl,
} from './addressSearch.js';

test('the request carries the search, the municipality and the match count', () => {
  const url = new URL(searchUrl('Tåsenv 10'));
  assert.equal(url.origin + url.pathname, 'https://ws.geonorge.no/adresser/v1/sok');
  assert.equal(url.searchParams.get('sok'), 'Tåsenv* 10');
  assert.equal(url.searchParams.get('kommunenummer'), ADDRESS_MUNICIPALITY);
  assert.equal(url.searchParams.get('treffPerSide'), String(ADDRESS_MAX_MATCHES));
  assert.ok(!searchUrl('Tåsenv 10').includes('å'));
});

test('searchText adds * to words of two or more characters with no digit', () => {
  assert.equal(searchText('Tåsenv 10'), 'Tåsenv* 10');
  assert.equal(searchText('Tåsenveien 10,'), 'Tåsenveien* 10');
  assert.equal(searchText('Tåsenveien 10 A'), 'Tåsenveien* 10 A');
  assert.equal(searchText('Nils Bays v 10'), 'Nils* Bays* v 10');
});

const address = (adressetekst, lat, lon) => ({
  adressetekst,
  postnummer: '0853',
  poststed: 'OSLO',
  representasjonspunkt: { epsg: 'EPSG:4258', lat, lon },
});

test('an answer with two addresses gives two matches with label and point', () => {
  const matches = parseMatches({
    adresser: [address('Tåsenveien 10A', 59.95, 10.75), address('Tåsenveien 10B', 59.951, 10.751)],
  });
  assert.equal(matches.length, 2);
  assert.deepEqual(matches[0], { label: 'Tåsenveien 10A, 0853 OSLO', lat: 59.95, lon: 10.75 });
});

test('an empty or broken answer gives an empty list and does not throw', () => {
  assert.deepEqual(parseMatches({ adresser: [] }), []);
  assert.deepEqual(parseMatches({}), []);
  assert.deepEqual(parseMatches(null), []);
  assert.deepEqual(parseMatches('x'), []);
  assert.deepEqual(parseMatches({ adresser: [{ foo: 1 }] }), []);
});

test('an address without a point is left out', () => {
  const noPoint = { ...address('Tåsenveien 10A', 0, 0), representasjonspunkt: null };
  assert.deepEqual(
    parseMatches({ adresser: [noPoint, address('Tåsenveien 10B', 59.9, 10.7)] }).length,
    1,
  );
});
