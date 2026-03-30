/**
 * Walser Trailchallenge Route Importer
 * Fügt Walser Trail + Widderstein Trail zu community_races hinzu
 * Aktualisiert Logo des bestehenden Ultra-Eintrags
 *
 * Usage: node scripts/import-walser-routes.js
 */

const fs = require('fs');
const https = require('https');

// ─── Config ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://gvzrgdyaosxqhozjuuph.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2enJnZHlhb3N4cWhvemp1dXBoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MzIwNDYsImV4cCI6MjA5MDEwODA0Nn0.lSES2gvImvv7Tsa2IVZ5ak_c9y-Weg-TVhcHdeLmyX0';
const USER_ID    = 'df16c677-72ff-40f1-b4f2-971a62c1c461';   // Claudio
const ULTRA_ID   = 'a33baba8-8a5f-4475-b489-afde86136e8f';   // Existing Ultra entry

const GPX_WALSER     = 'C:/Users/Administrator/Downloads/walser-trail.gpx';
const GPX_WIDDERSTEIN = 'C:/Users/Administrator/Downloads/t7523456_widderstein trail.gpx';

// Official round badge SVGs from trailchallenge.at
const LOGOS = {
  ultra:       'https://trailchallenge.at/wp-content/uploads/2024/02/walserultra.svg',
  walserTrail: 'https://trailchallenge.at/wp-content/uploads/2024/02/walsertrail.svg',
  widderstein: 'https://trailchallenge.at/wp-content/uploads/2024/02/widderstein.svg',
};

const WEBSITE = 'https://trailchallenge.at';

// ─── GPX Parser ──────────────────────────────────────────────────────────────
function parseGPX(xml) {
  // Extract all trkpt coordinates
  const coords = [];
  // Match trkpt with lat/lon in either order
  const trkptRe = /<trkpt\b[^>]*>/g;
  let m;
  while ((m = trkptRe.exec(xml)) !== null) {
    const tag = m[0];
    const latM = /\blat="([\-\d.]+)"/.exec(tag);
    const lonM = /\blon="([\-\d.]+)"/.exec(tag);
    if (!latM || !lonM) continue;
    const lat = parseFloat(latM[1]);
    const lon = parseFloat(lonM[1]);
    // Get elevation from <ele> after this trkpt
    const rest = xml.slice(m.index, m.index + 150);
    const eleM = /<ele[^>]*>(?:<!\[CDATA\[)?([\d.]+)(?:\]\]>)?<\/ele>/.exec(rest);
    const ele = eleM ? parseFloat(eleM[1]) : null;
    coords.push([lon, lat, ele]);
  }
  return coords;
}

// ─── Stats Calculator ─────────────────────────────────────────────────────────
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000; // metres
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function calcStats(coords) {
  let distance = 0, ascent = 0, descent = 0;
  for (let i = 1; i < coords.length; i++) {
    const [lon1, lat1, ele1] = coords[i-1];
    const [lon2, lat2, ele2] = coords[i];
    distance += haversine(lat1, lon1, lat2, lon2);
    if (ele1 != null && ele2 != null) {
      const diff = ele2 - ele1;
      if (diff > 0) ascent  += diff;
      else          descent -= diff;
    }
  }
  return {
    distance: Math.round(distance / 100) / 10,  // km, 1 decimal
    ascent:   Math.round(ascent),
    descent:  Math.round(descent),
  };
}

// ─── Supabase helpers ─────────────────────────────────────────────────────────
function supaFetch(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(SUPABASE_URL + path);
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method,
      headers: {
        'apikey':        SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Content-Type':  'application/json',
        'Prefer':        'return=representation',
      },
    };
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);
    const req = https.request(opts, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch(e) { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== Walser Trailchallenge Route Import ===\n');

  // 1. Parse GPX files
  console.log('📂 Parsing GPX files...');
  const gpxWalser      = fs.readFileSync(GPX_WALSER, 'utf8');
  const gpxWidderstein = fs.readFileSync(GPX_WIDDERSTEIN, 'utf8');

  const coordsWalser      = parseGPX(gpxWalser);
  const coordsWidderstein = parseGPX(gpxWidderstein);
  console.log(`   Walser Trail:     ${coordsWalser.length} Punkte`);
  console.log(`   Widderstein Trail: ${coordsWidderstein.length} Punkte`);

  // 2. Calculate stats
  const statsWalser      = calcStats(coordsWalser);
  const statsWidderstein = calcStats(coordsWidderstein);
  console.log(`   Walser Trail:     ${statsWalser.distance}km, ↑${statsWalser.ascent}m, ↓${statsWalser.descent}m`);
  console.log(`   Widderstein Trail: ${statsWidderstein.distance}km, ↑${statsWidderstein.ascent}m, ↓${statsWidderstein.descent}m`);

  // Subsample coordinates for DB storage (keep every Nth point to save space)
  function subsample(coords, maxPoints = 2000) {
    if (coords.length <= maxPoints) return coords;
    const step = Math.ceil(coords.length / maxPoints);
    return coords.filter((_, i) => i % step === 0 || i === coords.length - 1);
  }
  const coordsWalserSub      = subsample(coordsWalser);
  const coordsWiddersteinSub = subsample(coordsWidderstein);

  // 3. Insert Walser Trail
  console.log('\n🏃 Inserting Walser Trail...');
  const resWalser = await supaFetch('POST', '/rest/v1/community_races', {
    user_id:     USER_ID,
    race_name:   'Walser Trail (Walser Trail Challange)',
    race_date:   '2026-07-26',
    start_time:  null,
    start_name:  'Hirschegg',
    finish_name: 'Hirschegg',
    description: '29 km | 1.700 Hm — Der klassische Walser Trail durch die wildromantische Bergwelt des Kleinwalsertals. Start und Ziel in Hirschegg.',
    distance:    statsWalser.distance,
    ascent:      statsWalser.ascent,
    descent:     statsWalser.descent,
    coords:      coordsWalserSub,
    waypoints:   null,
    logo_url:    LOGOS.walserTrail,
    website_url: WEBSITE,
    is_public:   true,
  });
  if (resWalser.status === 201) {
    console.log(`   ✅ Walser Trail inserted (ID: ${resWalser.body[0]?.id})`);
  } else {
    console.error(`   ❌ Error ${resWalser.status}:`, resWalser.body);
  }

  // 4. Insert Widderstein Trail
  console.log('🏔️  Inserting Widderstein Trail...');
  const resWidderstein = await supaFetch('POST', '/rest/v1/community_races', {
    user_id:     USER_ID,
    race_name:   'Widderstein Trail (Walser Trail Challange)',
    race_date:   '2026-07-26',
    start_time:  null,
    start_name:  'Hirschegg',
    finish_name: 'Hirschegg',
    description: '15 km | 980 Hm — Der Einsteigertrail mit Wow-Effekt: Gipfelerlebnis am Widderstein mit fantastischem Panorama über das Kleinwalsertal.',
    distance:    statsWidderstein.distance,
    ascent:      statsWidderstein.ascent,
    descent:     statsWidderstein.descent,
    coords:      coordsWiddersteinSub,
    waypoints:   null,
    logo_url:    LOGOS.widderstein,
    website_url: WEBSITE,
    is_public:   true,
  });
  if (resWidderstein.status === 201) {
    console.log(`   ✅ Widderstein Trail inserted (ID: ${resWidderstein.body[0]?.id})`);
  } else {
    console.error(`   ❌ Error ${resWidderstein.status}:`, resWidderstein.body);
  }

  // 5. Update existing Ultra entry logo
  console.log('🔄 Updating Ultra Trail logo...');
  const resUpdate = await supaFetch('PATCH', `/rest/v1/community_races?id=eq.${ULTRA_ID}`, {
    logo_url:    LOGOS.ultra,
    website_url: WEBSITE,
    description: '63 km | 3.900 Hm — Der härteste Trail des Kleinwalsertals: Eine epische Runde durch die wildesten Gipfel und Grate der Region.',
    race_date:   '2026-07-25',
    start_name:  'Hirschegg',
    finish_name: 'Hirschegg',
  });
  if (resUpdate.status === 200) {
    console.log('   ✅ Ultra Trail logo updated');
  } else {
    console.error(`   ❌ Update error ${resUpdate.status}:`, resUpdate.body);
  }

  console.log('\n✅ Import abgeschlossen!');
}

main().catch(console.error);
