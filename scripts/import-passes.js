#!/usr/bin/env node
/**
 * Import all mountain passes/saddles in the Alpine region into Supabase
 * Uses Overpass API, caches locally to avoid re-fetching on retry
 */

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://wbrvkweezbeakfphssxp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndicnZrd2VlemJlYWtmcGhzc3hwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDA4OTg2MSwiZXhwIjoyMDg5NjY1ODYxfQ.rIP9qn1gsgAYg9BJE7VJFBbYm0-YBXABiHhUkOChSDc';

const BBOX = '44.0,5.5,48.5,17.0';
const CACHE_FILE = path.join(__dirname, 'passes-cache.json');

async function fetchPasses() {
  if (fs.existsSync(CACHE_FILE)) {
    console.log('Loading passes from cache...');
    const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    console.log(`Got ${data.length} passes from cache`);
    return data;
  }

  console.log('Fetching passes from Overpass API...');

  const query = `
    [out:json][timeout:180];
    (
      node["natural"="saddle"]["name"](${BBOX});
      node["mountain_pass"="yes"]["name"](${BBOX});
    );
    out body;
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
  // Deduplicate by osm_id (saddle + mountain_pass can overlap)
  const seen = new Set();
  const rows = elements
    .filter(e => {
      if (!e.tags || !e.tags.name) return false;
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    })
    .map(e => ({
      osm_id: e.id,
      name: e.tags.name,
      name_de: e.tags['name:de'] || null,
      lat: e.lat,
      lng: e.lon,
      elevation: e.tags.ele ? parseInt(e.tags.ele) : null
    }));

  console.log(`${rows.length} passes with names to import`);

  const batchSize = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/passes`, {
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
        console.error('\n*** Table "passes" does not exist! Create it first in Supabase SQL Editor. ***\n');
        return;
      }
      console.error(`Batch ${i}-${i+batchSize} failed:`, err);
      continue;
    }

    inserted += batch.length;
    if (inserted % 1000 === 0 || i + batchSize >= rows.length) {
      console.log(`Imported ${inserted}/${rows.length} passes`);
    }
  }
  console.log(`\nDone! ${inserted} passes imported.`);
}

async function main() {
  try {
    const elements = await fetchPasses();
    await importToSupabase(elements);
  } catch (e) {
    console.error('Error:', e.message);
  }
}

main();
