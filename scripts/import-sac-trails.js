const https = require('https');

const SUPABASE_URL = 'https://wbrvkweezbeakfphssxp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndicnZrd2VlemJlYWtmcGhzc3hwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDA4OTg2MSwiZXhwIjoyMDg5NjY1ODYxfQ.rIP9qn1gsgAYg9BJE7VJFBbYm0-YBXABiHhUkOChSDc';

// Small grid cells (0.5° x 0.5°) to avoid Overpass timeouts
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

// Alps: 44°-48.5°N, 5.5°-16°E in 0.5° grid = ~168 cells
const CELLS = generateGrid(44.0, 48.5, 5.5, 16.0, 0.5);

let totalInserted = 0;
let totalCells = CELLS.length;
let failedCells = [];

function fetchOverpass(query) {
  return new Promise((resolve, reject) => {
    const postData = 'data=' + encodeURIComponent(query);
    const req = https.request('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 90000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 429 || res.statusCode === 504) {
          reject(new Error('RATE_LIMIT_' + res.statusCode));
        } else if (res.statusCode >= 400) {
          reject(new Error('HTTP_' + res.statusCode));
        } else {
          try { resolve(JSON.parse(data)); }
          catch(e) { reject(new Error('JSON_PARSE_ERROR')); }
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('TIMEOUT')); });
    req.write(postData);
    req.end();
  });
}

function supabasePost(trails) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(trails);
    const req = https.request(SUPABASE_URL + '/rest/v1/sac_trails', {
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
        if (res.statusCode >= 400) reject(new Error('Supabase ' + res.statusCode + ': ' + data.substring(0, 100)));
        else resolve();
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function processCell(cell, index) {
  const query = `[out:json][timeout:60][bbox:${cell.minLat},${cell.minLng},${cell.maxLat},${cell.maxLng}];
way["sac_scale"]["highway"~"path|footway|track"];
out body geom;`;

  try {
    const data = await fetchOverpass(query);
    if (!data.elements || data.elements.length === 0) {
      console.log(`  [${index+1}/${totalCells}] ${cell.name}: 0 trails`);
      return 0;
    }

    const trails = [];
    for (const el of data.elements) {
      if (!el.geometry || el.geometry.length < 2) continue;
      const coords = el.geometry.map(n => [n.lon, n.lat]);
      const allLats = coords.map(c => c[1]);
      const allLngs = coords.map(c => c[0]);

      trails.push({
        osm_id: el.id,
        name: el.tags?.name || null,
        sac_scale: el.tags?.sac_scale || 'unknown',
        highway: el.tags?.highway || 'path',
        geometry: JSON.stringify(coords),
        bbox_min_lat: Math.min(...allLats),
        bbox_min_lng: Math.min(...allLngs),
        bbox_max_lat: Math.max(...allLats),
        bbox_max_lng: Math.max(...allLngs),
      });
    }

    // Insert in batches of 200
    for (let i = 0; i < trails.length; i += 200) {
      await supabasePost(trails.slice(i, i + 200));
    }

    totalInserted += trails.length;
    console.log(`  ✅ [${index+1}/${totalCells}] ${cell.name}: ${trails.length} trails (total: ${totalInserted})`);
    return trails.length;
  } catch(e) {
    console.log(`  ❌ [${index+1}/${totalCells}] ${cell.name}: ${e.message}`);
    return -1;
  }
}

async function main() {
  console.log('=== SAC Trail Import - Alpen T1-T6 ===');
  console.log(`${totalCells} Grid-Zellen (0.5° x 0.5°)\n`);

  for (let i = 0; i < CELLS.length; i++) {
    const result = await processCell(CELLS[i], i);

    if (result === -1) {
      failedCells.push(CELLS[i]);
      // Wait longer on rate limit
      console.log('  Waiting 30s (rate limit)...');
      await new Promise(r => setTimeout(r, 30000));
    } else {
      // Normal delay between requests
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // Retry failed cells
  if (failedCells.length > 0) {
    console.log(`\n=== RETRY ${failedCells.length} failed cells ===\n`);
    const retryList = [...failedCells];
    failedCells = [];
    for (let i = 0; i < retryList.length; i++) {
      await new Promise(r => setTimeout(r, 10000));
      const result = await processCell(retryList[i], i);
      if (result === -1) failedCells.push(retryList[i]);
    }
  }

  console.log(`\n=== FERTIG ===`);
  console.log(`Total: ${totalInserted} SAC trails in Supabase`);
  if (failedCells.length > 0) {
    console.log(`Failed cells: ${failedCells.map(c => c.name).join(', ')}`);
  }
}

main().catch(console.error);
