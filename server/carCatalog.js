/**
 * carCatalog.js - built-in vehicle catalog loader + user "garage" merge.
 *
 * Layout
 * ------
 *   server/data/cars/index.json    manifest: schemaVersion + ordered file list
 *   server/data/cars/<make>.json   read-only catalog entries (JSON arrays)
 *   data/cars.json                 writable user garage (Docker volume)
 *
 * The catalog ships with the app and is never written at runtime. The garage
 * holds only user-created vehicles. `GET /api/cars` serves catalog + garage, and
 * the catalog wins on id collisions so a stale/duplicated garage cannot shadow a
 * built-in profile.
 *
 * Validation is deliberately tolerant: structurally broken entries are skipped
 * (and reported), while out-of-range values only produce warnings so a real-world
 * oddity never blocks the catalog from loading.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;
const DEFAULT_CATALOG_DIR = path.join(__dirname, 'data', 'cars');
const DEFAULT_GARAGE_FILE = path.join(__dirname, '..', 'data', 'cars.json');

const TRANSMISSION_TYPES = new Set(['manual', 'automatic', 'dct', 'cvt', 'single']);

// Soft sanity ranges: violations become warnings, not hard failures.
const RANGES = {
  weightLbs: [800, 8000],
  occupantWeightLbs: [0, 800],
  dragCoefficient: [0.1, 1.0],
  frontalAreaSqFt: [10, 50],
  tireDiameterInches: [15, 40],
  finalDrive: [1.5, 8.0],
  gearRatio: [0.2, 8.0]
};

const REQUIRED_FIELDS = [
  'id', 'name', 'make', 'model', 'weightLbs', 'finalDrive', 'tireDiameterInches', 'gears'
];

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function toNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return NaN;
}

function slugify(value) {
  return String(value == null ? '' : value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function generateCarId() {
  return `car_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function transmissionAbbrev(transmission) {
  const t = transmission || {};
  if (t.type === 'single') return 'single';
  const speeds = t.speeds ? String(t.speeds) : '';
  const word = { manual: 'mt', automatic: 'at', dct: 'dct', cvt: 'cvt' }[t.type] || 'at';
  return `${speeds}${word}`;
}

/** Deterministic, human-readable id for a vehicle profile. */
function buildCarId(car) {
  const parts = [
    car.make,
    car.model,
    car.trim,
    car.yearStart,
    car.yearEnd,
    transmissionAbbrev(car.transmission)
  ];
  return slugify(parts.filter(p => p != null && p !== '').join(' '));
}

/** Display name used by the picker, e.g. "2011-2014 Ford Mustang GT 5.0 [6MT]". */
function buildDisplayName(car) {
  const t = car.transmission || {};
  let transLabel = '';
  if (t.type === 'single') transLabel = 'Single Speed';
  else if (t.type) transLabel = transmissionAbbrev(t).toUpperCase();

  let years = '';
  if (car.yearStart && car.yearEnd && car.yearEnd !== car.yearStart) {
    years = `${car.yearStart}-${car.yearEnd}`;
  } else if (car.yearStart) {
    years = String(car.yearStart);
  } else if (car.yearEnd) {
    years = String(car.yearEnd);
  }

  return [years, car.make, car.model, car.trim, transLabel ? `[${transLabel}]` : '']
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------

/**
 * Validate a single vehicle profile.
 * @returns {{valid: boolean, errors: string[], warnings: string[]}}
 */
function validateCar(car) {
  const errors = [];
  const warnings = [];

  if (!car || typeof car !== 'object' || Array.isArray(car)) {
    return { valid: false, errors: ['entry is not an object'], warnings };
  }

  const label = car.id ? String(car.id) : `${car.make || '?'} ${car.model || '?'}`;

  for (const field of REQUIRED_FIELDS) {
    const value = car[field];
    const empty = value == null || value === '' ||
      (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);
    if (empty) errors.push(`${label}: missing ${field}`);
  }

  for (const field of ['weightLbs', 'occupantWeightLbs', 'dragCoefficient', 'frontalAreaSqFt',
                       'tireDiameterInches', 'finalDrive', 'defaultGear']) {
    if (car[field] == null) continue;
    const n = toNumber(car[field]);
    if (!Number.isFinite(n)) {
      errors.push(`${label}: ${field} must be a number`);
    } else if (RANGES[field] && (n < RANGES[field][0] || n > RANGES[field][1])) {
      warnings.push(`${label}: ${field}=${n} is outside the sane range ${RANGES[field][0]}-${RANGES[field][1]}`);
    }
  }

  const gearNumbers = (car.gears && typeof car.gears === 'object' && !Array.isArray(car.gears))
    ? Object.keys(car.gears).map(Number).filter(Number.isFinite).sort((a, b) => a - b)
    : [];

  if (!gearNumbers.length) {
    errors.push(`${label}: gears must contain at least one ratio`);
  }

  let prevRatio = Infinity;
  let prevGear = null;
  for (const gear of gearNumbers) {
    const ratio = toNumber(car.gears[gear]);
    if (!Number.isFinite(ratio) || ratio <= 0) {
      errors.push(`${label}: gear ${gear} ratio must be a positive number`);
      continue;
    }
    if (RANGES.gearRatio && (ratio < RANGES.gearRatio[0] || ratio > RANGES.gearRatio[1])) {
      warnings.push(`${label}: gear ${gear} ratio=${ratio} is outside the sane range ${RANGES.gearRatio[0]}-${RANGES.gearRatio[1]}`);
    }
    if (ratio > prevRatio) {
      // Not fatal: gearboxes with split final drives (e.g. VW 02Q, 1-4 vs 5-6)
      // legitimately have a raw ratio that rises. Flag for review only.
      warnings.push(`${label}: gear ${gear} ratio ${ratio} is higher than gear ${prevGear} (${prevRatio}); verify (split final drive?)`);
    } else if (ratio === prevRatio) {
      warnings.push(`${label}: gear ${gear} ratio equals gear ${prevGear}`);
    }
    prevRatio = ratio;
    prevGear = gear;
  }

  const contiguous = gearNumbers.every((gear, i) => (i === 0 ? gear === 1 : gear === gearNumbers[i - 1] + 1));
  if (gearNumbers.length && !contiguous) {
    warnings.push(`${label}: gear numbers are not contiguous from 1 (${gearNumbers.join(', ')})`);
  }

  if (car.defaultGear != null && gearNumbers.length && !gearNumbers.includes(Number(car.defaultGear))) {
    errors.push(`${label}: defaultGear ${car.defaultGear} is not one of the known gears (${gearNumbers.join(', ')})`);
  }

  if (car.transmission) {
    const t = car.transmission;
    if (!TRANSMISSION_TYPES.has(t.type)) {
      errors.push(`${label}: transmission.type "${t.type}" must be one of ${[...TRANSMISSION_TYPES].join(', ')}`);
    }
    if (t.speeds != null && (!Number.isInteger(toNumber(t.speeds)) || toNumber(t.speeds) < 1 || toNumber(t.speeds) > 12)) {
      warnings.push(`${label}: transmission.speeds ${t.speeds} looks wrong`);
    }
    if (t.type === 'single' && gearNumbers.length !== 1) {
      warnings.push(`${label}: single-speed transmission should declare exactly one gear`);
    }
  }

  for (const field of ['yearStart', 'yearEnd']) {
    if (car[field] == null) continue;
    const n = toNumber(car[field]);
    if (!Number.isInteger(n) || n < 1900 || n > 2100) {
      errors.push(`${label}: ${field} must be a four-digit year`);
    }
  }
  if (car.yearStart != null && car.yearEnd != null && toNumber(car.yearStart) > toNumber(car.yearEnd)) {
    errors.push(`${label}: yearStart is after yearEnd`);
  }

  return { valid: errors.length === 0, errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

// ---------------------------------------------------------------------------
// catalog
// ---------------------------------------------------------------------------

const catalogCache = new Map();
const catalogErrors = new Map();

function resolveCatalogDir(dir) {
  return path.resolve(dir || process.env.CARS_CATALOG_DIR || DEFAULT_CATALOG_DIR);
}

/**
 * Read the catalog from disk without caching.
 * @returns {{dir: string, cars: object[], errors: string[], warnings: string[]}}
 */
function readCatalog(options = {}) {
  const dir = resolveCatalogDir(options.dir);
  const cars = [];
  const errors = [];
  const warnings = [];

  if (!fs.existsSync(dir)) {
    return { dir, cars, errors: [`catalog directory not found: ${dir}`], warnings };
  }

  const manifestPath = path.join(dir, 'index.json');
  let files = null;
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (Array.isArray(manifest.files)) files = manifest.files;
      else errors.push('index.json: "files" must be an array');
    } catch (err) {
      errors.push(`index.json: ${err.message}`);
    }
  }
  if (!files) {
    files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'index.json');
  }

  const seenIds = new Map();
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (!fs.existsSync(filePath)) {
      errors.push(`catalog file missing: ${file}`);
      continue;
    }
    let list;
    try {
      list = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
      errors.push(`${file}: invalid JSON (${err.message})`);
      continue;
    }
    if (!Array.isArray(list)) {
      errors.push(`${file}: expected a JSON array of vehicles`);
      continue;
    }

    list.forEach((car, i) => {
      const where = `${file}[${i}]${car && car.id ? ` (${car.id})` : ''}`;
      const result = validateCar(car);
      warnings.push(...result.warnings);
      if (!result.valid) {
        errors.push(`${where}: ${result.errors.join('; ')}`);
        return;
      }
      if (seenIds.has(car.id)) {
        errors.push(`${where}: duplicate id "${car.id}" (already defined in ${seenIds.get(car.id)})`);
        return;
      }
      seenIds.set(car.id, file);
      cars.push({ ...car, origin: 'catalog' });
    });
  }

  return { dir, cars, errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

/** Memoized catalog entries (catalog origin injected). */
function getCatalog(options = {}) {
  const dir = resolveCatalogDir(options.dir);
  if (!options.fresh && catalogCache.has(dir)) return catalogCache.get(dir);
  const result = readCatalog({ dir });
  catalogCache.set(dir, result.cars);
  catalogErrors.set(dir, { errors: result.errors, warnings: result.warnings });
  return result.cars;
}

/** Validation errors/warnings captured by the most recent catalog load. */
function getCatalogDiagnostics(options = {}) {
  const dir = resolveCatalogDir(options.dir);
  getCatalog({ dir });
  return catalogErrors.get(dir) || { errors: [], warnings: [] };
}

function resetCatalogCache() {
  catalogCache.clear();
  catalogErrors.clear();
}

// ---------------------------------------------------------------------------
// garage (user profiles)
// ---------------------------------------------------------------------------

function resolveGarageFile(file) {
  return path.resolve(file || process.env.CARS_FILE || DEFAULT_GARAGE_FILE);
}

function readGarage(file) {
  const filePath = resolveGarageFile(file);
  if (!fs.existsSync(filePath)) return [];
  let list;
  try {
    list = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new Error(`garage file ${filePath} is not valid JSON: ${err.message}`);
  }
  if (!Array.isArray(list)) {
    throw new Error(`garage file ${filePath} must contain a JSON array`);
  }
  return list;
}

function writeGarage(list, file) {
  const filePath = resolveGarageFile(file);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(list, null, 2) + '\n', 'utf8');
  return filePath;
}

// ---------------------------------------------------------------------------
// merge + mutation
// ---------------------------------------------------------------------------

/** Catalog first (authoritative), then non-colliding garage entries. */
function mergeCars(catalog, garage) {
  const merged = [];
  const byId = new Map();

  for (const car of catalog) {
    const entry = { ...car, origin: 'catalog' };
    merged.push(entry);
    byId.set(entry.id, entry);
  }
  for (const car of garage) {
    if (!car || typeof car !== 'object' || !car.id) continue;
    if (byId.has(car.id)) continue; // catalog wins on collision
    const entry = { ...car, origin: 'user' };
    merged.push(entry);
    byId.set(entry.id, entry);
  }
  return merged;
}

/**
 * Full vehicle list served by the API: catalog + garage.
 * A corrupt garage degrades gracefully to catalog-only.
 */
function getCars(options = {}) {
  const catalog = getCatalog({ dir: options.catalogDir, fresh: options.fresh });
  let garage = [];
  try {
    garage = readGarage(options.garageFile);
  } catch (err) {
    return { cars: catalog, garageError: err.message };
  }
  return { cars: mergeCars(catalog, garage) };
}

function isCatalogId(id, options = {}) {
  return getCatalog({ dir: options.catalogDir }).some(car => car.id === id);
}

/**
 * Fill in fields the minimal profile editor does not collect so a hand-created
 * custom vehicle still satisfies the catalog schema. Catalog files are never
 * passed through this; strict validation still applies to them.
 */
function normalizeCarInput(car) {
  const entry = { ...car };
  if (!entry.make) entry.make = 'Custom';
  if (!entry.model) entry.model = entry.trim || 'Vehicle';
  if (!entry.transmission) {
    const gearNumbers = (entry.gears && typeof entry.gears === 'object' && !Array.isArray(entry.gears))
      ? Object.keys(entry.gears).map(Number).filter(Number.isFinite)
      : [];
    entry.transmission = {
      type: gearNumbers.length === 1 ? 'single' : 'manual',
      speeds: gearNumbers.length || undefined
    };
  }
  if (!entry.yearStart && entry.year) entry.yearStart = entry.year;
  if (entry.yearStart && !entry.yearEnd) entry.yearEnd = entry.yearStart;
  return entry;
}

/**
 * Create/update a user vehicle. Built-in catalog ids are immutable, so saving
 * over one clones it into the garage under a fresh id.
 * @returns {{car: object, cloned: boolean}}
 */
function upsertGarageCar(car, options = {}) {
  const entry = normalizeCarInput(car);
  if (!entry.id) entry.id = generateCarId();

  const result = validateCar(entry);
  if (!result.valid) {
    const err = new Error(`Invalid vehicle profile: ${result.errors.join('; ')}`);
    err.code = 'INVALID_CAR';
    err.validation = result;
    throw err;
  }

  // Built-in profiles are immutable: saving over one clones it into the garage.
  let cloned = false;
  if (isCatalogId(entry.id, options)) {
    entry.id = generateCarId();
    cloned = true;
  }

  const list = readGarage(options.garageFile);
  const index = list.findIndex(c => c && c.id === entry.id);
  if (index >= 0) list[index] = entry;
  else list.push(entry);
  writeGarage(list, options.garageFile);
  return { car: entry, cloned };
}

/** Delete a user vehicle. Built-in catalog ids cannot be deleted. */
function removeGarageCar(id, options = {}) {
  if (!id) {
    const err = new Error('Missing vehicle id');
    err.code = 'INVALID_CAR';
    throw err;
  }
  if (isCatalogId(id, options)) {
    const err = new Error('Built-in catalog profiles cannot be deleted.');
    err.code = 'CATALOG_IMMUTABLE';
    throw err;
  }
  const list = readGarage(options.garageFile);
  const next = list.filter(c => !c || c.id !== id);
  writeGarage(next, options.garageFile);
  return next;
}

module.exports = {
  SCHEMA_VERSION,
  DEFAULT_CATALOG_DIR,
  DEFAULT_GARAGE_FILE,
  TRANSMISSION_TYPES,
  RANGES,
  slugify,
  buildCarId,
  buildDisplayName,
  transmissionAbbrev,
  normalizeCarInput,
  validateCar,
  readCatalog,
  getCatalog,
  getCatalogDiagnostics,
  resetCatalogCache,
  readGarage,
  writeGarage,
  mergeCars,
  getCars,
  isCatalogId,
  upsertGarageCar,
  removeGarageCar
};
