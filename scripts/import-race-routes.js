/**
 * Race Route Importer for Peakflow
 *
 * Fetches GPX/coordinate data from Komoot public API and other sources,
 * stores race stage routes in Supabase race_routes table.
 *
 * SETUP (run once in Supabase Dashboard → SQL Editor):
 * ─────────────────────────────────────────────────────
 * CREATE TABLE IF NOT EXISTS race_routes (
 *   id SERIAL PRIMARY KEY,
 *   race_slug TEXT NOT NULL,
 *   race_name TEXT NOT NULL,
 *   edition INTEGER NOT NULL,
 *   stage INTEGER,
 *   stage_name TEXT,
 *   distance NUMERIC,
 *   ascent INTEGER,
 *   descent INTEGER,
 *   coords JSONB NOT NULL,
 *   logo_url TEXT,
 *   race_date DATE,
 *   stage_color TEXT,
 *   source_url TEXT,
 *   created_at TIMESTAMPTZ DEFAULT NOW(),
 *   UNIQUE(race_slug, edition, COALESCE(stage, -1))
 * );
 * ALTER TABLE race_routes ENABLE ROW LEVEL SECURITY;
 * CREATE POLICY "public read" ON race_routes FOR SELECT USING (true);
 *
 * Usage: node scripts/import-race-routes.js >> scripts/race-import.log 2>&1
 */

const SUPABASE_URL = 'https://wbrvkweezbeakfphssxp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndicnZrd2VlemJlYWtmcGhzc3hwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDA4OTg2MSwiZXhwIjoyMDg5NjY1ODYxfQ.rIP9qn1gsgAYg9BJE7VJFBbYm0-YBXABiHhUkOChSDc';

const STAGE_COLORS = ['#e63946','#457b9d','#2a9d8f','#e9c46a','#f4a261','#a8dadc','#6a4c93','#43aa8b','#ff6b6b','#4ecdc4'];

// GPX-URL Muster für tracedetrail.fr (confirmed working):
// https://tracedetrail.fr/en/trace/TRACE_ID/gpx
const TDT = id => `https://tracedetrail.fr/en/trace/${id}/gpx`;

// ─── Race Definitions ───────────────────────────────────────────────────────
const RACES = [

  // ── Transalpine Run ──────────────────────────────────────────────────────
  {
    race_slug: 'transalpine-run',
    race_name: 'Transalpine Run',
    logo_url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1e/Transalpine_Run_Logo.png/200px-Transalpine_Run_Logo.png',
    editions: [
      {
        edition: 2022,
        race_date: '2022-09-04',
        stages: [
          { stage: 1, stage_name: 'Garmisch → Lermoos',   komoot_id: '494808700' },
          { stage: 2, stage_name: 'Lermoos → Imst',        komoot_id: null },
          { stage: 3, stage_name: 'Imst → Mandarfen',      komoot_id: '533027287' },
          { stage: 4, stage_name: 'Mandarfen → Rifflsee',  komoot_id: '495000890' },
          { stage: 5, stage_name: 'Ischgl → Scuol',        komoot_id: null },
          { stage: 6, stage_name: 'Scuol → Livigno',       komoot_id: '495602967' },
          { stage: 7, stage_name: 'Livigno → Bormio',      komoot_id: null },
          { stage: 8, stage_name: 'Bormio → Glorenza',     komoot_id: null },
        ]
      },
      {
        edition: 2023,
        race_date: '2023-09-10',
        stages: [
          { stage: 1, stage_name: 'Lech → St. Anton',      komoot_id: '972883234' },
          { stage: 2, stage_name: 'St. Anton → Ischgl',    komoot_id: null },
          { stage: 3, stage_name: 'Ischgl → Galtür',       komoot_id: '972943580' },
          { stage: 4, stage_name: 'Galtür → Klosters',     komoot_id: null },
          { stage: 5, stage_name: 'Klosters → Scuol',      komoot_id: '975054618' },
          { stage: 6, stage_name: 'Scuol → St. Valentin',  komoot_id: null },
          { stage: 7, stage_name: 'St. Valentin → Prad',   komoot_id: '944029919' },
          { stage: 8, stage_name: 'Prad → Glorenza',       komoot_id: null },
        ]
      },
      {
        edition: 2026,
        race_date: '2026-08-29',  // Lenzerheide → Locarno, Aug 29 – Sep 5, 2026
        stages: [
          // Offizielle Route wird ca. April/Mai 2026 veröffentlicht
          { stage: 1, stage_name: 'Lenzerheide → Vals',   komoot_id: null },
          { stage: 2, stage_name: 'Vals → Splügen',       komoot_id: null },
          { stage: 3, stage_name: 'Splügen → Chiavenna',  komoot_id: null },
          { stage: 4, stage_name: 'Chiavenna → Menaggio', komoot_id: null },
          { stage: 5, stage_name: 'Menaggio → Lugano',    komoot_id: null },
          { stage: 6, stage_name: 'Lugano → Locarno',     komoot_id: null },
        ]
      }
    ]
  },

  // ── Zugspitz Ultratrail (ZUT) ────────────────────────────────────────────
  // Quelle: tracedetrail.fr/fr/event/salomon-zugspitz-ultratrail-powered-by-ledlenser-2025
  {
    race_slug: 'zugspitz-ultratrail',
    race_name: 'Zugspitz Ultratrail',
    logo_url: null,
    editions: [
      {
        edition: 2025,
        race_date: '2025-06-13',  // Jun 12–14, 2025, Garmisch-Partenkirchen
        stages: [
          { stage: 1, stage_name: 'Zugspitz Ultratrail (107km)', gpx_url: TDT(276812) },
          { stage: 2, stage_name: 'ZUT100 (165km)',              gpx_url: TDT(276776) },
          { stage: 3, stage_name: 'Ehrwald Trail (84km)',        gpx_url: TDT(276813) },
          { stage: 4, stage_name: 'Leutasch Trail (67km)',       gpx_url: TDT(276814) },
          { stage: 5, stage_name: 'Mittenwald Trail (43km)',     gpx_url: TDT(276811) },
          { stage: 6, stage_name: 'GaPa Trail (28km)',           gpx_url: TDT(276816) },
          { stage: 7, stage_name: 'Grainau Trail (15km)',        gpx_url: TDT(276818) },
        ]
      }
    ]
  },

  // ── UTMB Mont-Blanc ──────────────────────────────────────────────────────
  // Quelle: tracedetrail.fr
  {
    race_slug: 'utmb',
    race_name: 'UTMB Mont-Blanc',
    logo_url: null,
    editions: [
      {
        edition: 2025,
        race_date: '2025-08-25',  // Aug 24–30, 2025, Chamonix
        stages: [
          { stage: 1, stage_name: 'UTMB (171km)',  gpx_url: TDT(310891) },
          { stage: 2, stage_name: 'MCC (40km)',    gpx_url: TDT(311036) },
          // CCC, TDS, OCC: Traces noch nicht auf tracedetrail.fr für 2025 — add later
          { stage: 3, stage_name: 'CCC (101km)',   gpx_url: null },
          { stage: 4, stage_name: 'TDS (145km)',   gpx_url: null },
          { stage: 5, stage_name: 'OCC (56km)',    gpx_url: null },
        ]
      }
    ]
  },

  // ── Lavaredo Ultra Trail ─────────────────────────────────────────────────
  // Quelle: tracedetrail.fr/en/trace/304391 (120km), 304389 (80km)
  {
    race_slug: 'lavaredo-ultra-trail',
    race_name: 'Lavaredo Ultra Trail',
    logo_url: null,
    editions: [
      {
        edition: 2025,
        race_date: '2025-06-26',  // Jun 24–28, 2025, Cortina d'Ampezzo
        stages: [
          { stage: 1, stage_name: 'Lavaredo 120km', gpx_url: TDT(304391) },
          { stage: 2, stage_name: 'Lavaredo 80km',  gpx_url: TDT(304389) },
        ]
      }
    ]
  },

  // ── Eiger Ultra Trail ────────────────────────────────────────────────────
  // Quelle: tracedetrail.fr/fr/event/eiger-ultra-trail-2025
  {
    race_slug: 'eiger-ultra-trail',
    race_name: 'Eiger Ultra Trail',
    logo_url: null,
    editions: [
      {
        edition: 2025,
        race_date: '2025-07-19',  // Jul 15–19, 2025, Grindelwald
        stages: [
          { stage: 1, stage_name: 'E101 (100km)', gpx_url: TDT(305188) },
          { stage: 2, stage_name: 'E51 (52km)',   gpx_url: TDT(305189) },
          { stage: 3, stage_name: 'E35 (36km)',   gpx_url: TDT(305190) },
          { stage: 4, stage_name: 'E16 (16km)',   gpx_url: TDT(305206) },
        ]
      }
    ]
  },

  // ── Stubai Ultratrail ─────────────────────────────────────────────────────
  // Quelle: tracedetrail.fr/en/event/stubai-ultratrail-2025
  {
    race_slug: 'stubai-ultratrail',
    race_name: 'Stubai Ultratrail',
    logo_url: null,
    editions: [
      {
        edition: 2025,
        race_date: '2025-06-28',  // Jun 28, 2025, Neustift im Stubaital
        stages: [
          { stage: 1, stage_name: 'High Trail (79km)', gpx_url: TDT(268366) },
          { stage: 2, stage_name: 'Ultra (60km)',      gpx_url: TDT(268365) },
          { stage: 3, stage_name: 'Classic (32km)',    gpx_url: TDT(268364) },
          { stage: 4, stage_name: 'Express (24km)',    gpx_url: TDT(268363) },
        ]
      }
    ]
  },

  // ── Grossglockner Ultra Trail ─────────────────────────────────────────────
  // 2025: tracedetrail.fr/en/trace/242008 (108km Hauptstrecke)
  // 2026: tracedetrail.fr/fr/event/grossglockner-ultra-trail-2026
  {
    race_slug: 'grossglockner-ultra-trail',
    race_name: 'Grossglockner Ultra Trail',
    logo_url: null,
    editions: [
      {
        edition: 2025,
        race_date: '2025-07-25',  // Jul 24–27, 2025, Kaprun
        stages: [
          { stage: 1, stage_name: 'GGUT 110km',       gpx_url: TDT(242008) },
          { stage: 2, stage_name: 'Osttirol Trail 84km', gpx_url: TDT(306977) },
        ]
      },
      {
        edition: 2026,
        race_date: '2026-07-24',  // Jul 24–25, 2026, Kaprun
        stages: [
          { stage: 1, stage_name: 'GGUT 110km',              gpx_url: TDT(318452) },
          { stage: 2, stage_name: 'Osttirol Trail 83km',     gpx_url: TDT(318454) },
          { stage: 3, stage_name: 'Grossglockner Trail 57km',gpx_url: TDT(318453) },
          { stage: 4, stage_name: 'Weissee Trail 35km',      gpx_url: TDT(318455) },
        ]
      }
    ]
  },

  // ── Sierre-Zinal ──────────────────────────────────────────────────────────
  // Quelle: tracedetrail.fr/fr/trace/284999
  {
    race_slug: 'sierre-zinal',
    race_name: 'Sierre-Zinal',
    logo_url: null,
    editions: [
      {
        edition: 2025,
        race_date: '2025-08-09',  // Aug 9, 2025, Sierre → Zinal, Wallis
        stages: [
          { stage: 1, stage_name: 'Sierre → Zinal (32km)', gpx_url: TDT(284999) },
        ]
      }
    ]
  },
];

// ─── Helpers ────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function calcStats(coords) {
  let dist = 0, ascent = 0, descent = 0;
  for (let i = 1; i < coords.length; i++) {
    dist += haversine(coords[i-1][1], coords[i-1][0], coords[i][1], coords[i][0]);
    const dEle = (coords[i][2] || 0) - (coords[i-1][2] || 0);
    if (dEle > 0) ascent += dEle;
    else descent += Math.abs(dEle);
  }
  return { dist: Math.round(dist * 10) / 10, ascent: Math.round(ascent), descent: Math.round(descent) };
}

// ─── Komoot Fetcher ──────────────────────────────────────────────────────────
async function fetchKomootCoords(tourId) {
  const url = `https://api.komoot.de/v007/tours/${tourId}/coordinates`;
  console.log(`  → Fetching Komoot tour ${tourId}...`);
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Peakflow/1.0)' },
    signal: AbortSignal.timeout(15000)
  });
  if (!resp.ok) throw new Error(`Komoot HTTP ${resp.status}`);
  const data = await resp.json();
  const items = data.items || [];
  if (items.length === 0) throw new Error('No coordinates returned');
  // Convert to [lng, lat, ele]
  return items.map(p => [p.lng, p.lat, p.alt || 0]);
}

// ─── GPX Fetcher ─────────────────────────────────────────────────────────────
async function fetchGpxCoords(gpxUrl) {
  console.log(`  → Fetching GPX ${gpxUrl}...`);
  const resp = await fetch(gpxUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Peakflow/1.0)',
      'Accept': 'application/gpx+xml, text/xml, */*'
    },
    signal: AbortSignal.timeout(20000)
  });
  if (!resp.ok) throw new Error(`GPX HTTP ${resp.status}`);
  const xml = await resp.text();
  const coords = [];
  // Parse <trkpt lat="47.123" lon="10.456"><ele>2100</ele></trkpt>
  // Also handles lon before lat, and self-closing trkpt (no ele)
  const trkptRe = /<trkpt\s[^>]*lat="([^"]+)"[^>]*lon="([^"]+)"[^>]*>([\s\S]*?)<\/trkpt>|<trkpt\s[^>]*lon="([^"]+)"[^>]*lat="([^"]+)"[^>]*>([\s\S]*?)<\/trkpt>/g;
  let m;
  while ((m = trkptRe.exec(xml)) !== null) {
    const lat = parseFloat(m[1] || m[5]);
    const lng = parseFloat(m[2] || m[4]);
    const inner = m[3] || m[6] || '';
    const eleMatch = inner.match(/<ele>([^<]+)<\/ele>/);
    const ele = eleMatch ? parseFloat(eleMatch[1]) : 0;
    if (!isNaN(lat) && !isNaN(lng)) coords.push([lng, lat, ele]);
  }
  if (coords.length === 0) throw new Error('No trkpt coordinates found in GPX');
  return coords;
}

// ─── Supabase Upsert ─────────────────────────────────────────────────────────
async function upsertRoute(row) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/race_routes`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates'
    },
    body: JSON.stringify(row),
    signal: AbortSignal.timeout(30000)
  });
  if (resp.status === 409) return; // Duplicate — already exists, skip silently
  if (!resp.ok) {
    const err = await resp.text().catch(() => '');
    throw new Error(`Supabase ${resp.status}: ${err.substring(0, 200)}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== Peakflow Race Route Importer ===');
  console.log(new Date().toISOString());

  let totalImported = 0;
  let totalSkipped = 0;

  for (const race of RACES) {
    console.log(`\n🏁 ${race.race_name}`);

    for (const edition of race.editions) {
      console.log(`\n  📅 Edition ${edition.edition} (${edition.race_date})`);

      for (let si = 0; si < edition.stages.length; si++) {
        const stage = edition.stages[si];
        const stageColor = STAGE_COLORS[si % STAGE_COLORS.length];

        if (!stage.komoot_id && !stage.gpx_url) {
          console.log(`  ⏭ Stage ${stage.stage} (${stage.stage_name}) — no source, skipping`);
          totalSkipped++;
          continue;
        }

        try {
          const coords = stage.komoot_id
            ? await fetchKomootCoords(stage.komoot_id)
            : await fetchGpxCoords(stage.gpx_url);
          const stats = calcStats(coords);

          // Downsample to max 500 points to keep Supabase payload manageable
          let finalCoords = coords;
          if (coords.length > 500) {
            const step = Math.ceil(coords.length / 500);
            finalCoords = coords.filter((_, i) => i % step === 0 || i === coords.length - 1);
          }

          const sourceUrl = stage.komoot_id
            ? `https://www.komoot.com/tour/${stage.komoot_id}`
            : stage.gpx_url;

          const row = {
            race_slug: race.race_slug,
            race_name: race.race_name,
            edition: edition.edition,
            stage: stage.stage,
            stage_name: stage.stage_name,
            distance: stats.dist,
            ascent: stats.ascent,
            descent: stats.descent,
            coords: finalCoords,
            logo_url: race.logo_url || null,
            race_date: edition.race_date,
            stage_color: stageColor,
            source_url: sourceUrl
          };

          await upsertRoute(row);
          console.log(`  ✅ Stage ${stage.stage} (${stage.stage_name}): ${stats.dist}km, ${stats.ascent}Hm ⬆, ${finalCoords.length} pts`);
          totalImported++;

          await sleep(2000); // Rate limit: 2s between Komoot requests
        } catch(e) {
          console.log(`  ❌ Stage ${stage.stage} (${stage.stage_name}): ${e.message}`);
          totalSkipped++;
          await sleep(1000);
        }
      }
    }
  }

  console.log(`\n=== Done: ${totalImported} imported, ${totalSkipped} skipped ===`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
