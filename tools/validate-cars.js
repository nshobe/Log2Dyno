#!/usr/bin/env node
/**
 * validate-cars.js - validate the generated vehicle catalog and report gear gaps.
 *
 * Exit code is non-zero only when there are structural errors. Incomplete gear
 * sets are reported (they are expected until every transmission is researched).
 *
 * Usage: node tools/validate-cars.js [catalog-dir]
 */

'use strict';

const path = require('path');
const cc = require('../server/carCatalog');

const DEFAULT_DIR = path.join(__dirname, '..', 'server', 'data', 'cars');

function validateCatalog(dir = DEFAULT_DIR) {
  const result = cc.readCatalog({ dir, fresh: true });
  const incomplete = result.cars.filter(car => car.gearDataComplete === false);
  const incompleteByMake = {};
  for (const car of incomplete) {
    incompleteByMake[car.make] = (incompleteByMake[car.make] || 0) + 1;
  }
  return {
    dir: result.dir,
    total: result.cars.length,
    complete: result.cars.length - incomplete.length,
    incomplete: incomplete.length,
    incompleteIds: incomplete.map(car => car.id),
    incompleteByMake,
    missingGears: result.cars.filter(car => !car.gears || !Object.keys(car.gears).length).length,
    missingDefaultGear: result.cars.filter(car => car.defaultGear == null).length,
    errors: result.errors,
    warnings: result.warnings
  };
}

function formatReport(report) {
  const lines = [];
  lines.push(`Catalog: ${report.dir}`);
  lines.push(`  entries:              ${report.total}`);
  lines.push(`  complete gear sets:   ${report.complete}`);
  lines.push(`  incomplete gear sets: ${report.incomplete}`);
  lines.push(`  missing gear sets:    ${report.missingGears}`);
  lines.push(`  missing defaultGear:  ${report.missingDefaultGear}`);
  lines.push(`  errors:               ${report.errors.length}`);
  lines.push(`  warnings:             ${report.warnings.length}`);
  if (report.errors.length) {
    lines.push('  --- errors ---');
    for (const error of report.errors) lines.push(`    ${error}`);
  }
  const makes = Object.entries(report.incompleteByMake).sort((a, b) => b[1] - a[1]);
  if (makes.length) {
    lines.push('  incomplete gear sets by make:');
    for (const [make, count] of makes) lines.push(`    ${make}: ${count}`);
  }
  return lines.join('\n');
}

if (require.main === module) {
  const dir = process.argv[2] || DEFAULT_DIR;
  const report = validateCatalog(dir);
  console.log(formatReport(report));
  if (report.errors.length) process.exitCode = 1;
}

module.exports = { validateCatalog, formatReport };
