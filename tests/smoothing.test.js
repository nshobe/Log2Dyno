/**
 * smoothing.test.js - dyno (HP/TQ) smoothing vs lower-graph telemetry smoothing.
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
  gear: 3
};

function buildPull() {
  const p = parseLog(read('haltech_wide.csv'), 'haltech_wide.csv', { series: ['MAP'] });
  const pull = p.pulls[0];
  return pull.data.map((row, i) => ({ ...row, custom: p.series.MAP[pull.startIndex + i] }));
}

test('telemetry smoothing changes lower-graph traces but not HP/TQ', () => {
  const pullData = buildPull();
  const light = calculateDyno(pullData, { ...PROFILE, smoothing: 8, telemSmoothing: 0 }, null, 'MAP');
  const heavy = calculateDyno(pullData, { ...PROFILE, smoothing: 8, telemSmoothing: 8 }, null, 'MAP');

  // Same dyno smoothing => identical grid and identical power/torque.
  assert.equal(light.curvePoints.length, heavy.curvePoints.length);
  assert.equal(light.peakHp, heavy.peakHp);
  assert.equal(light.peakTorque, heavy.peakTorque);
  assert.ok(light.curvePoints.every((pt, i) =>
    pt.hp === heavy.curvePoints[i].hp && pt.torque === heavy.curvePoints[i].torque));

  // ...but the telemetry traces must differ.
  const differs = light.curvePoints.some((pt, i) =>
    pt.boostPsi !== heavy.curvePoints[i].boostPsi ||
    pt.lambda !== heavy.curvePoints[i].lambda ||
    pt.tps !== heavy.curvePoints[i].tps ||
    pt.custom !== heavy.curvePoints[i].custom);
  assert.ok(differs, 'telemetry smoothing should affect boost/lambda/tps/custom');
});

test('dyno smoothing still controls the HP/TQ curve', () => {
  const pullData = buildPull();
  const raw = calculateDyno(pullData, { ...PROFILE, smoothing: 0, telemSmoothing: 2 }, null, 'MAP');
  const smoothed = calculateDyno(pullData, { ...PROFILE, smoothing: 10, telemSmoothing: 2 }, null, 'MAP');

  assert.notEqual(raw.peakHp, smoothed.peakHp);
});

test('telemetry smoothing defaults to 0 when unspecified', () => {
  const pullData = buildPull();
  const unspecified = calculateDyno(pullData, { ...PROFILE, smoothing: 8 }, null, 'MAP');
  const explicitZero = calculateDyno(pullData, { ...PROFILE, smoothing: 8, telemSmoothing: 0 }, null, 'MAP');

  assert.deepEqual(
    unspecified.curvePoints.map(pt => pt.boostPsi),
    explicitZero.curvePoints.map(pt => pt.boostPsi));
  assert.deepEqual(
    unspecified.curvePoints.map(pt => pt.custom),
    explicitZero.curvePoints.map(pt => pt.custom));
});

test('heavy telemetry smoothing reduces trace variance', () => {
  const pullData = buildPull();
  const light = calculateDyno(pullData, { ...PROFILE, smoothing: 4, telemSmoothing: 0 }, null, 'MAP');
  const heavy = calculateDyno(pullData, { ...PROFILE, smoothing: 4, telemSmoothing: 10 }, null, 'MAP');

  const variance = (vals) => {
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    return vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
  };
  const diffs = (pts) => pts.slice(1).map((pt, i) => Math.abs(pt.custom - pts[i].custom));

  assert.ok(variance(diffs(heavy.curvePoints)) <= variance(diffs(light.curvePoints)));
});
