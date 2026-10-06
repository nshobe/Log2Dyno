/**
 * formats/index.js - Format detection registry for text datalogs.
 *
 * Detection is layered:
 *   1. Vendor/format signature (Haltech %DataLog%, "MSn Format" preamble)
 *   2. Delimiter sniffing (tab / comma / semicolon)
 *   3. Header row detection (most non-numeric row in the first few lines)
 *   4. Optional units row detection immediately after the header
 */

'use strict';

const { splitLine } = require('./delimited');

const UNIT_TOKEN_RE = new RegExp(
  '^(' +
  's|sec|secs|seconds|ms|milliseconds|' +
  'rpm|%|kpa|psi|bar|v|volt|volts|deg|degrees|degc|degf|c|f|' +
  'afr|lambda|:1|mph|km/h|kmh|kph|m/s|g/s|mg|in|mm|l|gal|g|' +
  'kw|hp|nm|lb-ft|ft-lb|ohms?|ohm' +
  ')$', 'i'
);

function isHaltechRaw(firstLine) {
  return typeof firstLine === 'string' && firstLine.startsWith('%DataLog%');
}

function isMegasquirtPreamble(firstLine) {
  if (typeof firstLine !== 'string') return false;
  return /^"?MS\d?\/?Extra/i.test(firstLine) ||
         /^"?MS\d\s*Format/i.test(firstLine) ||
         /^"?MegaSquirt/i.test(firstLine);
}

function sniffDelimiter(lines) {
  const counts = { '\t': 0, ',': 0, ';': 0 };
  const sample = lines.slice(0, 8).filter(l => l && l.trim());
  for (const line of sample) {
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (!inQuotes && (ch === '\t' || ch === ',' || ch === ';')) counts[ch]++;
    }
  }
  let best = null;
  for (const d of ['\t', ',', ';']) {
    if (counts[d] > 0 && (best === null || counts[d] > counts[best])) best = d;
  }
  return best || ',';
}

function isNumericCell(cell) {
  if (cell === '' || cell == null) return true; // empty is not evidence of a header
  const cleaned = String(cell).replace(/^"|"$/g, '').trim();
  if (cleaned === '') return true;
  return !isNaN(Number(cleaned));
}

function findHeaderIndex(lines, delimiter) {
  const limit = Math.min(lines.length, 10);
  for (let i = 0; i < limit; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const cells = splitLine(line, delimiter);
    if (cells.length < 2) continue;
    const nonNumeric = cells.filter(c => !isNumericCell(c)).length;
    const nonEmpty = cells.filter(c => c !== '').length;
    if (nonEmpty > 0 && nonNumeric / nonEmpty >= 0.5) return i;
  }
  return 0;
}

function findUnitsIndex(lines, headerIndex, delimiter) {
  const idx = headerIndex + 1;
  if (idx >= lines.length) return -1;
  const cells = splitLine(lines[idx], delimiter);
  if (cells.length < 2) return -1;

  let unitLike = 0;
  let nonEmptyUnitTokens = 0;
  for (const cell of cells) {
    const c = String(cell).replace(/^"|"$/g, '').trim();
    if (c === '') { unitLike++; continue; }
    const bare = c.replace(/\(.*?\)/g, '').trim();
    if (UNIT_TOKEN_RE.test(bare) || /°/.test(c)) {
      unitLike++;
      nonEmptyUnitTokens++;
    }
  }
  if (nonEmptyUnitTokens < 1) return -1;
  if (unitLike / cells.length >= 0.6) return idx;
  return -1;
}

const HALTECH_MARKERS = [
  'wideband', 'manifold relative pressure', 'cam control', 'ignition angle',
  'antilag', 'tpsadc', 'rawmaf', 'internalvref', 'gearbox ratio',
  'vvt: bank', 'sd: present', 'sd: logging'
];
const MS_MARKERS = ['secl', 'spark', 'mat', 'clt', 'ego', 'gego', 'pw', 've', 'afr', 'baro'];

function detectFamily(headerCells, filename) {
  const joined = headerCells.join('\u0000').toLowerCase();
  const haltechHits = HALTECH_MARKERS.filter(m => joined.includes(m)).length;
  if (haltechHits >= 2) return 'haltech';
  if (/\.msl$/i.test(filename || '')) return 'megasquirt';
  const names = headerCells.map(n => String(n).toLowerCase().replace(/[^a-z0-9]+/g, ''));
  const msHits = MS_MARKERS.filter(m => names.includes(m)).length;
  if (msHits >= 2) return 'megasquirt';
  return 'generic';
}

/**
 * @returns {{
 *   id: string, family: string, delimiter: string,
 *   headerIndex: number, unitsIndex: number, dataIndex: number,
 *   hasUnits: boolean, preamble: string[]
 * }}
 */
function detectFormat(lines, filename = '') {
  const first = lines[0] || '';

  if (isHaltechRaw(first)) {
    return {
      id: 'haltech_nsp_raw',
      family: 'haltech',
      delimiter: ',',
      headerIndex: 1,
      unitsIndex: -1,
      dataIndex: -1,
      hasUnits: false,
      preamble: [first]
    };
  }

  const delimiter = sniffDelimiter(lines);
  const headerIndex = findHeaderIndex(lines, delimiter);
  const unitsIndex = findUnitsIndex(lines, headerIndex, delimiter);
  const dataIndex = unitsIndex >= 0 ? unitsIndex + 1 : headerIndex + 1;
  const headerCells = splitLine(lines[headerIndex] || '', delimiter);
  const preamble = lines.slice(0, headerIndex);

  if (isMegasquirtPreamble(first) || isMegasquirtPreamble(lines[headerIndex - 1] || '')) {
    return {
      id: 'megasquirt_msl', family: 'megasquirt', delimiter,
      headerIndex, unitsIndex, dataIndex, hasUnits: unitsIndex >= 0, preamble
    };
  }

  const family = detectFamily(headerCells, filename);

  if (family === 'megasquirt') {
    const id = (delimiter === '\t' || /\.msl$/i.test(filename)) ? 'megasquirt_msl' : 'megasquirt_csv';
    return { id, family, delimiter, headerIndex, unitsIndex, dataIndex, hasUnits: unitsIndex >= 0, preamble };
  }

  if (unitsIndex >= 0) {
    return {
      id: 'haltech_flat_csv', family: 'haltech', delimiter,
      headerIndex, unitsIndex, dataIndex, hasUnits: true, preamble
    };
  }

  return {
    id: 'generic_csv', family, delimiter,
    headerIndex, unitsIndex, dataIndex, hasUnits: false, preamble
  };
}

module.exports = {
  detectFormat,
  sniffDelimiter,
  findHeaderIndex,
  findUnitsIndex,
  isMegasquirtPreamble,
  isHaltechRaw
};
