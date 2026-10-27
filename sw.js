/* =============================================================
   WORLD AWARE RISK ASSESSMENT — sw.js
   Service Worker: caches app shell for full offline use.
   ============================================================= */

// Bump this with every release (keep in step with APP_VERSION in app.js).
// v2.3.0: new js/importValidator.js (Import from JSON).
// v2.2.0: stop caching cross-origin API responses; the old cache held addresses.
const CACHE_NAME = 'wa-risk-v2.3.0';

// App shell files to cache on install
const APP_SHELL = [
  './',
  './index.html',
  './app.js',
  './styles.css',
  './tokens.css',
  './fonts.css',
  './manifest.json',
  // Brand fonts (WOFF2 for the page, TTF for the PDF)
  './fonts/space-grotesk-latin-500-normal.woff2',
  './fonts/space-grotesk-latin-700-normal.woff2',
  './fonts/poppins-latin-400-normal.woff2',
  './fonts/poppins-latin-400-italic.woff2',
  './fonts/poppins-latin-500-normal.woff2',
  './fonts/poppins-latin-600-normal.woff2',
  './fonts/ttf/SpaceGrotesk-Bold-latin.ttf',
  './fonts/ttf/Poppins-Regular-latin.ttf',
  './fonts/ttf/Poppins-SemiBold-latin.ttf',
  // Logos (screen and PDF)
  './assets/wa-lockup-full-color.png',
  './assets/wa-lockup-reversed-cream.png',
  './assets/wa-mark-full-color.png',
  './assets/wa-mark-reversed-cream.png',
  './assets/wa-lockup-full-color-520.png',
  './assets/wa-lockup-reversed-cream-520.png',
  './icons/icon-192.svg',
  './icons/icon-512.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  // Research My Area scripts
  './js/apiConfig.js',
  './js/scoreMapper.js',
  './js/research.js',
  './js/wa-pdf-theme.js',
  // Report view + offline PDF generation
  './js/report.js',
  './js/importValidator.js',
  './js/vendor/jspdf.umd.min.js',
];

/* ── Install: cache app shell ──────────────────────────────── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Caching app shell');
      // cache: 'reload' bypasses the HTTP cache so a new release never
      // precaches files up to 10 minutes stale from GitHub Pages.
      return cache.addAll(APP_SHELL.map(u => new Request(u, { cache: 'reload' })));
    }).then(() => {
      // Immediately take control — don't wait for old SW to be gone
      return self.skipWaiting();
    })
  );
});

/* ── Activate: clean up old caches ────────────────────────── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          // Cache Storage is shared by every app on this origin; only touch our own
          .filter(name => name.startsWith('wa-risk-') && name !== CACHE_NAME)
          .map(name => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => {
      // Take control of all clients immediately
      return self.clients.claim();
    })
  );
});

/* ── Fetch: Cache-first for app shell, network-first for CDN ─ */
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  // Cross-origin requests are the hazard-data lookups. Their URLs carry the
  // typed address and coordinates, so they must never be written to Cache
  // Storage. Let the browser handle them natively.
  if (url.origin !== self.location.origin) return;

  // Page navigations: network-first so a new release shows up on the next
  // load; fall back to the cached shell when offline.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone)));
            return response;
          }
          // A 404/5xx page from the host should not replace the app
          return caches.match(event.request).then(r => r || caches.match('./index.html') || response);
        })
        .catch(() => caches.match(event.request).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // For local app files: cache-first strategy
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) {
        // Serve from cache; refresh cache in background. waitUntil keeps the
        // worker alive until the refresh has been written.
        event.waitUntil(
          fetch(event.request).then(networkResponse => {
            if (networkResponse && networkResponse.status === 200) {
              const clone = networkResponse.clone();
              return caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
            }
          }).catch(() => {/* network unavailable — that's OK */})
        );

        return cachedResponse;
      }

      // Not in cache: fetch from network and cache
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200) return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      });
    })
  );
});

/* ── Message handler (for force-refresh from app) ─────────── */
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
