/**
 * formats/delimited.js - Delimiter-aware, quote-aware parsing for text logs.
 */

'use strict';

function splitLine(line, delimiter) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && ch === delimiter) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map(s => s.trim());
}

const TIME_HMS_RE = /^(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)$/;

function parseTimeValue(valStr, unit) {
  const hms = TIME_HMS_RE.exec(valStr);
  if (hms) {
    return parseInt(hms[1], 10) * 3600 + parseInt(hms[2], 10) * 60 + parseFloat(hms[3]);
  }
  const num = parseFloat(valStr);
  if (isNaN(num)) return undefined;
  const u = String(unit || '').toLowerCase();
  if (u.includes('ms') || u.includes('millisecond')) return num / 1000;
  return num;
}

/**
 * Parse delimited data lines into row objects keyed by channel name.
 * Channels are matched positionally to the header.
 */
function parseRows(lines, startIndex, channels, units, timeChannel, delimiter) {
  const rows = [];
  let t0 = null;
  const timeIdx = channels.indexOf(timeChannel);
  const timeUnit = timeIdx >= 0 && units ? units[timeIdx] : '';

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const parts = splitLine(line, delimiter);
    if (parts.length < 2) continue;

    const rowObj = {};
    for (let c = 0; c < channels.length; c++) {
      const ch = channels[c];
      if (ch === undefined || ch === '') continue;
      const valStr = parts[c];
      if (valStr === undefined || valStr === '') continue;

      if (ch === timeChannel) {
        if (TIME_HMS_RE.test(valStr)) {
          const sec = parseTimeValue(valStr, '');
          if (t0 === null) t0 = sec;
          rowObj[ch] = Math.round((sec - t0) * 1000) / 1000;
        } else {
          const t = parseTimeValue(valStr, timeUnit);
          if (t !== undefined) rowObj[ch] = t;
        }
      } else {
        const num = parseFloat(valStr);
        if (!isNaN(num)) rowObj[ch] = num;
      }
    }
    rows.push(rowObj);
  }
  return rows;
}

module.exports = { splitLine, parseRows, parseTimeValue, TIME_HMS_RE };
