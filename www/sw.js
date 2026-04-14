const CACHE_NAME = 'peakflow-v16';
const TILE_CACHE = 'peakflow-tiles-v1';
const MAX_TILE_CACHE_SIZE = 5000; // Max 5000 tiles (~250MB) for offline maps

// Force immediate activation (no waiting for old tabs to close)
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/routes.js',
  '/weather.js',
  '/snow.js',
  '/export.js',
  '/supabase.js',
  '/utils.js',
  '/walkthrough.js',
  '/route-finder.js',
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/icon-maskable.svg',
  '/impressum.html',
  '/datenschutz.html'
];

// Tile server patterns to cache
const TILE_PATTERNS = [
  'tile.openstreetmap.org',
  'opentopomap.org',
  'tile.opentopomap.org',
  'basemaps.cartocdn.com',
  'tiles.stadiamaps.com',
  'server.arcgisonline.com',
  'api.maptiler.com',
  'terrain-tiles'
];

function isTileRequest(url) {
  return TILE_PATTERNS.some(function(pattern) { return url.includes(pattern); });
}

function isApiRequest(url) {
  return url.includes('supabase.co') ||
    url.includes('open-meteo.com') ||
    url.includes('brouter.de') ||
    url.includes('openrouteservice.org') ||
    url.includes('overpass-api') ||
    url.includes('nominatim') ||
    url.includes('ip-api.com');
}

// Install - cache static assets
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(STATIC_ASSETS).catch(function(e) {
        console.warn('[SW] Some assets failed to cache:', e);
      });
    })
  );
  self.skipWaiting();
});

// Activate - clean old caches
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) {
          return key !== CACHE_NAME && key !== TILE_CACHE;
        }).map(function(key) { return caches.delete(key); })
      );
    })
  );
  self.clients.claim();
});

// Trim tile cache if too large
async function trimTileCache() {
  var cache = await caches.open(TILE_CACHE);
  var keys = await cache.keys();
  if (keys.length > MAX_TILE_CACHE_SIZE) {
    // Delete oldest 20% of tiles
    var deleteCount = Math.floor(keys.length * 0.2);
    for (var i = 0; i < deleteCount; i++) {
      await cache.delete(keys[i]);
    }
    console.log('[SW] Trimmed tile cache: removed ' + deleteCount + ' tiles');
  }
}

// Fetch handler
self.addEventListener('fetch', function(event) {
  var url = event.request.url;

  // Skip non-GET
  if (event.request.method !== 'GET') return;

  // TILES - Cache first, then network (offline support!)
  if (isTileRequest(url)) {
    event.respondWith(
      caches.open(TILE_CACHE).then(function(cache) {
        return cache.match(event.request).then(function(cached) {
          if (cached) return cached;

          return fetch(event.request).then(function(response) {
            if (response.ok) {
              cache.put(event.request, response.clone());
              // Trim cache periodically
              trimTileCache();
            }
            return response;
          }).catch(function() {
            // Offline - return transparent placeholder tile
            return new Response(
              '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#f0ece2" opacity="0.3"/><text x="128" y="128" text-anchor="middle" fill="#999" font-size="12">Offline</text></svg>',
              { headers: { 'Content-Type': 'image/svg+xml' } }
            );
          });
        });
      })
    );
    return;
  }

  // API calls - Network only (no caching)
  if (isApiRequest(url)) {
    event.respondWith(
      fetch(event.request).catch(function() {
        return new Response(JSON.stringify({ error: 'offline' }), {
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // Static assets (same origin) - Cache first, update in background
  if (new URL(url).origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        var networkFetch = fetch(event.request).then(function(response) {
          if (response.ok) {
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(event.request, response.clone());
            });
          }
          return response;
        }).catch(function() { return cached; });

        return cached || networkFetch;
      })
    );
    return;
  }

  // Everything else - network with cache fallback
  event.respondWith(
    fetch(event.request).catch(function() {
      return caches.match(event.request);
    })
  );
});

// Listen for messages from the app
self.addEventListener('message', function(event) {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  // Pre-cache tiles for a specific area (called when user saves a route for offline)
  if (event.data && event.data.type === 'CACHE_AREA') {
    var bounds = event.data.bounds;
    var zoom = event.data.zoom || 14;
    console.log('[SW] Pre-caching area at zoom ' + zoom);
    // The app will send individual tile URLs to cache
  }

  if (event.data && event.data.type === 'CACHE_TILES') {
    var tiles = event.data.urls;
    caches.open(TILE_CACHE).then(function(cache) {
      var cached = 0;
      tiles.forEach(function(url) {
        fetch(url).then(function(resp) {
          if (resp.ok) {
            cache.put(url, resp);
            cached++;
          }
        }).catch(function() {});
      });
      console.log('[SW] Caching ' + tiles.length + ' tiles');
    });
  }
});
