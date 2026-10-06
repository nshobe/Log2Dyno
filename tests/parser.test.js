/**
 * parser.test.js - Phase 1 regression + format tests.
 * Run with: npm test  (node --test)
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { parseLog, parseLogBuffer } = require('../server/parser');
const { detectFormat } = require('../server/formats');
const units = require('../server/units');

const FIXTURES = path.join(__dirname, 'fixtures');

const read = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');

// ---------------------------------------------------------------------------
// Haltech wide CSV: the pre-refactor parser mis-mapped status/derived columns.
// The fixture deliberately contains shadowing columns that a naive ordered
// regex would select (see comments below).
// ---------------------------------------------------------------------------
test('Haltech wide CSV resolves real channels, not status flags', () => {
  const p = parseLog(read('haltech_wide.csv'), 'haltech_wide.csv');

  assert.equal(p.format, 'generic_csv');
  assert.equal(p.family, 'haltech');
  assert.equal(p.totalRows, 40);
  assert.equal(p.channels.length, 22);

  // A naive matcher would pick "MAP from sensor seems valid",
  // "boostStatus.pTerm", "TPS2", "IAT: measured resistance" and
  // "Gearbox Ratio". Each must resolve to the real signal instead.
  assert.equal(p.mapping.map, 'MAP');
  assert.equal(p.mapping.boost, null, 'a status/boolean column must not be chosen as boost');
  assert.equal(p.mapping.tps, 'TPS');
  assert.equal(p.mapping.iat, 'Intake Air IAT');
  assert.equal(p.mapping.lambda, 'Lambda');
  assert.equal(p.mapping.gear, 'Detected Gear');

  assert.equal(p.maxTpsSeen, 100);
  assert.equal(p.pulls.length, 1);
  const pull = p.pulls[0];
  assert.equal(pull.startRpm, 1705);
  assert.equal(pull.endRpm, 6359);
  assert.equal(pull.durationSec, 1.65);
  assert.equal(pull.pointsCount, 34);

  // MAP is kPa (idle vacuum -> negative boost), IAT is Celsius.
  assert.equal(p.allRows[0].mapPsi, 4.4);
  assert.ok(p.allRows[0].boostPsi < 0, 'idle should show vacuum, not positive boost');
  assert.equal(p.allRows[0].iatF, 79);
});

// ---------------------------------------------------------------------------
// MegaSquirt / TunerStudio text formats
// ---------------------------------------------------------------------------
test('TunerStudio MS3 CSV with units row', () => {
  const p = parseLog(read('ms3_tunerstudio.csv'), 'ms3_tunerstudio.csv');

  assert.equal(p.format, 'megasquirt_csv');
  assert.equal(p.family, 'megasquirt');
  assert.equal(p.detectedDelimiter, ',');

  assert.equal(p.mapping.rpm, 'RPM');
  assert.equal(p.mapping.map, 'MAP');
  assert.equal(p.mapping.mapUnit, 'kPa');
  assert.equal(p.mapping.tps, 'TPS');
  assert.equal(p.mapping.lambda, 'Lambda 1');
  assert.equal(p.mapping.ignition, 'Spark Advance');
  assert.equal(p.mapping.knock, 'Knock Retard');
  assert.equal(p.mapping.iat, 'MAT');
  assert.equal(p.mapping.iatUnit, '°F');
  assert.equal(p.mapping.boost, 'Boost');
  assert.equal(p.mapping.boostUnit, 'psi');

  assert.equal(p.unitWarnings.length, 0, JSON.stringify(p.unitWarnings));
  assert.equal(p.totalRows, 40);
  assert.equal(p.pulls.length, 1);
  assert.ok(p.pulls[0].endRpm > p.pulls[0].startRpm);
  assert.equal(p.allRows[0].iatF, 80);
});

test('MegaSquirt MSL is tab-delimited with a preamble', () => {
  const p = parseLog(read('ms3_sd.msl'), 'ms3_sd.msl');

  assert.equal(p.format, 'megasquirt_msl');
  assert.equal(p.family, 'megasquirt');
  assert.equal(p.detectedDelimiter, '\t');
  assert.equal(p.channels.length, 12);
  assert.equal(p.totalRows, 40);

  assert.equal(p.mapping.time, 'Time');
  assert.equal(p.mapping.map, 'MAP');
  assert.equal(p.mapping.mapUnit, 'kPa');
  assert.equal(p.mapping.iat, 'MAT');
  assert.equal(p.mapping.boost, null);
  assert.equal(p.pulls.length, 1);
});

test('MS1 legacy CSV: secL time, Spark ignition, narrowband O2 ignored', () => {
  const p = parseLog(read('ms1_legacy.csv'), 'ms1_legacy.csv');

  assert.equal(p.format, 'megasquirt_csv');
  assert.equal(p.mapping.time, 'secL');
  assert.equal(p.mapping.ignition, 'Spark');
  assert.equal(p.mapping.iat, 'MAT');
  assert.equal(p.mapping.lambda, 'O2');

  assert.ok(p.unitWarnings.some(w => /narrowband/i.test(w)), JSON.stringify(p.unitWarnings));
  assert.equal(p.allRows[0].lambda, null, 'narrowband O2 must not be treated as lambda');
  assert.equal(p.allRows[0].ignition, 10);
});

test('generic CSV with unit-suffixed column names', () => {
  const p = parseLog(read('generic.csv'), 'generic.csv');

  assert.equal(p.format, 'generic_csv');
  assert.equal(p.mapping.time, 'timestamp');
  assert.equal(p.mapping.rpm, 'engine_speed');
  assert.equal(p.mapping.tps, 'throttle_pct');
  assert.equal(p.mapping.map, 'manifold_pressure_kpa');
  assert.equal(p.mapping.iat, 'air_temp_c');
  assert.equal(p.mapping.lambda, 'wideband');

  assert.equal(p.allRows[0].tps, 0);
  assert.equal(p.allRows[0].rpm, 1000);
  assert.ok(p.pulls.length >= 1);
});

test('Haltech NSP raw %DataLog% parses and maps channels', () => {
  const p = parseLog(read('haltech_raw.txt'), 'haltech_raw.txt');
  assert.equal(p.format, 'haltech_nsp_raw');
  assert.equal(p.family, 'haltech');
  assert.equal(p.channels.length, 6);
  assert.equal(p.mapping.rpm, 'RPM');
  assert.equal(p.mapping.tps, 'Throttle Position');
  assert.equal(p.mapping.map, 'Manifold Pressure');
  assert.equal(p.mapping.lambda, 'Wideband');
  assert.equal(p.mapping.ignition, 'Ignition Angle');
  assert.equal(p.totalRows, 40);
  assert.equal(p.pulls.length, 1);
});

test('Haltech flat CSV with units row honors declared units', () => {
  const p = parseLog(read('haltech_flat.csv'), 'haltech_flat.csv');
  assert.equal(p.format, 'haltech_flat_csv');
  assert.equal(p.mapping.mapUnit, 'kPa');
  assert.equal(p.mapping.iatUnit, 'C');
  assert.equal(p.mapping.speedUnit, 'km/h');
  assert.equal(p.unitWarnings.length, 0, JSON.stringify(p.unitWarnings));
  // 33 km/h -> ~20.5 mph
  assert.equal(p.allRows[0].speedMph, 20.5);
  // 26 C -> 78.8 -> 79 F
  assert.equal(p.allRows[0].iatF, 79);
});

// ---------------------------------------------------------------------------
// Detection + units
// ---------------------------------------------------------------------------
test('detectFormat identifies Haltech raw signature', () => {
  const lines = ['%DataLog%', 'Channel : RPM', 'Channel : TPS', '00:00:00,1000,0'];
  const det = detectFormat(lines, 'raw.csv');
  assert.equal(det.id, 'haltech_nsp_raw');
  assert.equal(det.family, 'haltech');
});

test('sniffs delimiter and units row on a simple flat CSV', () => {
  const lines = [
    'Time,RPM,MAP',
    's,rpm,kPa',
    '0,1000,30',
    '0.1,1200,40'
  ];
  const det = detectFormat(lines, 'flat.csv');
  assert.equal(det.delimiter, ',');
  assert.equal(det.headerIndex, 0);
  assert.equal(det.unitsIndex, 1);
  assert.equal(det.dataIndex, 2);
});

test('unit conversions are unit-driven, unknown units return null', () => {
  assert.ok(Math.abs(units.pressureToPsi(101.325, 'kPa') - 14.696) < 0.01);
  assert.equal(units.pressureToPsi(14.7, 'psi'), 14.7);
  assert.equal(units.pressureToPsi(1, 'furlongs'), null);
  assert.equal(units.temperatureToF(100, '°C'), 212);
  assert.equal(units.temperatureToF(32, 'F'), 32);
  assert.equal(units.temperatureToF(300, 'not-a-unit'), null);
  assert.ok(Math.abs(units.speedToMph(100, 'km/h') - 62.1371) < 0.01);
  assert.equal(units.speedToMph(60, 'bogus'), null);
  assert.ok(Math.abs(units.fuelRatioToLambda(14.7, true) - 1) < 0.0001);
  assert.equal(units.fuelRatioToLambda(0.85, false), 0.85);
});

// ---------------------------------------------------------------------------
// Parse options (Phase 2)
// ---------------------------------------------------------------------------
test('format hint forces the parser family', () => {
  const content = read('generic.csv');
  const ms = parseLog(content, 'generic.csv', { format: 'megasquirt' });
  assert.equal(ms.family, 'megasquirt');
  const haltech = parseLog(content, 'generic.csv', { format: 'haltech' });
  assert.equal(haltech.family, 'haltech');
});

test('wotThreshold option changes pull extraction', () => {
  const content = read('ms3_tunerstudio.csv');
  const normal = parseLog(content, 'ms3_tunerstudio.csv');
  assert.equal(normal.pulls.length, 1, 'default 85% WOT should find a pull');

  // Scale TPS to max ~80%: a strict 85% threshold finds nothing, 75% does.
  const strict = parseLog(content, 'ms3_tunerstudio.csv', { tpsScale: 0.8, wotThreshold: 85 });
  assert.equal(strict.pulls.length, 0);
  const relaxed = parseLog(content, 'ms3_tunerstudio.csv', { tpsScale: 0.8, wotThreshold: 75 });
  assert.equal(relaxed.pulls.length, 1);
});

test('channelOverrides reassign a canonical field', () => {
  const content = read('ms3_tunerstudio.csv');
  const p = parseLog(content, 'ms3_tunerstudio.csv', {
    channelOverrides: { map: 'CLT', gear: null }
  });
  assert.equal(p.mapping.map, 'CLT');
  assert.equal(p.mapping.gear, null);
});

test('tpsScale option scales TPS before pull detection', () => {
  const content = read('ms3_tunerstudio.csv');
  const p = parseLog(content, 'ms3_tunerstudio.csv', { tpsScale: 0.5 });
  assert.equal(p.tpsScale, 0.5);
  assert.equal(p.maxTpsSeen, 50);
});

test('low max TPS triggers a voltage/ADC scale suggestion', () => {
  const lines = ['Time,RPM,TPS'];
  for (let i = 0; i < 30; i++) {
    lines.push(`${(i * 0.1).toFixed(1)},${1000 + i * 100},${(0.4 + (i / 29) * 4).toFixed(2)}`);
  }
  const p = parseLog(lines.join('\n'), 'volts.csv');
  assert.ok(p.tpsScaleSuggested, 'expected a tpsScaleSuggested object');
  assert.ok(p.tpsScaleSuggested.factor > 0);
  assert.ok(p.unitWarnings.some(w => /0-5V|ADC|TPS/i.test(w)));
});

// ---------------------------------------------------------------------------
// Binary MLG (MLVLG v1/v2)
// ---------------------------------------------------------------------------
function writeCString(buf, offset, len, str) {
  buf.write(str, offset, Math.min(len - 1, str.length), 'latin1');
}

const TYPE_SIZE = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 8, 7: 4, 10: 1, 11: 2, 12: 4 };

function buildMlg(version, recCount = 40) {
  const fields = [
    { type: 2, name: 'RPM', units: 'RPM', scale: 1, transform: 0 },
    { type: 2, name: 'MAP', units: 'kPa', scale: 1, transform: 0 },
    { type: 0, name: 'TPS', units: '%', scale: 1, transform: 0 },
    { type: 2, name: 'MAT', units: 'F', scale: 0.1, transform: 0 }
  ];
  const flen = version >= 2 ? 89 : 55;
  const fixed = version >= 2 ? 24 : 22;
  const infoStr = 'Log2Dyno test MLG';
  const infoLen = Buffer.byteLength(infoStr) + 1;
  const infoDataStart = fixed + fields.length * flen;
  const dataBeginIndex = infoDataStart + infoLen;
  const recordLength = fields.reduce((sum, f) => sum + TYPE_SIZE[f.type], 0);
  const blockSize = 1 + 1 + 2 + recordLength + 1;

  const buf = Buffer.alloc(dataBeginIndex + recCount * blockSize);
  buf.write('MLVLG\0', 0, 'latin1');
  buf.writeUInt16BE(version, 6);
  buf.writeUInt32BE(0, 8);
  if (version >= 2) buf.writeUInt32BE(infoDataStart, 12);
  else buf.writeUInt16BE(infoDataStart, 12);
  let o = version >= 2 ? 16 : 14;
  buf.writeUInt32BE(dataBeginIndex, o); o += 4;
  buf.writeUInt16BE(recordLength, o); o += 2;
  buf.writeUInt16BE(fields.length, o); o += 2;

  fields.forEach((f, i) => {
    const base = fixed + i * flen;
    buf.writeUInt8(f.type, base);
    writeCString(buf, base + 1, 34, f.name);
    writeCString(buf, base + 35, 10, f.units);
    buf.writeUInt8(0, base + 45);
    buf.writeFloatBE(f.scale, base + 46);
    buf.writeFloatBE(f.transform, base + 50);
    buf.writeInt8(0, base + 54);
  });
  buf.write(infoStr + '\0', infoDataStart, 'latin1');

  let off = dataBeginIndex;
  for (let i = 0; i < recCount; i++) {
    const rpm = Math.round(1000 + i * (5500 / (recCount - 1)));
    const tps = (i >= 5 && i <= recCount - 2) ? 100 : 0;
    const map = tps > 50 ? Math.round(30 + (rpm / 6500) * 130) : 30;
    const tick = (i * 2500) & 0xffff; // 25 ms/rec; crosses the 16-bit rollover
    buf.writeUInt8(0, off); off += 1;
    buf.writeUInt8(i & 0xff, off); off += 1;
    buf.writeUInt16BE(tick, off); off += 2;
    buf.writeUInt16BE(rpm, off); off += 2;
    buf.writeUInt16BE(map, off); off += 2;
    buf.writeUInt8(tps, off); off += 1;
    buf.writeUInt16BE(800, off); off += 2; // MAT raw -> 80 F
    buf.writeUInt8(0, off); off += 1; // crc
  }
  return buf;
}

for (const version of [1, 2]) {
  test(`MLG v${version} decodes header, fields, and records`, () => {
    const buf = buildMlg(version);
    const p = parseLogBuffer(buf, `test_v${version}.mlg`);

    assert.equal(p.error, undefined);
    assert.equal(p.format, 'mlg_binary');
    assert.equal(p.binary, true);
    assert.equal(p.mlg.formatVersion, version);
    assert.equal(p.mapping.rpm, 'RPM');
    assert.equal(p.mapping.map, 'MAP');
    assert.equal(p.mapping.tps, 'TPS');
    assert.equal(p.mapping.iat, 'MAT');
    assert.equal(p.mapping.mapUnit, 'kPa');

    assert.equal(p.totalRows, 40);
    assert.equal(p.pulls.length, 1);
    assert.equal(p.pulls[0].startRpm, 1705);
    assert.equal(p.pulls[0].endRpm, 6359);
    assert.ok(p.pulls[0].durationSec >= 0.8, `duration ${p.pulls[0].durationSec}`);

    // 10us ticks with 16-bit rollover -> 0.975 s elapsed at the end.
    assert.equal(p.allRows[39].t, 0.975);
    // Units honored: peak MAP ~157 kPa -> ~22.8 psi (last record is off-throttle).
    const peakMapPsi = Math.max(...p.allRows.map(r => r.mapPsi));
    assert.ok(peakMapPsi > 22 && peakMapPsi < 24, `peak mapPsi ${peakMapPsi}`);
    // Field scale applied: raw 800 * 0.1 = 80 F.
    assert.equal(p.allRows[0].iatF, 80);
  });
}

test('committed MLG fixture parses', () => {
  const buf = fs.readFileSync(path.join(FIXTURES, 'log2dyno_test.mlg'));
  const p = parseLogBuffer(buf, 'log2dyno_test.mlg');
  assert.equal(p.error, undefined);
  assert.equal(p.format, 'mlg_binary');
  assert.equal(p.mlg.formatVersion, 2);
  assert.equal(p.mapping.lambda, 'AFR');
  assert.equal(p.mapping.lambdaIsAfr, true);
  assert.equal(p.allRows[0].lambda, 0.95);
  assert.equal(p.pulls.length, 1);
});

test('parseLogBuffer rejects non-MLVLG binaries with conversion guidance', () => {
  const junk = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00]);
  const p = parseLogBuffer(junk, 'sdcard.MS3');
  assert.ok(p.error, 'expected an error');
  assert.ok(/MS3|TunerStudio|CSV|MSL/i.test(p.error), p.error);
});
