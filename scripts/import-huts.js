#!/usr/bin/env node
/**
 * Import all alpine huts (alpine_hut, wilderness_hut, shelter) in the Alpine region into Supabase
 * Uses Overpass API, caches locally to avoid re-fetching on retry
 */

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://wbrvkweezbeakfphssxp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndicnZrd2VlemJlYWtmcGhzc3hwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDA4OTg2MSwiZXhwIjoyMDg5NjY1ODYxfQ.rIP9qn1gsgAYg9BJE7VJFBbYm0-YBXABiHhUkOChSDc';

const BBOX = '44.0,5.5,48.5,17.0';
const CACHE_FILE = path.join(__dirname, 'huts-cache.json');

async function fetchHuts() {
  if (fs.existsSync(CACHE_FILE)) {
    console.log('Loading huts from cache...');
    const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    console.log(`Got ${data.length} huts from cache`);
    return data;
  }

  console.log('Fetching huts from Overpass API...');

  const query = `
    [out:json][timeout:180];
    (
      node["tourism"~"alpine_hut|wilderness_hut"](${BBOX});
      node["amenity"="shelter"](${BBOX});
      way["tourism"~"alpine_hut|wilderness_hut"](${BBOX});
    );
    out body center;
  `;

  const servers = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.openstreetmap.fr/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
  ];

  for (const server of servers) {
    console.log(`Trying ${server}...`);
    try {
      const resp = await fetch(server, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      if (resp.ok) {
        const json = JSON.parse(await resp.text());
        if (json.elements && json.elements.length > 0) {
          console.log(`  Got ${json.elements.length} elements`);
          fs.writeFileSync(CACHE_FILE, JSON.stringify(json.elements));
          console.log(`Cached to ${CACHE_FILE}`);
          return json.elements;
        }
        console.log(`  ${server} returned OK but 0 elements, trying next...`);
      } else {
        console.log(`  ${server} returned ${resp.status}, trying next...`);
      }
    } catch(e) {
      console.log(`  ${server} failed: ${e.message}, trying next...`);
    }
  }
  throw new Error('All Overpass servers failed');
}

async function importToSupabase(elements) {
  const rows = elements
    .filter(e => e.tags && e.tags.name)
    .map(e => ({
      osm_id: e.id,
      name: e.tags.name,
      name_de: e.tags['name:de'] || null,
      type: e.tags.tourism || (e.tags.amenity === 'shelter' ? 'shelter' : 'alpine_hut'),
      lat: e.lat || e.center?.lat,
      lng: e.lon || e.center?.lon,
      elevation: e.tags.ele ? parseInt(e.tags.ele) : null,
      beds: e.tags.beds ? parseInt(e.tags.beds) : (e.tags.capacity ? parseInt(e.tags.capacity) : null),
      website: e.tags.website || e.tags['contact:website'] || null,
      phone: e.tags.phone || e.tags['contact:phone'] || null,
      operator: e.tags.operator || null
    }))
    .filter(r => r.lat && r.lng);

  console.log(`${rows.length} huts with names to import`);

  const batchSize = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/huts`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify(batch)
    });

    if (!resp.ok) {
      const err = await resp.text();
      if (err.includes('PGRST205') || err.includes('does not exist')) {
        console.error('\n*** Table "huts" does not exist! Create it first in Supabase SQL Editor. ***\n');
        return;
      }
      console.error(`Batch ${i}-${i+batchSize} failed:`, err);
      continue;
    }

    inserted += batch.length;
    if (inserted % 1000 === 0 || i + batchSize >= rows.length) {
      console.log(`Imported ${inserted}/${rows.length} huts`);
    }
  }
  console.log(`\nDone! ${inserted} huts imported.`);
}

async function main() {
  try {
    const elements = await fetchHuts();
    await importToSupabase(elements);
  } catch (e) {
    console.error('Error:', e.message);
  }
}

main();
