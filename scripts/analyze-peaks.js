/**
 * Batch analysis: Check reachability of all peaks in Supabase
 *
 * Queries Overpass API for each peak to check if a hiking trail exists nearby.
 * Updates the peaks table with: reachable (bool), max_sac_scale (text), nearest_trail_distance_m (int)
 *
 * Usage: node analyze-peaks.js
 *
 * Rate limits: Overpass API allows ~10 requests per minute for free users.
 * This script processes in batches with delays to respect rate limits.
 * Full run for 41,814 peaks takes ~70 hours. Run in background!
 */

const SUPABASE_URL = 'https://wbrvkweezbeakfphssxp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndicnZrd2VlemJlYWtmcGhzc3hwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwODk4NjEsImV4cCI6MjA4OTY2NTg2MX0.WDzw0d4NewgPhFopQyaQ6f3E0K-yFhOSIeDGXdVa7xE';
// Use alternative Overpass server (less congested)
const OVERPASS_SERVERS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter'
];
let serverIndex = 0;
function getOverpassUrl() {
  return OVERPASS_SERVERS[serverIndex % OVERPASS_SERVERS.length];
}

const BATCH_SIZE = 5;
const DELAY_BETWEEN_BATCHES_MS = 30000; // 30 seconds between batches
const DELAY_BETWEEN_REQUESTS_MS = 6000; // 6 seconds between individual requests
const SEARCH_RADIUS_M = 300;

async function checkPeakReachability(peak) {
  const query = `
    [out:json][timeout:10];
    way(around:${SEARCH_RADIUS_M},${peak.lat},${peak.lng})
      ["highway"~"path|track|footway"]
      ["sac_scale"];
    out tags;
  `;

  try {
    const resp = await fetch(getOverpassUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query)
    });

    if (resp.status === 429) {
      console.log('  Rate limited, waiting 30s...');
      await sleep(30000);
      return checkPeakReachability(peak); // Retry
    }

    if (!resp.ok) {
      console.warn(`  Overpass error: ${resp.status} (server ${serverIndex % OVERPASS_SERVERS.length})`);
      serverIndex++; // Try next server
      if (resp.status === 504 || resp.status === 503) {
        await sleep(5000);
        return checkPeakReachability(peak); // Retry with different server
      }
      return null;
    }

    const data = await resp.json();
    const ways = data.elements || [];

    if (ways.length === 0) {
      // No trail nearby - check for any path without sac_scale
      const query2 = `
        [out:json][timeout:10];
        way(around:${SEARCH_RADIUS_M},${peak.lat},${peak.lng})
          ["highway"~"path|track|footway"];
        out tags;
      `;
      const resp2 = await fetch(getOverpassUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query2)
      });

      if (resp2.ok) {
        const data2 = await resp2.json();
        if ((data2.elements || []).length > 0) {
          return { reachable: true, max_sac_scale: 'T1', nearest_trail_distance_m: 100 };
        }
      }

      return { reachable: false, max_sac_scale: null, nearest_trail_distance_m: null };
    }

    // Find highest SAC scale
    const sacOrder = { hiking: 1, mountain_hiking: 2, demanding_mountain_hiking: 3,
      alpine_hiking: 4, demanding_alpine_hiking: 5, difficult_alpine_hiking: 6 };
    const sacNames = { hiking: 'T1', mountain_hiking: 'T2', demanding_mountain_hiking: 'T3',
      alpine_hiking: 'T4', demanding_alpine_hiking: 'T5', difficult_alpine_hiking: 'T6' };

    let maxSac = 0;
    let maxSacName = 'T1';

    ways.forEach(way => {
      const sac = way.tags?.sac_scale;
      if (sac && sacOrder[sac] && sacOrder[sac] > maxSac) {
        maxSac = sacOrder[sac];
        maxSacName = sacNames[sac];
      }
    });

    // Reachable if any trail exists, but mark SAC level
    return {
      reachable: maxSac <= 4, // T1-T4 reachable, T5-T6 only for alpinists
      max_sac_scale: maxSacName,
      nearest_trail_distance_m: 50 // approximate
    };

  } catch (e) {
    console.warn('  Error:', e.message);
    return null;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('Peakflow Peak Reachability Analyzer');
  console.log('====================================');

  // Fetch peaks that haven't been analyzed yet
  let offset = 0;
  let totalProcessed = 0;
  let totalUpdated = 0;

  while (true) {
    // Get batch of unanalyzed peaks
    const url = `${SUPABASE_URL}/rest/v1/peaks?reachable=is.null&select=id,name,lat,lng,elevation&order=elevation.desc&limit=${BATCH_SIZE}&offset=${offset}`;
    const resp = await fetch(url, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });

    if (!resp.ok) {
      console.error('Supabase error:', resp.status);
      break;
    }

    const peaks = await resp.json();
    if (peaks.length === 0) {
      console.log('All peaks analyzed!');
      break;
    }

    console.log(`\nBatch: ${totalProcessed + 1} - ${totalProcessed + peaks.length}`);

    for (let pi = 0; pi < peaks.length; pi++) {
      const peak = peaks[pi];
      if (pi > 0) await sleep(DELAY_BETWEEN_REQUESTS_MS);
      const result = await checkPeakReachability(peak);
      totalProcessed++;

      if (result) {
        // Update Supabase
        const updateUrl = `${SUPABASE_URL}/rest/v1/peaks?id=eq.${peak.id}`;
        const updateResp = await fetch(updateUrl, {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            reachable: result.reachable,
            max_sac_scale: result.max_sac_scale,
            nearest_trail_distance_m: result.nearest_trail_distance_m
          })
        });

        const status = result.reachable ? '✅' : '❌';
        console.log(`  ${status} ${peak.name} (${peak.elevation}m) - ${result.max_sac_scale || 'no trail'}`);
        totalUpdated++;
      } else {
        console.log(`  ⏭ ${peak.name} (${peak.elevation}m) - skipped (error)`);
      }
    }

    // Don't increment offset - we're filtering by reachable=is.null
    // so already-processed peaks won't appear again

    console.log(`  Processed: ${totalProcessed} | Updated: ${totalUpdated}`);
    console.log(`  Waiting ${DELAY_BETWEEN_BATCHES_MS / 1000}s...`);
    await sleep(DELAY_BETWEEN_BATCHES_MS);
  }

  console.log('\n====================================');
  console.log(`Done! Processed: ${totalProcessed} | Updated: ${totalUpdated}`);
}

main().catch(console.error);
