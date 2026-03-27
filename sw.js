const CACHE_NAME = 'peakflow-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/routes.js',
  '/weather.js',
  '/snow.js',
  '/export.js',
  '/supabase.js',
  '/utils.js',
  '/walkthrough.js',
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/icon-maskable.svg'
];

// Install - cache static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate - clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch - network first for API calls, cache first for static assets
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // API calls (Supabase, weather, routing, Overpass) - network only
  if (url.hostname !== location.hostname) {
    event.respondWith(
      fetch(event.request).catch(() => {
        // If offline and it's a tile request, return empty
        if (url.pathname.includes('/tile/') || url.href.includes('tile.openstreetmap')) {
          return new Response('', { status: 408 });
        }
        return new Response(JSON.stringify({ error: 'offline' }), {
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // Static assets - cache first, then network
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) {
        // Return cache but also update in background
        event.waitUntil(
          fetch(event.request).then(response => {
            if (response.ok) {
              caches.open(CACHE_NAME).then(cache => cache.put(event.request, response));
            }
          }).catch(() => {})
        );
        return cached;
      }
      return fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
