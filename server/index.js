/**
 * Log2Dyno - Local Server & API
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { parseLog, parseLogBuffer } = require('./parser');
const { calculateDyno, DYNO_FACTORS } = require('./dynoMath');
const carCatalog = require('./carCatalog');

const PORT = parseInt(process.env.PORT, 10) || 3300;
const DEFAULT_CARS_FILE = path.join(__dirname, '..', 'data', 'cars.json');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 100 * 1024 * 1024) { // 100MB max
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        resolve(body);
      }
    });
    req.on('error', reject);
  });
}

/**
 * Build the HTTP server.
 * @param {{carsFile?: string, catalogDir?: string}} [config]
 *   carsFile   - path to the writable user garage (defaults to CARS_FILE env)
 *   catalogDir - directory of read-only bundled catalog JSON files
 */
function createServer(config = {}) {
  const carsFile = config.carsFile || process.env.CARS_FILE || DEFAULT_CARS_FILE;
  const catalogDir = config.catalogDir || process.env.CARS_CATALOG_DIR || undefined;
  const carOptions = { catalogDir, garageFile: carsFile };

  function listCars() {
    const { cars, garageError } = carCatalog.getCars(carOptions);
    if (garageError) console.warn('[cars] garage ignored (catalog served):', garageError);
    return cars;
  }

  const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // CORS headers
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      return res.end();
    }

    // --- API Endpoints ---

    // 1. Parse uploaded or pasted log content
    if (pathname === '/api/parse-log' && req.method === 'POST') {
      try {
        const data = await parseBody(req);
        const content = typeof data === 'object' ? data.content : data;
        const filename = (typeof data === 'object' && data.filename) || 'uploaded_log.csv';
        const options = (typeof data === 'object' && data.options) || {};
        const encoding = typeof data === 'object' ? data.encoding : null;
        let parsed;
        if (encoding === 'base64') {
          const buffer = Buffer.from(content, 'base64');
          parsed = parseLogBuffer(buffer, filename, options);
        } else {
          parsed = parseLog(content, filename, options);
        }
        return sendJson(res, 200, parsed);
      } catch (err) {
        return sendJson(res, 500, { error: 'Parse failure: ' + err.message });
      }
    }

    // 2. Extract arbitrary numeric channel series (custom graph field)
    if (pathname === '/api/channel-series' && req.method === 'POST') {
      try {
        const data = await parseBody(req);
        const content = typeof data === 'object' ? data.content : null;
        const filename = (typeof data === 'object' && data.filename) || 'uploaded_log.csv';
        const baseOptions = (typeof data === 'object' && data.options) || {};
        const encoding = typeof data === 'object' ? data.encoding : null;
        const requested = (typeof data === 'object' && Array.isArray(data.channels)) ? data.channels : [];
        if (!content || requested.length === 0) {
          return sendJson(res, 400, { error: 'Missing content or channels' });
        }
        const options = { ...baseOptions, series: requested };
        let parsed;
        if (encoding === 'base64') {
          parsed = parseLogBuffer(Buffer.from(content, 'base64'), filename, options);
        } else {
          parsed = parseLog(content, filename, options);
        }
        if (parsed.error) return sendJson(res, 200, { error: parsed.error });
        const series = parsed.series || {};
        const available = Object.keys(series).filter(k => series[k].some(v => v !== null));
        const missing = requested.filter(name => !available.includes(name));
        return sendJson(res, 200, {
          series,
          missing,
          numericChannels: parsed.numericChannels || [],
          totalRows: parsed.totalRows
        });
      } catch (err) {
        return sendJson(res, 500, { error: 'Channel series failure: ' + err.message });
      }
    }

    // 3. Supported log formats / type hints for the UI selector
    if (pathname === '/api/formats' && req.method === 'GET') {
      return sendJson(res, 200, [
        { id: 'auto', label: 'Auto-detect' },
        { id: 'haltech', label: 'Haltech (NSP / Nexus)' },
        { id: 'megasquirt', label: 'MegaSquirt / TunerStudio' },
        { id: 'generic', label: 'Generic CSV' }
      ]);
    }

    // 4. Calculate Dyno Curve
    if (pathname === '/api/calculate-dyno' && req.method === 'POST') {
      try {
        const { pullData, carProfile, rpmStep, customName } = await parseBody(req);
        if (!pullData || !carProfile) {
          return sendJson(res, 400, { error: 'Missing pullData or carProfile' });
        }
        const manualRpmStep = [5,10,25].includes(Number(rpmStep)) ? Number(rpmStep) : null;
        const dynoResult = calculateDyno(pullData, carProfile, manualRpmStep, customName || null);
        return sendJson(res, 200, dynoResult);
      } catch (err) {
        return sendJson(res, 500, { error: 'Dyno calculation failure: ' + err.message });
      }
    }

    // 5. Get vehicle list (read-only catalog + user garage)
    if (pathname === '/api/cars' && req.method === 'GET') {
      try {
        return sendJson(res, 200, listCars());
      } catch (err) {
        return sendJson(res, 500, { error: 'Failed to load vehicles: ' + err.message });
      }
    }

    // 6. Save or update a user vehicle profile (garage only)
    if (pathname === '/api/save-car' && req.method === 'POST') {
      try {
        const car = await parseBody(req);
        const { car: saved, cloned } = carCatalog.upsertGarageCar(car, carOptions);
        return sendJson(res, 200, {
          success: true,
          cloned,
          currentCar: saved,
          cars: listCars()
        });
      } catch (err) {
        const status = err.code === 'INVALID_CAR' ? 400 : 500;
        return sendJson(res, status, { error: err.message, validation: err.validation || null });
      }
    }

    // 7. Delete a user vehicle profile (built-in catalog profiles are protected)
    if (pathname === '/api/delete-car' && req.method === 'POST') {
      try {
        const { id } = await parseBody(req);
        carCatalog.removeGarageCar(id, carOptions);
        return sendJson(res, 200, { success: true, cars: listCars() });
      } catch (err) {
        const status = (err.code === 'INVALID_CAR' || err.code === 'CATALOG_IMMUTABLE') ? 400 : 500;
        return sendJson(res, status, { error: err.message });
      }
    }

    // --- Static Files Server ---
    let filePath = path.join(__dirname, '../public', pathname === '/' ? 'index.html' : pathname);

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(__dirname, '../public', 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    try {
      const data = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    } catch (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  });

  return server;
}

if (require.main === module) {
  const { errors, warnings } = carCatalog.getCatalogDiagnostics();
  for (const e of errors) console.error('[catalog] ' + e);
  if (warnings.length) {
    console.warn(`[catalog] ${warnings.length} validation warning(s); run "npm run validate-cars" for details.`);
  }

  createServer().listen(PORT, '0.0.0.0', () => {
    console.log(`Log2Dyno server running at http://localhost:${PORT}`);
  });
}

module.exports = { createServer, DEFAULT_CARS_FILE };
