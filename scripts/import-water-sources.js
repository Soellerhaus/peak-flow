/**
 * Import water sources (springs, drinking water, fountains) for the entire Alps
 * from OpenStreetMap via Overpass API into Supabase.
 *
 * Grid: 44°-48.5°N, 5.5°-16.5°E in 0.5° cells
 * Skips cells that already have data in Supabase.
 *
 * Usage: nohup node import-water-sources.js > water-import.log 2>&1 &
 */

const https = require('https');

const SUPABASE_URL = 'https://wbrvkweezbeakfphssxp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndicnZrd2VlemJlYWtmcGhzc3hwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDA4OTg2MSwiZXhwIjoyMDg5NjY1ODYxfQ.rIP9qn1gsgAYg9BJE7VJFBbYm0-YBXABiHhUkOChSDc';

const OVERPASS_SERVERS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
];
let srvIdx = 0;

function generateGrid(minLat, maxLat, minLng, maxLng, step) {
  const cells = [];
  for (let lat = minLat; lat < maxLat; lat += step) {
    for (let lng = minLng; lng < maxLng; lng += step) {
      cells.push({
        name: `${lat.toFixed(1)}_${lng.toFixed(1)}`,
        minLat: lat, maxLat: Math.min(lat + step, maxLat),
        minLng: lng, maxLng: Math.min(lng + step, maxLng)
      });
    }
  }
  return cells;
}

// Full Alps + surrounding valleys: 44°-49°N, 5°-17°E
const CELLS = generateGrid(44.0, 49.0, 5.0, 17.0, 0.5);
let totalInserted = 0;
let failedCells = [];

function fetchOverpass(query) {
  return new Promise((resolve, reject) => {
    const server = OVERPASS_SERVERS[srvIdx % OVERPASS_SERVERS.length];
    const url = new URL(server);
    const postData = 'data=' + encodeURIComponent(query);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 60000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 429 || res.statusCode === 504 || res.statusCode === 503) {
          srvIdx++;
          reject(new Error('RATE_LIMIT'));
        } else if (res.statusCode >= 400) {
          reject(new Error('HTTP_' + res.statusCode));
        } else {
          try { resolve(JSON.parse(data)); }
          catch(e) { reject(new Error('JSON_PARSE')); }
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('TIMEOUT')); });
    req.write(postData);
    req.end();
  });
}

function supabasePost(rows) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(rows);
    const req = https.request(SUPABASE_URL + '/rest/v1/water_sources', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Prefer': 'resolution=ignore-duplicates',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 400) reject(new Error('Supabase ' + res.statusCode + ': ' + data.substring(0, 200)));
        else resolve();
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function supabaseCount(cell) {
  return new Promise((resolve, reject) => {
    const path = `/rest/v1/water_sources?lat=gte.${cell.minLat}&lat=lt.${cell.maxLat}&lng=gte.${cell.minLng}&lng=lt.${cell.maxLng}&select=id&limit=1`;
    const req = https.request({
      hostname: 'wbrvkweezbeakfphssxp.supabase.co',
      path: path,
      method: 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Prefer': 'count=exact'
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const range = res.headers['content-range'];
        const count = range ? parseInt(range.split('/')[1]) : 0;
        resolve(count);
      });
    });
    req.on('error', () => resolve(0));
    req.end();
  });
}

async function processCell(cell, index) {
  // Skip if this cell already has data
  const existing = await supabaseCount(cell);
  if (existing > 0) {
    console.log(`  ⏭ [${index+1}/${CELLS.length}] ${cell.name}: already has ${existing} sources`);
    return 0;
  }

  const query = `[out:json][timeout:30][bbox:${cell.minLat},${cell.minLng},${cell.maxLat},${cell.maxLng}];
(
  node["amenity"="drinking_water"];
  node["natural"="spring"];
  node["man_made"="water_well"];
  node["amenity"="fountain"]["drinking_water"="yes"];
  node["amenity"="water_point"];
);
out body;`;

  try {
    const data = await fetchOverpass(query);
    if (!data.elements || data.elements.length === 0) {
      console.log(`  [${index+1}/${CELLS.length}] ${cell.name}: 0 sources`);
      return 0;
    }

    const sources = [];
    const seen = new Set();
    for (const el of data.elements) {
      if (!el.lat || !el.lon) continue;
      const key = `${el.lat.toFixed(5)},${el.lon.toFixed(5)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      let type = 'drinking_water';
      if (el.tags?.natural === 'spring') type = 'spring';
      else if (el.tags?.man_made === 'water_well') type = 'water_well';
      else if (el.tags?.amenity === 'fountain') type = 'fountain';

      sources.push({
        osm_id: el.id,
        name: el.tags?.name || null,
        type: type,
        lat: el.lat,
        lng: el.lon
      });
    }

    if (sources.length === 0) return 0;

    // Insert in batches of 200
    for (let i = 0; i < sources.length; i += 200) {
      await supabasePost(sources.slice(i, i + 200));
    }

    totalInserted += sources.length;
    console.log(`  ✅ [${index+1}/${CELLS.length}] ${cell.name}: ${sources.length} sources (total: ${totalInserted})`);
    return sources.length;
  } catch(e) {
    console.log(`  ❌ [${index+1}/${CELLS.length}] ${cell.name}: ${e.message}`);
    return -1;
  }
}

async function main() {
  console.log('=== Water Sources Import - Gesamte Alpen ===');
  console.log(`${CELLS.length} Grid-Zellen (0.5° x 0.5°)`);
  console.log(`Started: ${new Date().toISOString()}\n`);

  for (let i = 0; i < CELLS.length; i++) {
    const result = await processCell(CELLS[i], i);
    if (result === -1) {
      failedCells.push(CELLS[i]);
      console.log('  Waiting 30s (rate limit)...');
      await new Promise(r => setTimeout(r, 30000));
    } else {
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  // Retry failed cells
  if (failedCells.length > 0) {
    console.log(`\n=== RETRY ${failedCells.length} failed cells ===\n`);
    const retryList = [...failedCells];
    failedCells = [];
    for (let i = 0; i < retryList.length; i++) {
      await new Promise(r => setTimeout(r, 15000));
      const result = await processCell(retryList[i], i);
      if (result === -1) failedCells.push(retryList[i]);
    }
  }

  console.log('\n============================');
  console.log(`Finished: ${new Date().toISOString()}`);
  console.log(`Total inserted: ${totalInserted}`);
  if (failedCells.length > 0) console.log(`Failed cells: ${failedCells.map(c => c.name).join(', ')}`);
}

main().catch(console.error);
