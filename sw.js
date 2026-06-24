const CACHE = 'hes1217-v1';
const ARCHIVOS = [
  './captura_series.html',
  './logo_odemas.png',
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

// Cache-first para recursos propios; CDNs van por red normal
self.addEventListener('fetch', e => {
  if(new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
