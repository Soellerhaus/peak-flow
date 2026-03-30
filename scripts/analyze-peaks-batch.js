/**
 * Batch peak reachability analysis using Overpass batch queries
 *
 * Instead of 1 query per peak, sends 1 query for 50 peaks at once.
 * ~47,000 peaks / 50 = ~950 queries. At 6s each = ~1.5 hours total.
 *
 * Usage: nohup node analyze-peaks-batch.js > analyze-batch.log 2>&1 &
 */

const SUPABASE_URL = 'https://wbrvkweezbeakfphssxp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndicnZrd2VlemJlYWtmcGhzc3hwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwODk4NjEsImV4cCI6MjA4OTY2NTg2MX0.WDzw0d4NewgPhFopQyaQ6f3E0K-yFhOSIeDGXdVa7xE';

const OVERPASS_SERVERS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter'
];
let srvIdx = 0;

const PEAKS_PER_QUERY = 30;       // peaks per Overpass batch
const DELAY_BETWEEN_QUERIES = 8000; // 8s between Overpass queries
const SEARCH_RADIUS = 300;         // meters

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const SAC_ORDER = { hiking: 1, mountain_hiking: 2, demanding_mountain_hiking: 3,
  alpine_hiking: 4, demanding_alpine_hiking: 5, difficult_alpine_hiking: 6 };
const SAC_NAMES = { hiking: 'T1', mountain_hiking: 'T2', demanding_mountain_hiking: 3,
  alpine_hiking: 'T4', demanding_alpine_hiking: 'T5', difficult_alpine_hiking: 'T6' };
const SAC_NAME_MAP = { 1: 'T1', 2: 'T2', 3: 'T3', 4: 'T4', 5: 'T5', 6: 'T6' };

/**
 * Check multiple peaks at once via a single Overpass query
 */
async function checkBatch(peaks) {
  // Build a union query: for each peak, search 300m radius for trails
  const aroundClauses = peaks.map((p, i) =>
    `way(around:${SEARCH_RADIUS},${p.lat},${p.lng})["highway"~"path|track|footway"];`
  ).join('\n');

  // Use a smarter approach: one query per peak but using foreach
  // Actually, the simplest is: get all trails near ANY of the peaks, then match
  // Build bounding box that covers all peaks + radius
  const lats = peaks.map(p => p.lat);
  const lngs = peaks.map(p => p.lng);
  const pad = SEARCH_RADIUS / 111000; // degrees
  const bbox = `${Math.min(...lats) - pad},${Math.min(...lngs) - pad},${Math.max(...lats) + pad},${Math.max(...lngs) + pad}`;

  const query = `[out:json][timeout:30][bbox:${bbox}];
    way["highway"~"path|track|footway"];
    out body geom;`;

  const server = OVERPASS_SERVERS[srvIdx % OVERPASS_SERVERS.length];

  try {
    const resp = await fetch(server, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query),
      signal: AbortSignal.timeout(30000)
    });

    if (resp.status === 429 || resp.status === 504 || resp.status === 503) {
      srvIdx++;
      return null; // retry later
    }
    if (!resp.ok) { srvIdx++; return null; }

    const data = await resp.json();
    const ways = data.elements || [];

    // For each peak, find trails within SEARCH_RADIUS
    const results = {};
    for (const peak of peaks) {
      let nearestDist = Infinity;
      let maxSac = 0;

      for (const way of ways) {
        if (!way.geometry) continue;
        // Check if any node of this way is within radius of the peak
        for (const node of way.geometry) {
          const d = haversine(peak.lat, peak.lng, node.lat, node.lon);
          if (d < SEARCH_RADIUS) {
            if (d < nearestDist) nearestDist = d;
            const sac = way.tags?.sac_scale;
            if (sac && SAC_ORDER[sac] && SAC_ORDER[sac] > maxSac) {
              maxSac = SAC_ORDER[sac];
            }
            break; // this way is near enough, check next way
          }
        }
      }

      if (nearestDist < SEARCH_RADIUS) {
        results[peak.id] = {
          reachable: maxSac <= 4,
          max_sac_scale: SAC_NAME_MAP[maxSac] || 'T1',
          nearest_trail_distance_m: Math.round(nearestDist)
        };
      } else {
        results[peak.id] = {
          reachable: false,
          max_sac_scale: null,
          nearest_trail_distance_m: null
        };
      }
    }
    return results;
  } catch (e) {
    srvIdx++;
    return null;
  }
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function updatePeak(peakId, data) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/peaks?id=eq.${peakId}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(data)
  });
  return resp.ok;
}

async function main() {
  console.log('Peakflow Batch Peak Analyzer');
  console.log('============================');
  console.log(`Started: ${new Date().toISOString()}`);

  let totalProcessed = 0, totalReachable = 0, totalUnreachable = 0, batchNum = 0;
  let retries = 0;
  const startTime = Date.now();

  while (true) {
    // Get batch of unanalyzed peaks
    const url = `${SUPABASE_URL}/rest/v1/peaks?reachable=is.null&is_active=eq.true&select=id,name,lat,lng,elevation&order=elevation.desc&limit=${PEAKS_PER_QUERY}`;
    const resp = await fetch(url, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    if (!resp.ok) { console.error('Supabase error:', resp.status); await sleep(10000); continue; }

    const peaks = await resp.json();
    if (peaks.length === 0) { console.log('\n✅ All peaks analyzed!'); break; }

    batchNum++;
    const results = await checkBatch(peaks);

    if (results === null) {
      retries++;
      if (retries > 10) {
        console.log(`\n⚠️ Too many retries, waiting 60s...`);
        await sleep(60000);
        retries = 0;
      }
      console.log(`⏭ Batch ${batchNum} failed (server ${srvIdx % 3}), retrying...`);
      await sleep(DELAY_BETWEEN_QUERIES);
      continue;
    }
    retries = 0;

    // Update Supabase for each peak
    for (const peak of peaks) {
      const r = results[peak.id];
      if (r) {
        await updatePeak(peak.id, r);
        totalProcessed++;
        if (r.reachable) {
          totalReachable++;
          process.stdout.write(`✅`);
        } else {
          totalUnreachable++;
          process.stdout.write(`❌`);
        }
      }
    }

    const elapsed = ((Date.now() - startTime) / 60000).toFixed(1);
    const rate = totalProcessed / ((Date.now() - startTime) / 60000);
    const remaining = rate > 0 ? Math.round((47595 - totalProcessed) / rate) : '?';
    console.log(` [${elapsed}m] #${batchNum} | ${totalProcessed} done | ✅${totalReachable} ❌${totalUnreachable} | ~${remaining}m left`);

    await sleep(DELAY_BETWEEN_QUERIES);
  }

  console.log('\n============================');
  console.log(`Finished: ${new Date().toISOString()}`);
  console.log(`Total: ${totalProcessed} | ✅ ${totalReachable} | ❌ ${totalUnreachable}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
