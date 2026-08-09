importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');
// ÚNICO lugar donde vive la versión de la app. Las páginas ya no la repiten:
// registran './sw.js' con updateViaCache:'none' y el navegador detecta el
// cambio al ver que este archivo es distinto. Subir el número aquí y ya.
const VERSION = 'v162';
const CACHE = 'hes1217-' + VERSION;
const ARCHIVOS = [
  './index.html',
  './tablero.html',
  './captura_series.html',
  './admin.html',
  './comisiones.html',
  './horarios.html',
  './actualizar_datos.html',
  './datos.js',
  // Sin esto, la pieza que devuelve al asesor donde estaba sería justo la que
  // falta cuando no hay red — que es cuando más se nota volver al menú.
  './continuidad.js',
  // La fuente va al precache: si no, el primer arranque sin red dibuja el
  // tablero con otra letra, que es justo lo que se quiso evitar al traerla
  // del CDN al repo (8-ago-2026).
  './fuentes/Montserrat.woff2',
  // comisiones_datos.js se elimino el 1-ago-2026 (traia nombres, ventas y
  // montos de comision en un repo publico). Dejarlo aqui hacia que el service
  // worker intentara precachear un 404 en cada instalacion.
  './logo_odemas.png',
  // horarios.html lo mete al Excel que exporta el gerente; sin él la exportación
  // sale sin logo y sin avisar (el fetch va dentro de un try/catch).
  './logo_huawei.jpg',
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

/* Responde qué versión está sirviendo. Lo pregunta el pie del tablero.
   Se hace así, y no escribiendo el número en cada página, porque este archivo es
   el único sitio donde vive la versión: dos copias del mismo número acaban
   separándose y entonces el indicador miente, que es peor que no tenerlo. */
self.addEventListener('message', e => {
  if (e.data === 'version' && e.source) e.source.postMessage({ version: VERSION });
});

// HTML: network-first (siempre la versión más reciente si hay red)
// Otros assets: cache-first (imágenes, datos estáticos)
self.addEventListener('fetch', e => {
  if(new URL(e.request.url).origin !== location.origin) return;
  if(e.request.destination === 'document' || e.request.url.endsWith('.js') && !e.request.url.includes('cdn')) {
    // 'no-store' evita que el propio fetch() se sirva de la caché HTTP del
    // navegador (GitHub Pages manda Cache-Control con varios minutos) — sin esto,
    // "network-first" puede seguir devolviendo una versión vieja aunque haya red.
    /* Con LÍMITE DE ESPERA (8-ago-2026). Antes se esperaba a la red sin tope:
       dentro del centro comercial, relanzar la app eran varios segundos de
       pantalla en blanco AUNQUE estuviera entera en la caché del teléfono. Y al
       volver de WhatsApp eso pasa todo el día.

       Pasados 2.5 s se sirve lo guardado y la red sigue corriendo: si contesta
       después, la respuesta igual se guarda para la próxima. Se pierde como
       mucho una recarga de frescura; se gana que la app siempre abra. */
    e.respondWith((async () => {
      const guardada = caches.match(e.request);

      const red = fetch(e.request, { cache: 'no-store' }).then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      });
      // El fallo de red no debe ganar la carrera: si no hay señal, `red` se
      // rechaza al instante y sin esto serviría el rechazo en vez de la caché.
      const redOk = red.catch(() => new Promise(() => {}));

      const espera = new Promise(r => setTimeout(r, 2500));
      const rapido = await Promise.race([redOk, espera.then(() => guardada)]);
      if (rapido) return rapido;

      // Ni red a tiempo ni copia guardada: no queda más que esperar a la red.
      try { return await red; }
      catch (err) { return (await guardada) || Response.error(); }
    })());
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
