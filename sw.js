/* Container & Truck Load Planner — service worker (offline support)
 * - App files (same origin): NETWORK FIRST with revalidation → always the latest version when online,
 *   cached copy when offline. This also prevents "stale file" problems after an update.
 * - Libraries / fonts (CDN): CACHE FIRST → available offline after the first visit.
 * Bump VERSION when files are added/removed so the precache list is refreshed.
 */
var VERSION = 'lp-4.1.7';
var APP = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
  'src/engine/geometry.js', 'src/engine/constraints.js', 'src/engine/cog.js', 'src/engine/packer.js', 'src/engine/multi.js', 'src/engine/index.js',
  'src/utils/units.js', 'src/utils/i18n.js', 'src/utils/icons.js', 'src/utils/dom.js', 'src/utils/io.js',
  'src/data/presets.js', 'src/data/vehicles.js', 'src/store.js',
  'src/components/viewer2d.js', 'src/components/vehicle3d.js', 'src/components/viewer3d.js', 'src/components/summary.js',
  'src/components/insights.js', 'src/components/containerSelect.js', 'src/components/cargoForm.js', 'src/components/skuLibrary.js',
  'src/components/shipment.js', 'src/components/checklist.js', 'src/components/tour.js', 'src/components/report.js', 'src/app.js',
  // user manual (opened from the ? button) — available offline too
  'manual.html', 'docs/LoadPlanner-Manual-TH.pdf', 'quickref.html', 'docs/LoadPlanner-QuickRef-TH.pdf',
  'docs/manual/m01-overview.png', 'docs/manual/m02-container.png', 'docs/manual/m03-cargo.png', 'docs/manual/m04-form.png', 'docs/manual/m05-drums.png', 'docs/manual/m06-top2d.png',
  'docs/manual/m07-manual.png', 'docs/manual/m08-steps.png', 'docs/manual/m09-checklist.png', 'docs/manual/m10-dn.png', 'docs/manual/m11-compare.png'
];
var CDN = [
  'https://cdn.jsdelivr.net/npm/three@0.147.0/build/three.min.js',
  'https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/controls/OrbitControls.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700&display=swap'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (cache) {
    return Promise.all(APP.map(function (u) {
      return fetch(u, { cache: 'no-cache' }).then(function (r) { if (r.ok) return cache.put(u, r); }).catch(function () {});
    }).concat(CDN.map(function (u) {
      return fetch(u, { mode: 'no-cors' }).then(function (r) { return cache.put(u, r); }).catch(function () {});
    })));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  var sameOrigin = url.origin === self.location.origin;
  var cdn = /cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(url.host);
  if (sameOrigin) {
    // network first (revalidated), fall back to cache; ignore the ?v= cache-busting query when matching
    e.respondWith(fetch(req, { cache: 'no-cache' }).then(function (r) {
      if (r.ok) { var copy = r.clone(); caches.open(VERSION).then(function (c) { c.put(url.pathname === '/' ? './' : req, copy); }); }
      return r;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (m) {
        return m || (req.mode === 'navigate' ? caches.match('index.html') : undefined);
      });
    }));
  } else if (cdn) {
    e.respondWith(caches.match(req).then(function (m) {
      return m || fetch(req).then(function (r) {
        var copy = r.clone();
        caches.open(VERSION).then(function (c) { c.put(req, copy); });
        return r;
      });
    }));
  }
});
