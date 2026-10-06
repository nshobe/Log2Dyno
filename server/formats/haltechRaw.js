/**
 * formats/haltechRaw.js - Haltech NSP %DataLog% raw export parser.
 *
 * Preserved from the original parser: channels are declared via
 * "Channel : <name>" lines, data rows start at an HH:MM:SS timestamp. Inline
 * magnitude scaling (e.g. TPS > 100 => /10) is kept for backward compatibility
 * with existing Haltech raw logs.
 */

'use strict';

function parseHaltechRaw(lines) {
  const channels = [];
  let dataStartIndex = -1;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('Channel : ')) {
      channels.push(line.replace('Channel : ', '').trim());
    } else if (/^\d{2}:\d{2}:\d{2}/.test(line)) {
      dataStartIndex = i;
      break;
    }
  }

  const rows = [];
  let t0 = null;

  for (let i = dataStartIndex; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < 2) continue;

    const timeStr = parts[0].trim();
    const timeMatch = timeStr.match(/^(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
    if (!timeMatch) continue;

    const totalSec = parseInt(timeMatch[1], 10) * 3600 +
                     parseInt(timeMatch[2], 10) * 60 +
                     parseFloat(timeMatch[3]);
    if (t0 === null) t0 = totalSec;

    const rowObj = { 'Time': Math.round((totalSec - t0) * 1000) / 1000 };

    for (let c = 0; c < channels.length; c++) {
      const ch = channels[c];
      let val = parseFloat(parts[c + 1]);
      if (isNaN(val)) continue;

      if (/throttle|tps/i.test(ch) && val > 100) val /= 10;
      if (/wideband|target lambda|lambda/i.test(ch) && val > 10) val /= 1000;
      if (/manifold pressure|map/i.test(ch) && val > 500) val /= 10; // kPa
      if (/ignition angle/i.test(ch) && Math.abs(val) > 100) val /= 10;
      if (/cam control/i.test(ch) && Math.abs(val) > 100) val /= 10;
      if (/vehicle speed/i.test(ch) && val > 500) val /= 10;
      if (/intake air temperature|iat/i.test(ch) && val > 1000) val /= 10;

      rowObj[ch] = val;
    }

    rows.push(rowObj);
  }

  return { channels: ['Time', ...channels], rows };
}

module.exports = { parseHaltechRaw };
