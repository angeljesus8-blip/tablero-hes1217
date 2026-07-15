importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');
const CACHE = 'hes1217-v70';
const ARCHIVOS = [
  './index.html',
  './tablero.html',
  './captura_series.html',
  './admin.html',
  './datos.js',
  './logo_odemas.png',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks =>
      Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// HTML: network-first (siempre la versión más reciente si hay red)
// Otros assets: cache-first (imágenes, datos estáticos)
self.addEventListener('fetch', e => {
  if(new URL(e.request.url).origin !== location.origin) return;
  if(e.request.destination === 'document' || e.request.url.endsWith('.js') && !e.request.url.includes('cdn')) {
    // 'no-store' evita que el propio fetch() se sirva de la caché HTTP del
    // navegador (GitHub Pages manda Cache-Control con varios minutos) — sin esto,
    // "network-first" puede seguir devolviendo una versión vieja aunque haya red.
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
