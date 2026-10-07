/**
 * cars.test.js - vehicle catalog / garage storage layer.
 * Run with: npm test  (node --test)
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cc = require('../server/carCatalog');
const { createServer } = require('../server/index');

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function sampleCar(overrides = {}) {
  return {
    id: 'test-car-1',
    name: '2020 Test Coupe [5MT]',
    make: 'Test',
    model: 'Coupe',
    trim: 'Base',
    yearStart: 2020,
    yearEnd: 2020,
    transmission: { type: 'manual', speeds: 5 },
    weightLbs: 3000,
    occupantWeightLbs: 170,
    finalDrive: 3.5,
    tireDiameterInches: 25,
    dragCoefficient: 0.33,
    frontalAreaSqFt: 22,
    gears: { 1: 3.5, 2: 2.0, 3: 1.3, 4: 1.0, 5: 0.8 },
    defaultGear: 3,
    ...overrides
  };
}

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'log2dyno-cars-'));
}

function writeCatalog(dir, files) {
  const names = Object.keys(files);
  fs.writeFileSync(path.join(dir, 'index.json'),
    JSON.stringify({ schemaVersion: 1, files: names }, null, 2));
  for (const [name, list] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), JSON.stringify(list, null, 2));
  }
}

// ---------------------------------------------------------------------------
// helpers / naming
// ---------------------------------------------------------------------------

test('slugify and buildCarId are deterministic', () => {
  assert.equal(cc.slugify('Ford Mustang GT 5.0'), 'ford-mustang-gt-5-0');
  const id = cc.buildCarId(sampleCar());
  assert.equal(id, 'test-coupe-base-2020-2020-5mt');
  assert.equal(cc.buildCarId(sampleCar()), id);
});

test('buildDisplayName renders years, make/model/trim and transmission', () => {
  assert.equal(cc.buildDisplayName(sampleCar()), '2020 Test Coupe Base [5MT]');
  assert.equal(
    cc.buildDisplayName(sampleCar({ yearStart: 2011, yearEnd: 2014, transmission: { type: 'automatic', speeds: 6 } })),
    '2011-2014 Test Coupe Base [6AT]'
  );
  assert.equal(
    cc.buildDisplayName(sampleCar({ transmission: { type: 'single', speeds: 1 }, gears: { 1: 1.0 }, defaultGear: 1 })),
    '2020 Test Coupe Base [Single Speed]'
  );
});

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------

test('validateCar accepts a well-formed profile', () => {
  const result = cc.validateCar(sampleCar());
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('validateCar rejects missing required fields', () => {
  const result = cc.validateCar(sampleCar({ weightLbs: undefined }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('weightLbs')));
});

test('validateCar warns (but allows) non-monotonic gear ratios', () => {
  // Split final drives (e.g. VW 02Q) legitimately raise the raw ratio at 5th.
  const result = cc.validateCar(sampleCar({ gears: { 1: 2.0, 2: 2.5, 3: 1.0 } }));
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some(w => /higher than gear/.test(w)));
});

test('validateCar warns on out-of-range values without failing', () => {
  const result = cc.validateCar(sampleCar({ weightLbs: 20000 }));
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some(w => w.includes('weightLbs')));
});

test('validateCar checks defaultGear and transmission type', () => {
  assert.equal(cc.validateCar(sampleCar({ defaultGear: 9 })).valid, false);
  assert.equal(cc.validateCar(sampleCar({ transmission: { type: 'rocket', speeds: 2 } })).valid, false);
});

test('validateCar flags single-speed profile with multiple gears (warning only)', () => {
  const result = cc.validateCar(sampleCar({ transmission: { type: 'single', speeds: 1 } }));
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some(w => w.includes('single-speed')));
});

// ---------------------------------------------------------------------------
// catalog loading
// ---------------------------------------------------------------------------

test('readCatalog loads valid entries and reports invalid/duplicate ones', () => {
  const dir = makeTmpDir();
  try {
    writeCatalog(dir, {
      'a.json': [sampleCar({ id: 'a' })],
      'b.json': [
        sampleCar({ id: 'a' }),                       // duplicate id
        sampleCar({ id: 'bad', weightLbs: undefined }) // invalid
      ]
    });
    const result = cc.readCatalog({ dir });
    assert.equal(result.cars.length, 1);
    assert.equal(result.cars[0].id, 'a');
    assert.equal(result.cars[0].origin, 'catalog');
    assert.ok(result.errors.some(e => /duplicate id/.test(e)));
    assert.ok(result.errors.some(e => /missing weightLbs/.test(e)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readCatalog reports a missing catalog directory', () => {
  const result = cc.readCatalog({ dir: path.join(os.tmpdir(), 'does-not-exist-xyz') });
  assert.equal(result.cars.length, 0);
  assert.ok(result.errors.some(e => /not found/.test(e)));
});

// ---------------------------------------------------------------------------
// garage + merge
// ---------------------------------------------------------------------------

test('garage round-trips and rejects corrupt JSON', () => {
  const dir = makeTmpDir();
  const file = path.join(dir, 'cars.json');
  try {
    cc.writeGarage([sampleCar()], file);
    assert.equal(cc.readGarage(file).length, 1);

    fs.writeFileSync(file, '{ not json');
    assert.throws(() => cc.readGarage(file), /not valid JSON/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('mergeCars lets the catalog win id collisions and tags origins', () => {
  const catalog = [{ id: 'a', name: 'Catalog A' }, { id: 'b', name: 'Catalog B' }];
  const garage = [{ id: 'a', name: 'User A' }, { id: 'c', name: 'User C' }];
  const merged = cc.mergeCars(catalog, garage);
  assert.deepEqual(merged.map(c => [c.id, c.origin]), [
    ['a', 'catalog'], ['b', 'catalog'], ['c', 'user']
  ]);
  assert.equal(merged.find(c => c.id === 'a').name, 'Catalog A');
});

// ---------------------------------------------------------------------------
// garage mutation
// ---------------------------------------------------------------------------

test('upsertGarageCar creates and updates user profiles', () => {
  const dir = makeTmpDir();
  const catalogDir = path.join(dir, 'catalog');
  const garage = path.join(dir, 'garage.json');
  fs.mkdirSync(catalogDir, { recursive: true });
  writeCatalog(catalogDir, { 'test.json': [] });
  try {
    const created = cc.upsertGarageCar(sampleCar({ id: 'user-1' }), { catalogDir, garageFile: garage });
    assert.equal(created.cloned, false);
    assert.equal(cc.readGarage(garage).length, 1);

    cc.upsertGarageCar(sampleCar({ id: 'user-1', weightLbs: 3100 }), { catalogDir, garageFile: garage });
    const list = cc.readGarage(garage);
    assert.equal(list.length, 1);
    assert.equal(list[0].weightLbs, 3100);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('upsertGarageCar clones a built-in catalog id instead of mutating it', () => {
  const dir = makeTmpDir();
  const catalogDir = path.join(dir, 'catalog');
  const garage = path.join(dir, 'garage.json');
  fs.mkdirSync(catalogDir, { recursive: true });
  writeCatalog(catalogDir, { 'test.json': [sampleCar({ id: 'catalog-1' })] });
  try {
    const { car, cloned } = cc.upsertGarageCar(sampleCar({ id: 'catalog-1' }), { catalogDir, garageFile: garage });
    assert.equal(cloned, true);
    assert.notEqual(car.id, 'catalog-1');
    assert.equal(cc.readGarage(garage).length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('upsertGarageCar normalizes minimal editor payloads', () => {
  const dir = makeTmpDir();
  const garage = path.join(dir, 'garage.json');
  try {
    const { car } = cc.upsertGarageCar({
      id: 'car_123',
      name: 'New Custom Vehicle',
      weightLbs: 3300,
      occupantWeightLbs: 170,
      finalDrive: 3.9,
      dragCoefficient: 0.33,
      frontalAreaSqFt: 22,
      tireDiameterInches: 25,
      gears: { 1: 3.6, 2: 2.3, 3: 1.7, 4: 1.3, 5: 0.97, 6: 0.75 }
    }, { garageFile: garage });
    assert.equal(car.make, 'Custom');
    assert.equal(car.model, 'Vehicle');
    assert.equal(car.transmission.type, 'manual');
    assert.equal(car.transmission.speeds, 6);
    assert.equal(cc.readGarage(garage).length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('upsertGarageCar rejects invalid profiles', () => {
  const dir = makeTmpDir();
  try {
    assert.throws(
      () => cc.upsertGarageCar(sampleCar({ finalDrive: undefined }), { garageFile: path.join(dir, 'g.json') }),
      err => err.code === 'INVALID_CAR'
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('removeGarageCar deletes users but protects catalog ids', () => {
  const dir = makeTmpDir();
  const catalogDir = path.join(dir, 'catalog');
  const garage = path.join(dir, 'garage.json');
  fs.mkdirSync(catalogDir, { recursive: true });
  writeCatalog(catalogDir, { 'test.json': [sampleCar({ id: 'catalog-1' })] });
  try {
    cc.upsertGarageCar(sampleCar({ id: 'user-1' }), { catalogDir, garageFile: garage });
    cc.removeGarageCar('user-1', { catalogDir, garageFile: garage });
    assert.equal(cc.readGarage(garage).length, 0);

    assert.throws(
      () => cc.removeGarageCar('catalog-1', { catalogDir, garageFile: garage }),
      err => err.code === 'CATALOG_IMMUTABLE'
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// HTTP API
// ---------------------------------------------------------------------------

function startServer(config) {
  const server = createServer(config);
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function withServer(config, fn) {
  const { server, port } = await startServer(config);
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('GET /api/cars serves catalog + garage', async () => {
  const dir = makeTmpDir();
  const catalogDir = path.join(dir, 'catalog');
  const garage = path.join(dir, 'garage.json');
  fs.mkdirSync(catalogDir, { recursive: true });
  writeCatalog(catalogDir, { 'test.json': [sampleCar({ id: 'catalog-1' })] });
  cc.writeGarage([sampleCar({ id: 'user-1' })], garage);

  try {
    await withServer({ catalogDir, carsFile: garage }, async base => {
      const res = await fetch(`${base}/api/cars`);
      assert.equal(res.status, 200);
      const cars = await res.json();
      assert.deepEqual(cars.map(c => [c.id, c.origin]), [['catalog-1', 'catalog'], ['user-1', 'user']]);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/save-car creates users, clones catalog ids, rejects invalid', async () => {
  const dir = makeTmpDir();
  const catalogDir = path.join(dir, 'catalog');
  const garage = path.join(dir, 'garage.json');
  fs.mkdirSync(catalogDir, { recursive: true });
  writeCatalog(catalogDir, { 'test.json': [sampleCar({ id: 'catalog-1' })] });

  try {
    await withServer({ catalogDir, carsFile: garage }, async base => {
      const post = (body) => fetch(`${base}/api/save-car`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const created = await post(sampleCar({ id: 'user-1' }));
      assert.equal(created.status, 200);
      const createdJson = await created.json();
      assert.equal(createdJson.cloned, false);
      assert.equal(createdJson.cars.length, 2);

      const cloned = await post(sampleCar({ id: 'catalog-1' }));
      const clonedJson = await cloned.json();
      assert.equal(clonedJson.cloned, true);
      assert.notEqual(clonedJson.currentCar.id, 'catalog-1');

      const invalid = await post(sampleCar({ id: 'bad', weightLbs: undefined }));
      assert.equal(invalid.status, 400);
      const invalidJson = await invalid.json();
      assert.ok(invalidJson.error.includes('Invalid vehicle profile'));
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/delete-car protects catalog ids and deletes users', async () => {
  const dir = makeTmpDir();
  const catalogDir = path.join(dir, 'catalog');
  const garage = path.join(dir, 'garage.json');
  fs.mkdirSync(catalogDir, { recursive: true });
  writeCatalog(catalogDir, { 'test.json': [sampleCar({ id: 'catalog-1' })] });
  cc.writeGarage([sampleCar({ id: 'user-1' })], garage);

  try {
    await withServer({ catalogDir, carsFile: garage }, async base => {
      const del = (id) => fetch(`${base}/api/delete-car`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });

      const protectedRes = await del('catalog-1');
      assert.equal(protectedRes.status, 400);
      assert.equal(cc.readGarage(garage).length, 1);

      const removed = await del('user-1');
      assert.equal(removed.status, 200);
      const removedJson = await removed.json();
      assert.deepEqual(removedJson.cars.map(c => c.id), ['catalog-1']);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
