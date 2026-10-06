/**
 * units.js - Unit parsing and conversion helpers.
 *
 * Conventions:
 *  - Pressure API returns PSI.
 *  - Temperature API returns Fahrenheit.
 *  - Speed API returns MPH.
 *  - Conversions return null when the unit is unknown, so callers can decide
 *    whether to apply a family default or warn. We never guess from magnitude.
 */

'use strict';

const KPA_TO_PSI = 0.1450377;
const PSI_TO_KPA = 6.894757;
const BAR_TO_PSI = 14.5037738;
const KPH_TO_MPH = 0.621371;
const MPS_TO_MPH = 2.23694;
const AFR_STOICH = 14.7;

function normUnit(raw) {
  return String(raw == null ? '' : raw)
    .toLowerCase()
    .replace(/°/g, 'deg')
    .replace(/\(.*?\)/g, '')
    .replace(/\s+/g, '');
}

function isKnownPressureUnit(unit) {
  const u = normUnit(unit);
  return u.includes('kpa') || u.includes('psi') || u.includes('bar');
}

function pressureToPsi(value, unit) {
  if (value == null || isNaN(value)) return null;
  const u = normUnit(unit);
  if (!u) return null;
  if (u.includes('kpa')) return value * KPA_TO_PSI;
  if (u.includes('psi')) return value;
  if (u.includes('bar')) return value * BAR_TO_PSI;
  return null;
}

function temperatureToF(value, unit) {
  if (value == null || isNaN(value)) return null;
  const u = normUnit(unit);
  if (!u) return null;
  if (u.includes('degf') || u === 'f' || u.includes('fahrenheit')) return value;
  if (u.includes('degc') || u === 'c' || u.includes('celsius')) return value * 1.8 + 32;
  if (u === 'k' || u.includes('kelvin')) return (value - 273.15) * 1.8 + 32;
  return null;
}

function speedToMph(value, unit) {
  if (value == null || isNaN(value)) return null;
  const u = normUnit(unit);
  if (!u) return null;
  if (u.includes('mph')) return value;
  if (u.includes('km/h') || u.includes('kmh') || u.includes('kph')) return value * KPH_TO_MPH;
  if (u.includes('m/s') || u.includes('mps')) return value * MPS_TO_MPH;
  return null;
}

/**
 * Convert a fuel-ratio channel value to lambda.
 * Only treats the value as AFR when explicitly known (name/unit), never by
 * magnitude.
 */
function fuelRatioToLambda(value, isAfr) {
  if (value == null || isNaN(value)) return null;
  return isAfr ? value / AFR_STOICH : value;
}

module.exports = {
  KPA_TO_PSI,
  PSI_TO_KPA,
  BAR_TO_PSI,
  KPH_TO_MPH,
  MPS_TO_MPH,
  AFR_STOICH,
  normUnit,
  isKnownPressureUnit,
  pressureToPsi,
  temperatureToF,
  speedToMph,
  fuelRatioToLambda
};
