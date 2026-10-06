/**
 * capture-golden.js
 *
 * Regenerates the golden regression snapshot for the Haltech sample log.
 * Run BEFORE refactoring the parser to freeze current behavior:
 *   node tests/capture-golden.js
 *
 * The snapshot stores full scalar/structural output plus a SHA-256 hash of the
 * (large) allRows array so the fixture stays small while still catching any
 * change in per-row normalization.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseLog } = require('../server/parser');

const ROOT = path.join(__dirname, '..');
const SAMPLE = path.join(ROOT, 'Log parsing - re_261001_230131_3rd (1).csv');
const OUT_DIR = path.join(__dirname, 'fixtures', 'golden');
const OUT = path.join(OUT_DIR, 'haltech_sample.prerefactor.json');

function hashRows(rows) {
  return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

function summarizePulls(pulls) {
  return pulls.map(p => ({
    pullIndex: p.pullIndex,
    gear: p.gear,
    startRpm: p.startRpm,
    endRpm: p.endRpm,
    durationSec: p.durationSec,
    pointsCount: p.pointsCount
  }));
}

function main() {
  const content = fs.readFileSync(SAMPLE, 'utf8');
  const parsed = parseLog(content, path.basename(SAMPLE));

  const golden = {
    fixture: path.basename(SAMPLE),
    format: parsed.format,
    totalRows: parsed.totalRows,
    maxTpsSeen: parsed.maxTpsSeen,
    warning: parsed.warning,
    channelCount: parsed.channels.length,
    mapping: parsed.mapping,
    pullCount: parsed.pulls.length,
    pulls: summarizePulls(parsed.pulls),
    allRowsSha256: hashRows(parsed.allRows),
    allRowsLength: parsed.allRows.length,
    firstRow: parsed.allRows[0] || null,
    lastRow: parsed.allRows[parsed.allRows.length - 1] || null
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(golden, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${path.relative(ROOT, OUT)}`);
  console.log(`  format=${golden.format} rows=${golden.totalRows} pulls=${golden.pullCount}`);
  console.log(`  allRows sha256=${golden.allRowsSha256}`);
}

main();
