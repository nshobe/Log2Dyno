/**
 * rpmTrim.test.js - per-run RPM window trimming (pull subset -> curve window).
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

const PROFILE = {
  weightLbs: 3351,
  gearRatio: 1.346,
  finalDrive: 3.9,
  tireDiameterInches: 24.97,
  dragCoefficient: 0.33,
  frontalAreaSqFt: 22.2,
  gear: 3,
  smoothing: 4,
  telemSmoothing: 0
};

function fullPull() {
  const p = parseLog(read('haltech_wide.csv'), 'haltech_wide.csv', { series: ['MAP'] });
  const pull = p.pulls[0];
  return pull.data.map((row, i) => ({ ...row, custom: p.series.MAP[pull.startIndex + i] }));
}

test('trimming the pull RPM window narrows the resulting curve', () => {
  const pullData = fullPull();
  const full = calculateDyno(pullData, PROFILE, null, 'MAP');
  const trimmed = calculateDyno(pullData.filter(r => r.rpm >= 3000 && r.rpm <= 5000), PROFILE, null, 'MAP');

  assert.equal(trimmed.error, undefined);
  assert.ok(trimmed.curvePoints.length > 0);
  assert.ok(trimmed.curvePoints.length < full.curvePoints.length);
  assert.ok(trimmed.startRpm > full.startRpm, `${trimmed.startRpm} should be above ${full.startRpm}`);
  assert.ok(trimmed.endRpm < full.endRpm, `${trimmed.endRpm} should be below ${full.endRpm}`);
  // Every emitted point stays inside the requested window.
  assert.ok(trimmed.curvePoints.every(pt => pt.rpm >= 3000 && pt.rpm <= 5000));
});

test('a window too narrow to compute reports an error instead of crashing', () => {
  const pullData = fullPull();
  const tooNarrow = calculateDyno(pullData.filter(r => r.rpm >= 4000 && r.rpm <= 4040), PROFILE);
  assert.ok(tooNarrow.error || tooNarrow.curvePoints.length < 5);
});
