#!/usr/bin/env node
/**
 * Import all places (cities, towns, villages, hamlets) in the Alpine region into Supabase
 * Uses Overpass API to get all populated places
 * Caches Overpass data locally to avoid re-fetching on retry
 */

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://wbrvkweezbeakfphssxp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndicnZrd2VlemJlYWtmcGhzc3hwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDA4OTg2MSwiZXhwIjoyMDg5NjY1ODYxfQ.rIP9qn1gsgAYg9BJE7VJFBbYm0-YBXABiHhUkOChSDc';

// Alpine region bounding box (same as peaks)
const BBOX = '44.0,5.5,48.5,17.0'; // south,west,north,east
const CACHE_FILE = path.join(__dirname, 'places-cache.json');

async function fetchPlaces() {
  // Check for cached data first
  if (fs.existsSync(CACHE_FILE)) {
    console.log('Loading places from cache...');
    const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    console.log(`Got ${data.length} places from cache`);
    return data;
  }

  console.log('Fetching places from Overpass API...');

  const query = `
    [out:json][timeout:180];
    (
      node["place"~"city|town|village|hamlet|suburb"](${BBOX});
    );
    out body;
  `;

  // Try multiple Overpass servers
  const servers = [
    'https://overpass.openstreetmap.fr/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
  ];
  let resp;
  for (const server of servers) {
    console.log(`Trying ${server}...`);
    try {
      resp = await fetch(server, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      if (resp.ok) {
        const text = await resp.text();
        const json = JSON.parse(text);
        if (json.elements && json.elements.length > 0) {
          console.log(`  Got ${json.elements.length} elements`);
          // Cache locally
          fs.writeFileSync(CACHE_FILE, JSON.stringify(json.elements));
          console.log(`Cached to ${CACHE_FILE}`);
          return json.elements;
        }
        console.log(`  ${server} returned OK but 0 elements, trying next...`);
        continue;
      }
      console.log(`  ${server} returned ${resp.status}, trying next...`);
    } catch(e) {
      console.log(`  ${server} failed: ${e.message}, trying next...`);
    }
  }

  throw new Error('All Overpass servers failed or returned 0 results');
}

async function importToSupabase(places) {
  // Transform data
  const rows = places
    .filter(p => p.tags && p.tags.name)
    .map(p => ({
      osm_id: p.id,
      name: p.tags.name,
      name_de: p.tags['name:de'] || null,
      type: p.tags.place, // city, town, village, hamlet, suburb
      lat: p.lat,
      lng: p.lon,
      population: p.tags.population ? parseInt(p.tags.population) : null,
      country: p.tags['addr:country'] || null,
      region: p.tags['is_in:state'] || p.tags['is_in'] || null
    }));

  console.log(`${rows.length} places with names to import`);

  // Batch insert (1000 at a time)
  const batchSize = 1000;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/places`, {
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
      if (err.includes('relation') && err.includes('does not exist')) {
        console.error('\n*** Table "places" does not exist! ***');
        console.error('Run this SQL in Supabase Dashboard > SQL Editor:\n');
        console.error(`CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE places (
  id SERIAL PRIMARY KEY,
  osm_id BIGINT UNIQUE,
  name TEXT NOT NULL,
  name_de TEXT,
  type TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  population INTEGER,
  country TEXT,
  region TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_places_name ON places USING gin (name gin_trgm_ops);
CREATE INDEX idx_places_name_de ON places USING gin (name_de gin_trgm_ops);
CREATE INDEX idx_places_type ON places (type);
CREATE INDEX idx_places_lat_lng ON places (lat, lng);
ALTER TABLE places ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON places FOR SELECT USING (true);`);
        console.error('\nThen run this script again. Cached data will be used.');
        return;
      }
      // If table doesn't exist, stop immediately
      if (err.includes('PGRST205') || err.includes('does not exist')) {
        console.error('\n*** Table "places" does not exist! ***');
        console.error('Run this SQL in Supabase Dashboard > SQL Editor:\n');
        console.error(`CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE places (
  id SERIAL PRIMARY KEY,
  osm_id BIGINT UNIQUE,
  name TEXT NOT NULL,
  name_de TEXT,
  type TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  population INTEGER,
  country TEXT,
  region TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_places_name ON places USING gin (name gin_trgm_ops);
CREATE INDEX idx_places_name_de ON places USING gin (name_de gin_trgm_ops);
CREATE INDEX idx_places_type ON places (type);
CREATE INDEX idx_places_lat_lng ON places (lat, lng);
ALTER TABLE places ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON places FOR SELECT USING (true);`);
        console.error('\nThen run this script again. Cached data will be reused (no Overpass fetch needed).');
        return;
      }
      console.error(`Batch ${i}-${i+batchSize} failed:`, err);
      continue;
    }

    inserted += batch.length;
    if (inserted % 10000 === 0 || i + batchSize >= rows.length) {
      console.log(`Imported ${inserted}/${rows.length} places`);
    }
  }

  console.log(`\nDone! ${inserted} places imported.`);
}

async function main() {
  try {
    const places = await fetchPlaces();
    await importToSupabase(places);
  } catch (e) {
    console.error('Error:', e.message);
  }
}

main();
