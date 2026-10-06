/**
 * channelMap.js - Semantic channel resolver.
 *
 * Maps arbitrary datalog column names to canonical telemetry fields. Unlike the
 * previous ordered-regex approach, this is a scored matcher over normalized
 * names with explicit reject patterns, so status/boolean/derived columns
 * (e.g. "MAP from sensor seems valid", "boostStatus.pTerm",
 * "IAT: measured resistance") do not shadow the real signal.
 *
 * Resolution is name-driven only. Unit-aware interpretation happens later in
 * parser.js / units.js. If nothing matches, the field stays null: never guess.
 */

'use strict';

const TRAILING_UNIT_TOKENS = new Set([
  'c', 'f', 'k', 'kpa', 'psi', 'bar', 'v', 'volt', 'volts',
  'deg', 'degc', 'degf', 'rpm', 'mph', 'kph', 'kmh', 'mps',
  'pct', 'percent', 'hz', 'ms', 's', 'us'
]);

function normalizeName(raw) {
  let name = String(raw == null ? '' : raw)
    .toLowerCase()
    .replace(/°/g, ' deg ')
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  // Drop trailing unit/suffix tokens so names like "air_temp_c" or
  // "manifold_pressure_kpa" resolve to their base concept. Never reduce a name
  // to nothing (e.g. a column literally named "rpm" stays "rpm").
  let parts = name.split(' ').filter(Boolean);
  while (parts.length > 1 && TRAILING_UNIT_TOKENS.has(parts[parts.length - 1])) {
    parts.pop();
  }
  return parts.join(' ');
}

/**
 * Each spec lists [regex, score] pairs ordered best-first. The first matching
 * pattern for a channel wins; the highest-scoring channel overall is selected.
 */
const SPECS = {
  time: {
    patterns: [
      [/^time$/, 100],
      [/^(secl|sec l|second|seconds|timestamp|elapsed time|log time)$/, 95],
      [/\btime\b/, 40]
    ],
    reject: [/timeout/, /runtime/, /uptime/, /timestamp.*(error|fault)/]
  },
  rpm: {
    patterns: [
      [/^rpm$/, 100],
      [/^engine (speed|rpm)$/, 95],
      [/^enginespeed$/, 90],
      [/\brpm\b/, 40]
    ],
    reject: [/delta/, /^d ?rpm$/, /idle/, /limit/, /target/, /error/, /fault/, /desired/]
  },
  map: {
    patterns: [
      [/^map$/, 100],
      [/^map ?1$/, 96],
      [/^manifold (absolute )?pressure$/, 92],
      [/^map ?(kpa|sensor|value)$/, 85]
    ],
    reject: [/valid/, /status/, /error/, /fault/, /unknown/, /sample/]
  },
  boost: {
    patterns: [
      [/^boost$/, 100],
      [/^boost ?(psi|pressure|value)$/, 95],
      [/^manifold relative pressure$/, 92],
      [/^relative pressure$/, 88]
    ],
    reject: [/status/, /duty/, /solenoid/, /pid/, /pterm/, /integral/, /derivative/,
             /target/, /table/, /control/, /fault/, /error/, /enable/, /limit/, /dc$/]
  },
  tps: {
    patterns: [
      [/^tps$/, 100],
      [/^throttle position$/, 95],
      [/^throttle$/, 90],
      [/^throttle opening$/, 88],
      [/^tps ?(pct|percent|%)?$/, 85]
    ],
    reject: [/error/, /fault/, /raw/, /adc/, /2$/, /pedal/, /target/, /wot/, /axis/]
  },
  lambda: {
    patterns: [
      [/^lambda$/, 100],
      [/^lambda ?1$/, 96],
      [/^wideband( o2)?$/, 92],
      [/^afr$/, 90],
      [/^afr ?1$/, 88],
      [/^a f( ratio)?$/, 85],
      [/^o2$/, 60],
      [/^ego$/, 55]
    ],
    reject: [/target/, /correction/, /duty/, /heater/, /status/, /error/, /fault/, /bank 2/, /bank2/]
  },
  targetLambda: {
    patterns: [
      [/^(target lambda|lambda target|target afr|afr target)$/, 100],
      [/^final fueling base$/, 95],
      [/^target (fuel|ratio)$/, 80]
    ],
    reject: [/correction/, /error/, /fault/]
  },
  ignition: {
    patterns: [
      [/^ignition (angle|timing|advance)$/, 100],
      [/^spark (advance|angle|timing)$/, 96],
      [/^(advance|timing advance|ign angle|ignition timing)$/, 90],
      [/^spark$/, 70]
    ],
    reject: [/mode/, /duty/, /coil/, /trim/, /offset/, /base map/, /table/, /cut/,
             /fault/, /error/, /correction/, /charge/]
  },
  knock: {
    patterns: [
      [/^knock$/, 100],
      [/^knock (retard|level|current level|count|feedback|value)$/, 95],
      [/^feedback knock$/, 92],
      [/^knk$/, 80]
    ],
    reject: [/fault/, /error/, /table/, /threshold/, /sensor/, /status/, /control/, /enable/]
  },
  gear: {
    patterns: [
      [/^gear$/, 100],
      [/^gear (number|position|engaged)$/, 96],
      [/^(current|detected|trans|selected) gear$/, 92]
    ],
    reject: [/ratio/, /box/, /tcu/, /desired/, /target/, /display/, /neutral/, /error/, /fault/]
  },
  speed: {
    patterns: [
      [/^vss1?$/, 100],
      [/^vss$/, 98],
      [/^vehicle speed$/, 95],
      [/^speed$/, 90],
      [/^(ground|wheel|gps) speed$/, 85]
    ],
    reject: [/limit/, /target/, /error/, /fault/, /max/, /desired/, /fan/]
  },
  vvt: {
    patterns: [
      [/^vvt( bank 1 intake)?$/, 100],
      [/^vvt ?1$/, 96],
      [/^cam (angle|control)$/, 90],
      [/^intake cam( angle)?$/, 88]
    ],
    reject: [/target/, /error/, /fault/, /status/, /duty/]
  },
  oilPressure: {
    patterns: [
      [/^oil (pressure|press|p)$/, 100],
      [/^oilpressure$/, 98]
    ],
    reject: [/temp/, /level/, /status/, /error/, /fault/, /raw/, /adc/, /warning/]
  },
  iat: {
    patterns: [
      [/^(iat|mat)$/, 100],
      [/^intake air (temp|temperature|iat)$/, 96],
      [/^manifold air (temp|temperature)?$/, 94],
      [/^air (temp|temperature|charge temp)$/, 88]
    ],
    reject: [/resist/, /raw/, /adc/, /volt/, /sensor/, /error/, /fault/, /status/, /correction/]
  },
  coolant: {
    patterns: [
      [/^(clt|ect|coolant|water)$/, 100],
      [/^coolant (temp|temperature)$/, 96],
      [/^(engine coolant temp|engine temp)$/, 90]
    ],
    reject: [/resist/, /raw/, /adc/, /volt/, /error/, /fault/, /status/, /warning/, /fan/]
  },
  baro: {
    patterns: [
      [/^(baro|barometric pressure|baro pressure|atmospheric pressure)$/, 100],
      [/^baro ?sensor$/, 80]
    ],
    reject: [/valid/, /status/, /error/, /fault/]
  },
  ethanol: {
    patterns: [
      [/^ethanol( content| %)?$/, 100],
      [/^flex( ethanol %?)?$/, 94],
      [/^eth %?$/, 88]
    ],
    reject: [/target/, /error/, /fault/, /status/]
  }
};

function bestMatch(channels, spec) {
  let best = null;
  for (let i = 0; i < channels.length; i++) {
    const name = normalizeName(channels[i]);
    if (!name) continue;
    if (spec.reject && spec.reject.some(re => re.test(name))) continue;
    for (const [re, score] of spec.patterns) {
      if (re.test(name)) {
        if (!best || score > best.score) {
          best = { index: i, name: channels[i], score };
        }
        break;
      }
    }
  }
  return best;
}

function unitAt(units, index) {
  if (index == null || index < 0 || !Array.isArray(units)) return '';
  const u = units[index];
  return u == null ? '' : String(u).trim();
}

function isAfrName(name, unit) {
  const n = normalizeName(name);
  const u = String(unit || '').toLowerCase();
  return /afr|a f/.test(n) || u.includes('afr');
}

/**
 * Resolve canonical fields from channel names (+ optional units row).
 * Returns a flat mapping object compatible with the historical shape plus
 * extra metadata (boostUnit, lambdaIsAfr, baro, coolant, ethanol, index maps).
 */
function identifyChannels(channels, units = []) {
  const pick = (key) => bestMatch(channels, SPECS[key]);

  const time = pick('time');
  const rpm = pick('rpm');
  const tps = pick('tps');
  const map = pick('map');
  const boost = pick('boost');
  const lambda = pick('lambda');
  const targetLambda = pick('targetLambda');
  const ignition = pick('ignition');
  const knock = pick('knock');
  const gear = pick('gear');
  const speed = pick('speed');
  const vvt = pick('vvt');
  const oilPressure = pick('oilPressure');
  const iat = pick('iat');
  const coolant = pick('coolant');
  const baro = pick('baro');
  const ethanol = pick('ethanol');

  const indexOf = (m) => (m ? m.index : -1);
  const nameOf = (m, fallback) => (m ? m.name : fallback);

  return {
    // canonical columns
    time: nameOf(time, channels[0]),
    timeIndex: indexOf(time) >= 0 ? indexOf(time) : 0,
    rpm: nameOf(rpm, null),
    tps: nameOf(tps, null),
    map: nameOf(map, null),
    mapUnit: unitAt(units, indexOf(map)),
    boost: nameOf(boost, null),
    boostUnit: unitAt(units, indexOf(boost)),
    baro: nameOf(baro, null),
    baroUnit: unitAt(units, indexOf(baro)),
    lambda: nameOf(lambda, null),
    lambdaUnit: unitAt(units, indexOf(lambda)),
    lambdaIsAfr: lambda ? isAfrName(lambda.name, unitAt(units, indexOf(lambda))) : false,
    targetLambda: nameOf(targetLambda, null),
    targetLambdaIsAfr: targetLambda
      ? isAfrName(targetLambda.name, unitAt(units, indexOf(targetLambda)))
      : false,
    ignition: nameOf(ignition, null),
    knock: nameOf(knock, null),
    gear: nameOf(gear, null),
    speed: nameOf(speed, null),
    speedUnit: unitAt(units, indexOf(speed)),
    vvt: nameOf(vvt, null),
    oilPressure: nameOf(oilPressure, null),
    oilPressureUnit: unitAt(units, indexOf(oilPressure)),
    iat: nameOf(iat, null),
    iatUnit: unitAt(units, indexOf(iat)),
    coolant: nameOf(coolant, null),
    coolantUnit: unitAt(units, indexOf(coolant)),
    ethanol: nameOf(ethanol, null),
    ethanolUnit: unitAt(units, indexOf(ethanol)),

    // per-field resolution scores (for diagnostics)
    _scores: {
      time: time && time.score, rpm: rpm && rpm.score, tps: tps && tps.score,
      map: map && map.score, boost: boost && boost.score, lambda: lambda && lambda.score,
      ignition: ignition && ignition.score, iat: iat && iat.score
    }
  };
}

module.exports = { identifyChannels, normalizeName, SPECS };
