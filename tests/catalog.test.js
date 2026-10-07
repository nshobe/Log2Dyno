/**
 * catalog.test.js - validates the committed vehicle catalog.
 *
 * The catalog was bootstrapped once from the Virtual Dyno database (277 entries)
 * plus curated additions. That one-time importer has been retired: the per-make
 * files under `server/data/cars/` are now the canonical, hand-maintained source.
 * These tests are the safety net for future research/edits and new cars.
 *
 * Run with: npm test  (node --test)
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const cc = require('../server/carCatalog');
const { validateCatalog } = require('../tools/validate-cars');

const CATALOG_DIR = path.join(__dirname, '..', 'server', 'data', 'cars');

test('the catalog is structurally valid and at least Virtual Dyno parity', () => {
  const report = validateCatalog();
  assert.deepEqual(report.errors, [], report.errors.join('\n'));
  assert.ok(report.total >= 277, `expected >= 277 cars, got ${report.total}`);
  assert.equal(report.missingGears, 0, 'every car must have at least a partial gear set');
  assert.equal(report.missingDefaultGear, 0);
  assert.ok(report.incomplete < report.total, 'at least some gear sets should be complete');
});

test('catalog ids are unique and every car validates', () => {
  const result = cc.readCatalog({ fresh: true });
  const ids = result.cars.map(car => car.id);
  assert.equal(new Set(ids).size, ids.length, 'catalog ids must be unique');
  for (const car of result.cars) {
    const validation = cc.validateCar(car);
    assert.equal(validation.valid, true, `${car.id}: ${validation.errors.join('; ')}`);
  }
});

test('every manifest file exists and the manifest count matches the catalog', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, 'index.json'), 'utf8'));
  assert.ok(Array.isArray(manifest.files), 'index.json "files" must be an array');
  for (const file of manifest.files) {
    assert.ok(fs.existsSync(path.join(CATALOG_DIR, file)), `missing catalog file ${file}`);
  }
  const result = cc.readCatalog({ fresh: true });
  assert.equal(result.cars.length, manifest.count, 'manifest "count" must match catalog length');
});

test('complete gear sets are contiguous 1..N', () => {
  const result = cc.readCatalog({ fresh: true });
  for (const car of result.cars) {
    if (!car.gearDataComplete) continue;
    const gears = Object.keys(car.gears).map(Number).sort((a, b) => a - b);
    const expected = Array.from({ length: gears.length }, (_, i) => i + 1);
    assert.deepEqual(gears, expected, `${car.id}: gears must be 1..${gears.length}`);
  }
});
