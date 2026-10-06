/**
 * customChannel.test.js - arbitrary-channel extraction + custom graph field.
 * Run with: npm test  (node --test)
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { parseLog } = require('../server/parser');
const { calculateDyno } = require('../server/dynoMath');

const FIXTURES = path.join(__dirname, 'fixtures');
const read = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');

const KPA_TO_PSI = 0.1450377;
const PROFILE = {
  weightLbs: 3351,
  gearRatio: 1.346,
  finalDrive: 3.9,
  tireDiameterInches: 24.97,
  dragCoefficient: 0.33,
  frontalAreaSqFt: 22.2,
  gear: 3
};

test('parser exposes numericChannels and pull row indices', () => {
  const p = parseLog(read('haltech_wide.csv'), 'haltech_wide.csv');

  assert.ok(p.numericChannels.includes('MAP'));
  assert.ok(p.numericChannels.includes('RPM'));
  assert.equal(p.numericChannels.length, p.channels.length);

  const pull = p.pulls[0];
  assert.equal(pull.startIndex, 5);
  assert.equal(pull.endIndex, 38);
  assert.equal(pull.endIndex - pull.startIndex + 1, pull.data.length);
  // Pull data must be the same contiguous slice of allRows.
  assert.strictEqual(p.allRows[pull.startIndex], pull.data[0]);
  assert.strictEqual(p.allRows[pull.endIndex], pull.data[pull.data.length - 1]);
});

test('options.series returns arrays aligned to normalized rows', () => {
  const p = parseLog(read('haltech_wide.csv'), 'haltech_wide.csv', { series: ['MAP', 'RPM'] });

  assert.deepEqual(Object.keys(p.series).sort(), ['MAP', 'RPM']);
  assert.equal(p.series.MAP.length, p.allRows.length);
  assert.equal(p.series.RPM.length, p.allRows.length);

  // MAP is kPa in the log; normalized mapPsi is psi. Alignment must hold.
  for (let i = 0; i < p.allRows.length; i += 3) {
    if (p.series.MAP[i] === null) {
      assert.equal(p.allRows[i].mapPsi, null);
      continue;
    }
    const expected = Math.round(p.series.MAP[i] * KPA_TO_PSI * 10) / 10;
    assert.equal(p.allRows[i].mapPsi, expected);
  }
});

test('options.series ignores channels that are not present', () => {
  const p = parseLog(read('haltech_wide.csv'), 'haltech_wide.csv', { series: ['Nope', 'MAP'] });
  assert.deepEqual(Object.keys(p.series), ['MAP']);
});

test('series extraction works for the MegaSquirt fixture too', () => {
  const p = parseLog(read('ms3_tunerstudio.csv'), 'ms3_tunerstudio.csv', { series: ['RPM'] });
  assert.ok(p.series.RPM);
  assert.equal(p.series.RPM.length, p.allRows.length);
  assert.ok(p.series.RPM.some(v => v !== null));
});

test('calculateDyno smooths, interpolates and bounds a custom channel', () => {
  const p = parseLog(read('haltech_wide.csv'), 'haltech_wide.csv', { series: ['MAP'] });
  const pull = p.pulls[0];
  const pullData = pull.data.map((row, i) => ({ ...row, custom: p.series.MAP[pull.startIndex + i] }));

  const res = calculateDyno(pullData, PROFILE, null, 'MAP');
  assert.equal(res.customName, 'MAP');
  assert.equal(res.curvePoints.length, 422);
  assert.ok(res.curvePoints.every(pt => typeof pt.custom === 'number'));
  assert.ok(res.customMax > res.customMin);
});

test('a missing custom channel yields null custom points', () => {
  const p = parseLog(read('haltech_wide.csv'), 'haltech_wide.csv');
  const pullData = p.pulls[0].data;
  const res = calculateDyno(pullData, PROFILE, null, 'Nope');
  assert.ok(res.curvePoints.every(pt => pt.custom === null));
  assert.equal(res.customMin, null);
  assert.equal(res.customMax, null);
});
