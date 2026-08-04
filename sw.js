importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');
// ÚNICO lugar donde vive la versión de la app. Las páginas ya no la repiten:
// registran './sw.js' con updateViaCache:'none' y el navegador detecta el
// cambio al ver que este archivo es distinto. Subir el número aquí y ya.
const VERSION = 'v112';
const CACHE = 'hes1217-' + VERSION;
const ARCHIVOS = [
  './index.html',
  './tablero.html',
  './captura_series.html',
  './admin.html',
  './comisiones.html',
  './actualizar_datos.html',
  './datos.js',
  // comisiones_datos.js se elimino el 1-ago-2026 (traia nombres, ventas y
  // montos de comision en un repo publico). Dejarlo aqui hacia que el service
  // worker intentara precachear un 404 en cada instalacion.
  './logo_odemas.png',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', e => {
  // Uno por uno y tolerando fallos: con addAll(), un solo archivo que dé 404
  // aborta la instalación completa y la app se queda sin service worker.
  e.waitUntil(
    caches.open(CACHE).then(c =>
      Promise.all(ARCHIVOS.map(u => c.add(u).catch(() => {})))
    )
  );
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
