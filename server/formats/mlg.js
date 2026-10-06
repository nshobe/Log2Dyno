/**
 * formats/mlg.js - TunerStudio / MegaLogViewer binary MLG (MLVLG) decoder.
 *
 * Supports format versions 1 and 2. All multi-byte values are big-endian.
 * Spec: https://www.efianalytics.com/TunerStudio/docs/MLG_Binary_LogFormat_2.0.pdf
 *
 * A header defines an ordered list of logger fields; the data section is a
 * back-to-back sequence of type-data blocks:
 *   type 0: [type u8][counter u8][timestamp u16 @10us][raw field data][crc u8]
 *   type 1: [type u8][counter u8][timestamp u16][message 50 bytes]
 * DisplayValue = (rawValue + transform) * scale.
 */

'use strict';

const MARKER_MESSAGE_LENGTH = 50;
const FIELD_NAME_LENGTH = 34;
const FIELD_UNITS_LENGTH = 10;
const TICK_SECONDS = 1e-5; // timestamp unit: 10 microseconds per bit

function fieldLength(version) {
  return version >= 2 ? 89 : 55;
}

function readCString(buf, start, len) {
  if (start < 0 || start >= buf.length) return '';
  const max = Math.min(start + len, buf.length);
  let end = start;
  while (end < max && buf[end] !== 0) end++;
  return buf.toString('latin1', start, end).trim();
}

/** Read a scalar/bitfield value. Returns { value, size } or null for unknown types. */
function decodeValue(buf, offset, type) {
  try {
    switch (type) {
      case 0: return { value: buf.readUInt8(offset), size: 1 };
      case 1: return { value: buf.readInt8(offset), size: 1 };
      case 2: return { value: buf.readUInt16BE(offset), size: 2 };
      case 3: return { value: buf.readInt16BE(offset), size: 2 };
      case 4: return { value: buf.readUInt32BE(offset), size: 4 };
      case 5: return { value: buf.readInt32BE(offset), size: 4 };
      case 6: return { value: Number(buf.readBigInt64BE(offset)), size: 8 };
      case 7: return { value: buf.readFloatBE(offset), size: 4 };
      case 10: return { value: buf.readUInt8(offset), size: 1 };
      case 11: return { value: buf.readUInt16BE(offset), size: 2 };
      case 12: return { value: buf.readUInt32BE(offset), size: 4 };
      default: return null;
    }
  } catch (_) {
    return null;
  }
}

function isMlgBuffer(buffer) {
  if (!buffer || buffer.length < 8) return false;
  return buffer.toString('latin1', 0, 5) === 'MLVLG';
}

/**
 * Decode an MLG buffer into channel-oriented rows.
 * @param {Buffer|Uint8Array|ArrayBuffer} input
 * @returns {{channels:string[], units:string[], rows:object[], fields:object[],
 *            info:string, bitFieldNames:string, markers:object[],
 *            formatVersion:number, timestamp:number}}
 */
function parseMlg(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (!isMlgBuffer(buf)) {
    throw new Error('Not an MLVLG binary file');
  }

  const version = buf.readUInt16BE(6);
  if (version !== 1 && version !== 2) {
    throw new Error(`Unsupported MLG format version ${version}`);
  }

  const timestamp = buf.readUInt32BE(8);
  let offset = 12;
  let infoDataStart;
  if (version >= 2) {
    infoDataStart = buf.readUInt32BE(offset);
    offset += 4;
  } else {
    infoDataStart = buf.readUInt16BE(offset);
    offset += 2;
  }
  const dataBeginIndex = buf.readUInt32BE(offset); offset += 4;
  const recordLength = buf.readUInt16BE(offset); offset += 2;
  const numLoggerFields = buf.readUInt16BE(offset); offset += 2;

  const flen = fieldLength(version);
  const fields = [];
  for (let i = 0; i < numLoggerFields; i++) {
    const base = offset + i * flen;
    if (base + flen > buf.length) break;
    const type = buf.readUInt8(base);
    const name = readCString(buf, base + 1, FIELD_NAME_LENGTH);
    const units = readCString(buf, base + 35, FIELD_UNITS_LENGTH);
    const displayStyle = buf.readUInt8(base + 45);
    let scale = 1;
    let transform = 0;
    let digits = 0;
    let bitInfo = null;
    if (type >= 10 && type <= 12) {
      bitInfo = {
        style: buf.readUInt8(base + 46),
        namesIndex: buf.readUInt32BE(base + 47),
        count: buf.readUInt8(base + 51)
      };
    } else {
      scale = buf.readFloatBE(base + 46);
      transform = buf.readFloatBE(base + 50);
      digits = buf.readInt8(base + 54);
    }
    fields.push({ type, name, units, displayStyle, scale, transform, digits, bitInfo });
  }
  offset += numLoggerFields * flen;

  const bitFieldNames = infoDataStart > offset
    ? readCString(buf, offset, infoDataStart - offset)
    : '';
  const info = infoDataStart > 0 && dataBeginIndex > infoDataStart
    ? readCString(buf, infoDataStart, dataBeginIndex - 1 - infoDataStart)
    : '';

  const namedFields = fields.filter(f => f.name);
  const channels = ['Time', ...namedFields.map(f => f.name)];
  const units = ['s', ...namedFields.map(f => f.units)];

  const rows = [];
  const markers = [];
  let off = dataBeginIndex > 0 ? dataBeginIndex : offset;
  let tickAccum = 0;
  let lastTick = 0;
  let firstTotal = null;
  let haveTick = false;

  while (off < buf.length) {
    if (off + 4 > buf.length) break; // partial trailing block
    const blockType = buf.readUInt8(off); off += 1;
    const counter = buf.readUInt8(off); off += 1;
    const tick = buf.readUInt16BE(off); off += 2;

    if (blockType === 0) {
      const row = {};
      let size = null;
      for (const f of fields) {
        const decoded = decodeValue(buf, off, f.type);
        if (!decoded) { size = null; break; }
        size = decoded.size;
        off += decoded.size;
        if (f.name) row[f.name] = (decoded.value + f.transform) * f.scale;
      }
      if (size === null) break; // unknown field type; stop safely
      off += 1; // crc

      if (haveTick && tick < lastTick && (lastTick - tick) > 32768) tickAccum += 65536;
      lastTick = tick;
      const total = tickAccum + tick;
      if (firstTotal === null) firstTotal = total;
      row['Time'] = Math.round((total - firstTotal) * TICK_SECONDS * 1000) / 1000;
      haveTick = true;
      rows.push(row);
    } else if (blockType === 1) {
      const message = readCString(buf, off, MARKER_MESSAGE_LENGTH);
      off += MARKER_MESSAGE_LENGTH;
      markers.push({ tick, message });
    } else {
      break; // unknown block type: stop parsing rather than misread the stream
    }
  }

  return {
    channels,
    units,
    rows,
    fields,
    info,
    bitFieldNames,
    markers,
    formatVersion: version,
    timestamp,
    recordLength
  };
}

module.exports = { parseMlg, isMlgBuffer };
