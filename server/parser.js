/**
 * parser.js - Universal tuning-log parser.
 *
 * Pipeline: detect format -> parse rows -> resolve channels -> normalize units.
 * Downstream (dynoMath.js, public/app.js) consumes the normalized row shape:
 *   { t, rpm, tps, mapPsi, boostPsi, lambda, targetLambda, ignition,
 *     knock, gear, speedMph, vvt, oilPressurePsi, iatF }
 *
 * Supported text formats: Haltech NSP raw, Haltech flat CSV, TunerStudio/MS
 * CSV, MegaSquirt MSL (tab), and generic CSV.
 */

'use strict';

const {
  KPA_TO_PSI,
  BAR_TO_PSI,
  normUnit,
  pressureToPsi,
  temperatureToF,
  speedToMph,
  fuelRatioToLambda
} = require('./units');
const { identifyChannels, normalizeName } = require('./channelMap');
const { detectFormat } = require('./formats');
const { splitLine, parseRows } = require('./formats/delimited');
const { parseHaltechRaw } = require('./formats/haltechRaw');

const FORMAT_LABELS = {
  haltech_nsp_raw: 'Haltech NSP raw',
  haltech_flat_csv: 'Haltech CSV (units row)',
  megasquirt_msl: 'MegaSquirt MSL / TunerStudio (tab)',
  megasquirt_csv: 'MegaSquirt / TunerStudio CSV',
  generic_csv: 'Generic CSV'
};

function warn(list, msg) {
  if (!list.includes(msg)) list.push(msg);
}

/**
 * Interpret an absolute manifold-pressure channel as { mapPsi, boostPsi }.
 * `maxMap` is used only when no unit is declared, to decide kPa vs psi.
 */
function interpretMapChannel(value, unit, family, maxMap) {
  const u = normUnit(unit);
  if (u.includes('kpa')) {
    const p = value * KPA_TO_PSI;
    return { mapPsi: p, boostPsi: p - 14.7 };
  }
  if (u.includes('bar')) {
    const p = value * BAR_TO_PSI;
    return { mapPsi: p, boostPsi: p - 14.7 };
  }
  if (u.includes('psi')) {
    // Haltech convention: gauge MAP logged in psi (0 psi = atmospheric)
    return { mapPsi: value + 14.7, boostPsi: value };
  }
  if (family === 'megasquirt') {
    const p = value * KPA_TO_PSI;
    return { mapPsi: p, boostPsi: p - 14.7 };
  }
  if (maxMap > 80) {
    const p = value * KPA_TO_PSI;
    return { mapPsi: p, boostPsi: p - 14.7 };
  }
  if (maxMap <= 45 && maxMap >= -15) {
    return { mapPsi: value + 14.7, boostPsi: value };
  }
  return { mapPsi: value, boostPsi: value - 14.7 };
}

function interpretBoostChannel(value, unit) {
  const u = normUnit(unit);
  if (u.includes('kpa')) {
    const p = (value - 101.325) * KPA_TO_PSI;
    return { boostPsi: p, mapPsi: p + 14.7 };
  }
  if (u.includes('bar')) {
    const gauge = (value - 1.01325) * BAR_TO_PSI;
    return { boostPsi: gauge, mapPsi: gauge + 14.7 };
  }
  // psi or unknown: assume gauge psi
  return { boostPsi: value, mapPsi: value + 14.7 };
}

function isNarrowbandName(name) {
  return /^(o2|ego|lambda sensor)$/.test(normalizeName(name));
}

function parseLog(fileContent, filename = '') {
  if (!fileContent || typeof fileContent !== 'string') {
    return { error: 'Empty or invalid file content' };
  }

  const lines = fileContent.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 3) {
    return { error: 'File contains insufficient data' };
  }

  const detection = detectFormat(lines, filename);
  const format = detection.id;
  const family = detection.family;

  let channels = [];
  let units = [];
  let rawRows = [];

  if (format === 'haltech_nsp_raw') {
    const parsed = parseHaltechRaw(lines);
    channels = parsed.channels;
    rawRows = parsed.rows;
  } else {
    channels = splitLine(lines[detection.headerIndex], detection.delimiter);
    units = detection.unitsIndex >= 0
      ? splitLine(lines[detection.unitsIndex], detection.delimiter)
      : [];
  }

  const mapping = identifyChannels(channels, units);

  if (format !== 'haltech_nsp_raw') {
    rawRows = parseRows(
      lines, detection.dataIndex, channels, units,
      mapping.time, detection.delimiter
    );
  }

  if (rawRows.length === 0) {
    return { error: 'No numeric telemetry rows could be parsed' };
  }

  // Column stats needed only when units are undeclared.
  const mapColumn = mapping.map;
  let maxMap = 0;
  if (mapColumn) {
    for (const r of rawRows) {
      const v = r[mapColumn];
      if (typeof v === 'number' && Math.abs(v) > Math.abs(maxMap)) maxMap = v;
    }
  }

  const unitWarnings = [];
  if (mapColumn && !normUnit(mapping.mapUnit)) {
    warn(unitWarnings, `MAP column "${mapColumn}" has no declared unit; inferred from range/family.`);
  }
  if (mapping.iat && !normUnit(mapping.iatUnit)) {
    warn(unitWarnings, `Intake-air column "${mapping.iat}" has no declared unit; applied ${family === 'megasquirt' ? 'Fahrenheit (MegaSquirt default)' : 'Celsius'}.`);
  }
  if (mapping.speed && !normUnit(mapping.speedUnit)) {
    warn(unitWarnings, `Vehicle speed column "${mapping.speed}" has no declared unit; left unconverted.`);
  }
  if (mapping.lambda && isNarrowbandName(mapping.lambda)) {
    warn(unitWarnings, `Fuel channel "${mapping.lambda}" looks like a narrowband O2/EGO signal; lambda left blank.`);
  }

  let maxTpsSeen = 0;
  const normalizedRows = [];

  for (let i = 0; i < rawRows.length; i++) {
    const r = rawRows[i];
    const t = r[mapping.time];
    const rpm = r[mapping.rpm];
    const tpsRaw = r[mapping.tps];
    const mapRaw = r[mapping.map];
    const boostRaw = r[mapping.boost];
    const lambdaRaw = r[mapping.lambda];
    const targetLambdaRaw = r[mapping.targetLambda];
    const ignitionRaw = r[mapping.ignition];
    const knockRaw = r[mapping.knock];
    const gearRaw = r[mapping.gear];
    const speedRaw = r[mapping.speed];
    const vvtRaw = r[mapping.vvt];
    const oilRaw = r[mapping.oilPressure];
    const iatRaw = r[mapping.iat];

    if (t === undefined || isNaN(t) || rpm === undefined || isNaN(rpm)) continue;

    let tps = tpsRaw;
    if (tps !== undefined && !isNaN(tps)) {
      if (tps > maxTpsSeen) maxTpsSeen = tps;
    } else {
      tps = 100;
    }

    // Pressure: prefer an explicit boost channel, else interpret MAP.
    let mapPsi = null;
    let boostPsi = null;
    if (boostRaw !== undefined && !isNaN(boostRaw)) {
      const b = interpretBoostChannel(boostRaw, mapping.boostUnit);
      boostPsi = b.boostPsi;
      mapPsi = b.mapPsi;
    } else if (mapRaw !== undefined && !isNaN(mapRaw)) {
      const m = interpretMapChannel(mapRaw, mapping.mapUnit, family, maxMap);
      mapPsi = m.mapPsi;
      boostPsi = m.boostPsi;
    }

    // Fuel ratio: only convert AFR->lambda when explicitly known.
    let lambda = null;
    if (lambdaRaw !== undefined && !isNaN(lambdaRaw) && !isNarrowbandName(mapping.lambda)) {
      lambda = fuelRatioToLambda(lambdaRaw, mapping.lambdaIsAfr);
    }

    let targetLambda = null;
    if (targetLambdaRaw !== undefined && !isNaN(targetLambdaRaw)) {
      targetLambda = fuelRatioToLambda(targetLambdaRaw, mapping.targetLambdaIsAfr);
    }

    // Oil pressure -> PSI (unit-aware; no magnitude guessing).
    let oilPressurePsi = null;
    if (oilRaw !== undefined && !isNaN(oilRaw)) {
      const converted = pressureToPsi(oilRaw, mapping.oilPressureUnit);
      oilPressurePsi = converted !== null ? converted : oilRaw;
    }

    // Intake air -> Fahrenheit.
    let iatF = null;
    if (iatRaw !== undefined && !isNaN(iatRaw)) {
      const converted = temperatureToF(iatRaw, mapping.iatUnit);
      if (converted !== null) {
        iatF = converted;
      } else if (family === 'megasquirt') {
        iatF = iatRaw; // MS defaults to °F
      } else {
        iatF = iatRaw * 1.8 + 32; // assume Celsius
      }
    }

    // Speed -> MPH (unit-aware; otherwise left as-is).
    let speedMph = null;
    if (speedRaw !== undefined && !isNaN(speedRaw)) {
      const converted = speedToMph(speedRaw, mapping.speedUnit);
      speedMph = Math.round((converted !== null ? converted : speedRaw) * 10) / 10;
    }

    normalizedRows.push({
      t,
      rpm,
      tps: Math.round(tps * 10) / 10,
      mapPsi: mapPsi !== null ? Math.round(mapPsi * 10) / 10 : null,
      boostPsi: boostPsi !== null ? Math.round(boostPsi * 10) / 10 : null,
      lambda: lambda !== null ? Math.round(lambda * 1000) / 1000 : null,
      targetLambda: targetLambda !== null ? Math.round(targetLambda * 1000) / 1000 : null,
      ignition: ignitionRaw !== undefined && !isNaN(ignitionRaw) ? Math.round(ignitionRaw * 10) / 10 : null,
      knock: knockRaw !== undefined && !isNaN(knockRaw) ? knockRaw : 0,
      gear: gearRaw !== undefined && !isNaN(gearRaw) ? Math.round(gearRaw) : null,
      speedMph,
      vvt: vvtRaw !== undefined && !isNaN(vvtRaw) ? Math.round(vvtRaw * 10) / 10 : null,
      oilPressurePsi: oilPressurePsi !== null ? Math.round(oilPressurePsi * 10) / 10 : null,
      iatF: iatF !== null ? Math.round(iatF) : null
    });
  }

  // WOT Pull Extraction: requires >= 85% TPS
  const WOT_THRESHOLD = 85.0;
  const pulls = extractWotPulls(normalizedRows, WOT_THRESHOLD);

  let warning = null;
  if (pulls.length === 0) {
    if (maxTpsSeen < WOT_THRESHOLD) {
      warning = `Warning: No 85%+ Throttle Position detected in this log. Peak throttle observed was ${Math.round(maxTpsSeen * 10) / 10}%. Virtual dyno calculations require wide-open throttle (>= 85%).`;
    } else {
      warning = `Warning: 85%+ throttle was observed, but no sustained RPM ascent pull was found.`;
    }
  }

  const unmappedRequired = ['rpm', 'tps', 'map'].filter(k => !mapping[k]);
  if (unmappedRequired.length) {
    const msg = `Warning: Could not identify required channel(s): ${unmappedRequired.join(', ')}. Available: ${channels.slice(0, 12).join(', ')}${channels.length > 12 ? ', …' : ''}`;
    warning = warning ? `${warning} ${msg}` : msg;
  }

  return {
    filename,
    format,
    formatLabel: FORMAT_LABELS[format] || format,
    family,
    detectedDelimiter: detection.delimiter,
    totalRows: normalizedRows.length,
    channels,
    units,
    mapping,
    unmappedRequired,
    unitWarnings,
    maxTpsSeen: Math.round(maxTpsSeen * 10) / 10,
    warning,
    pulls,
    allRows: normalizedRows
  };
}

function extractWotPulls(rows, thresholdTps = 85.0) {
  const pulls = [];
  let inWot = false;
  let currentPull = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const isWot = (r.tps >= thresholdTps);

    if (isWot) {
      if (!inWot) {
        inWot = true;
        currentPull = [r];
      } else {
        currentPull.push(r);
      }
    } else {
      if (inWot) {
        inWot = false;
        if (currentPull.length >= 20) {
          validateAndAddPull(currentPull, pulls);
        }
        currentPull = [];
      }
    }
  }

  if (inWot && currentPull.length >= 20) {
    validateAndAddPull(currentPull, pulls);
  }

  return pulls;
}

function validateAndAddPull(pullRows, pulls) {
  const minRpm = Math.min(...pullRows.map(p => p.rpm));
  const maxRpm = Math.max(...pullRows.map(p => p.rpm));
  const duration = pullRows[pullRows.length - 1].t - pullRows[0].t;

  if ((maxRpm - minRpm) >= 1200 && duration >= 0.8) {
    const gearCounts = {};
    pullRows.forEach(r => {
      if (r.gear) gearCounts[r.gear] = (gearCounts[r.gear] || 0) + 1;
    });
    let dominantGear = 3;
    let maxCount = 0;
    Object.entries(gearCounts).forEach(([g, count]) => {
      if (count > maxCount) {
        maxCount = count;
        dominantGear = parseInt(g, 10);
      }
    });

    pulls.push({
      pullIndex: pulls.length + 1,
      gear: dominantGear,
      startRpm: Math.round(minRpm),
      endRpm: Math.round(maxRpm),
      durationSec: Math.round(duration * 100) / 100,
      pointsCount: pullRows.length,
      data: pullRows
    });
  }
}

module.exports = {
  parseLog,
  identifyChannels,
  extractWotPulls,
  interpretMapChannel,
  interpretBoostChannel
};
