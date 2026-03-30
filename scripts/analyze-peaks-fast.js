/**
 * Fast peak reachability analysis using BRouter + Overpass fallback
 *
 * Checks if a hiking trail can be routed TO each peak via BRouter.
 * Much faster than pure Overpass: BRouter responds in <100ms per query.
 *
 * Usage: node analyze-peaks-fast.js
 * Background: node analyze-peaks-fast.js > analyze-fast.log 2>&1 &
 */

const SUPABASE_URL = 'https://wbrvkweezbeakfphssxp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndicnZrd2VlemJlYWtmcGhzc3hwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwODk4NjEsImV4cCI6MjA4OTY2NTg2MX0.WDzw0d4NewgPhFopQyaQ6f3E0K-yFhOSIeDGXdVa7xE';
const BROUTER_URL = 'https://routing.peak-flow.app/brouter';
const OVERPASS_SERVERS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter'
];
let serverIndex = 0;

const BATCH_SIZE = 20;
const DELAY_BETWEEN_PEAKS_MS = 300;   // 300ms between BRouter checks
const DELAY_BETWEEN_BATCHES_MS = 2000; // 2s between batches
const OVERPASS_DELAY_MS = 6000;        // 6s for Overpass fallback

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Check if BRouter can route to this peak (means there's a mapped road/trail nearby)
 */
async function checkViaBRouter(peak) {
  // Try routing from points at increasing distances (1-3km) to the peak
  const offsets = [
    [0.01, 0], [-0.01, 0], [0, 0.01], [0, -0.01],
    [0.02, 0], [-0.02, 0], [0, 0.02], [0, -0.02],
    [0.03, 0], [0, 0.03], [-0.03, 0], [0, -0.03]
  ];

  for (const [dlat, dlng] of offsets) {
    const fromLat = peak.lat + dlat;
    const fromLng = peak.lng + dlng;
    const url = `${BROUTER_URL}?lonlats=${fromLng},${fromLat}|${peak.lng},${peak.lat}&profile=hiking-mountain&alternativeidx=0&format=geojson`;

    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (resp.ok) {
        const data = await resp.json();
        const coords = data.features?.[0]?.geometry?.coordinates;
        if (coords && coords.length > 1) {
          return { routable: true };
        }
      }
      const text = await resp.text().catch(() => '');
      if (text.includes('not mapped')) continue; // try next offset
      if (resp.status === 400) continue;
    } catch (e) {
      continue;
    }
  }
  return { routable: false };
}

/**
 * Check via Overpass if any trail exists within 300m (fallback for BRouter misses)
 */
async function checkViaOverpass(peak) {
  const query = `[out:json][timeout:10];
    way(around:300,${peak.lat},${peak.lng})["highway"~"path|track|footway"];
    out tags;`;

  try {
    const url = OVERPASS_SERVERS[serverIndex % OVERPASS_SERVERS.length];
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query),
      signal: AbortSignal.timeout(15000)
    });

    if (resp.status === 429) {
      serverIndex++;
      await sleep(10000);
      return null; // skip, retry later
    }
    if (!resp.ok) {
      serverIndex++;
      return null;
    }

    const data = await resp.json();
    const ways = data.elements || [];

    if (ways.length === 0) return { reachable: false, max_sac_scale: null, nearest_trail_distance_m: null };

    // Find highest SAC scale
    const sacNames = { hiking: 'T1', mountain_hiking: 'T2', demanding_mountain_hiking: 'T3',
      alpine_hiking: 'T4', demanding_alpine_hiking: 'T5', difficult_alpine_hiking: 'T6' };
    const sacOrder = { hiking: 1, mountain_hiking: 2, demanding_mountain_hiking: 3,
      alpine_hiking: 4, demanding_alpine_hiking: 5, difficult_alpine_hiking: 6 };

    let maxSac = 0, maxSacName = 'T1';
    ways.forEach(w => {
      const sac = w.tags?.sac_scale;
      if (sac && sacOrder[sac] > maxSac) { maxSac = sacOrder[sac]; maxSacName = sacNames[sac]; }
    });

    return {
      reachable: maxSac <= 4,
      max_sac_scale: maxSacName,
      nearest_trail_distance_m: 50
    };
  } catch (e) {
    return null;
  }
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
  console.log('Peakflow Fast Peak Analyzer (BRouter + Overpass)');
  console.log('================================================');
  console.log(`Started: ${new Date().toISOString()}`);

  let totalProcessed = 0, totalReachable = 0, totalUnreachable = 0, totalErrors = 0;
  const startTime = Date.now();

  while (true) {
    // Get batch of unanalyzed peaks (highest first)
    const url = `${SUPABASE_URL}/rest/v1/peaks?reachable=is.null&is_active=eq.true&select=id,name,lat,lng,elevation&order=elevation.desc&limit=${BATCH_SIZE}`;
    const resp = await fetch(url, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });

    if (!resp.ok) { console.error('Supabase error:', resp.status); break; }
    const peaks = await resp.json();
    if (peaks.length === 0) { console.log('\n✅ All peaks analyzed!'); break; }

    for (const peak of peaks) {
      // Step 1: Fast check via BRouter
      const brouter = await checkViaBRouter(peak);
      await sleep(DELAY_BETWEEN_PEAKS_MS);

      if (brouter.routable) {
        // BRouter can route here → reachable, but we don't know SAC scale
        // Mark as reachable with T1 default (Overpass can refine later)
        await updatePeak(peak.id, { reachable: true, max_sac_scale: 'T1', nearest_trail_distance_m: 50 });
        totalReachable++;
        process.stdout.write(`✅ ${peak.name} (${peak.elevation}m) `);
      } else {
        // BRouter failed → check Overpass for trails nearby
        const overpass = await checkViaOverpass(peak);
        await sleep(OVERPASS_DELAY_MS);

        if (overpass === null) {
          totalErrors++;
          process.stdout.write(`⏭ ${peak.name} (${peak.elevation}m) `);
          // Don't update - will be retried next run
          continue;
        }

        await updatePeak(peak.id, overpass);
        if (overpass.reachable) {
          totalReachable++;
          process.stdout.write(`✅ ${peak.name} (${peak.elevation}m) ${overpass.max_sac_scale} `);
        } else {
          totalUnreachable++;
          process.stdout.write(`❌ ${peak.name} (${peak.elevation}m) `);
        }
      }

      totalProcessed++;
    }

    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    const rate = (totalProcessed / ((Date.now() - startTime) / 1000 / 60)).toFixed(0);
    const remaining = Math.round((47595 - totalProcessed) / rate);
    console.log(`\n[${elapsed}min] Done: ${totalProcessed} | ✅${totalReachable} ❌${totalUnreachable} ⏭${totalErrors} | ~${remaining}min left`);

    await sleep(DELAY_BETWEEN_BATCHES_MS);
  }

  console.log('\n================================================');
  console.log(`Finished: ${new Date().toISOString()}`);
  console.log(`Total: ${totalProcessed} | Reachable: ${totalReachable} | Unreachable: ${totalUnreachable} | Errors: ${totalErrors}`);
}

main().catch(console.error);
