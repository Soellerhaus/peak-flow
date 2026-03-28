const https = require('https');

const SUPABASE_URL = 'https://wbrvkweezbeakfphssxp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndicnZrd2VlemJlYWtmcGhzc3hwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDA4OTg2MSwiZXhwIjoyMDg5NjY1ODYxfQ.rIP9qn1gsgAYg9BJE7VJFBbYm0-YBXABiHhUkOChSDc';

// Categories to import
const CATEGORIES = [
  {
    name: 'Aussichtspunkt',
    icon: '👁️',
    query: 'node["tourism"="viewpoint"]',
    category: 'viewpoint'
  },
  {
    name: 'Wasserfall',
    icon: '🌊',
    query: 'node["waterway"="waterfall"];node["natural"="waterfall"]',
    category: 'waterfall'
  },
  {
    name: 'Burg/Schloss',
    icon: '🏰',
    query: 'node["historic"="castle"];way["historic"="castle"];node["historic"="ruins"];way["historic"="ruins"]',
    category: 'castle'
  },
  {
    name: 'Kapelle/Kirche',
    icon: '⛪',
    query: 'node["amenity"="place_of_worship"];way["amenity"="place_of_worship"]',
    category: 'church'
  },
  {
    name: 'Denkmal/Monument',
    icon: '🗿',
    query: 'node["historic"="monument"];node["historic"="memorial"];node["historic"="wayside_cross"]',
    category: 'monument'
  },
  {
    name: 'Museum',
    icon: '🏛️',
    query: 'node["tourism"="museum"];way["tourism"="museum"]',
    category: 'museum'
  },
  {
    name: 'Bergsee',
    icon: '💧',
    query: 'node["natural"="lake"]["name"];way["natural"="water"]["name"]',
    category: 'lake'
  },
  {
    name: 'Höhle',
    icon: '🕳️',
    query: 'node["natural"="cave_entrance"]',
    category: 'cave'
  },
  {
    name: 'Alm/Jausenstation',
    icon: '🧀',
    query: 'node["amenity"="restaurant"]["cuisine"~"regional|bavarian|tyrolean"];node["tourism"="alpine_hut"]["amenity"="restaurant"]',
    category: 'alm'
  },
  {
    name: 'Klamm/Schlucht',
    icon: '🏞️',
    query: 'node["natural"="gorge"];way["natural"="gorge"];node["natural"="cliff"]["name"]',
    category: 'gorge'
  }
];

// Grid cells - Alps in 1° chunks (fewer cells, POIs are nodes so faster than ways)
function generateGrid(minLat, maxLat, minLng, maxLng, step) {
  const cells = [];
  for (let lat = minLat; lat < maxLat; lat += step) {
    for (let lng = minLng; lng < maxLng; lng += step) {
      cells.push({
        minLat: lat, maxLat: Math.min(lat + step, maxLat),
        minLng: lng, maxLng: Math.min(lng + step, maxLng)
      });
    }
  }
  return cells;
}

const CELLS = generateGrid(44.0, 48.5, 5.5, 16.0, 1.0);
let totalInserted = 0;

function fetchOverpass(query) {
  return new Promise((resolve, reject) => {
    const postData = 'data=' + encodeURIComponent(query);
    const req = https.request('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 120000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 429 || res.statusCode === 504) {
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
    const req = https.request(SUPABASE_URL + '/rest/v1/pois_sightseeing', {
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

async function importCategory(cat) {
  console.log(`\n🔍 ${cat.icon} ${cat.name} importieren...`);
  let catTotal = 0;

  for (let ci = 0; ci < CELLS.length; ci++) {
    const cell = CELLS[ci];
    const bbox = `${cell.minLat},${cell.minLng},${cell.maxLat},${cell.maxLng}`;

    // Build query with all sub-queries for this category
    const queryParts = cat.query.split(';').map(q => q + `(${bbox})`).join(';\n');
    const query = `[out:json][timeout:60][bbox:${bbox}];\n(\n${queryParts};\n);\nout center;`;

    try {
      const data = await fetchOverpass(query);
      if (!data.elements || data.elements.length === 0) continue;

      const rows = [];
      const seen = new Set();

      for (const el of data.elements) {
        const lat = el.lat || el.center?.lat;
        const lng = el.lon || el.center?.lon;
        if (!lat || !lng) continue;

        const key = el.id || `${lat}_${lng}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const name = el.tags?.name || el.tags?.description || null;

        rows.push({
          osm_id: el.id,
          name: name,
          category: cat.category,
          subcategory: el.tags?.historic || el.tags?.tourism || el.tags?.natural || el.tags?.amenity || null,
          lat: lat,
          lng: lng,
          tags: JSON.stringify({
            ele: el.tags?.ele || null,
            wikipedia: el.tags?.wikipedia || null,
            website: el.tags?.website || null,
            description: el.tags?.description || null,
            opening_hours: el.tags?.opening_hours || null,
            image: el.tags?.image || null
          })
        });
      }

      if (rows.length > 0) {
        for (let i = 0; i < rows.length; i += 200) {
          await supabasePost(rows.slice(i, i + 200));
        }
        catTotal += rows.length;
        totalInserted += rows.length;
      }
    } catch(e) {
      if (e.message === 'RATE_LIMIT') {
        console.log(`  ⏳ Rate limit at cell ${ci+1}/${CELLS.length}, waiting 30s...`);
        await new Promise(r => setTimeout(r, 30000));
        ci--; // Retry same cell
        continue;
      }
      console.log(`  ❌ Cell ${ci+1}: ${e.message}`);
    }

    // Pause between cells
    await new Promise(r => setTimeout(r, 1500));
  }

  console.log(`  ${cat.icon} ${cat.name}: ${catTotal} Einträge`);
  return catTotal;
}

async function main() {
  console.log('=== Sehenswürdigkeiten Import - Alpenraum ===');
  console.log(`${CATEGORIES.length} Kategorien × ${CELLS.length} Zellen\n`);

  // Wait for SAC import to free up Overpass
  console.log('⏳ Warte 10s damit SAC-Import Overpass nicht blockiert...\n');
  await new Promise(r => setTimeout(r, 10000));

  const results = {};
  for (const cat of CATEGORIES) {
    results[cat.name] = await importCategory(cat);
    // Longer pause between categories
    await new Promise(r => setTimeout(r, 5000));
  }

  console.log('\n=== FERTIG ===');
  console.log('Ergebnis:');
  for (const [name, count] of Object.entries(results)) {
    console.log(`  ${name}: ${count}`);
  }
  console.log(`\nTotal: ${totalInserted} Sehenswürdigkeiten in Supabase`);
}

main().catch(console.error);
