/* ============================================================
   Volver donde estabas — 8-ago-2026 (v152)
   ============================================================

   EL PROBLEMA
   -----------
   El asesor busca un producto en el tablero, toca «📲 Compartir», manda el
   precio por WhatsApp y regresa. Aparece en el MENÚ, con la búsqueda vacía, y
   tiene que encontrar el producto otra vez. Cada vez que manda un precio.

   No es un fallo del tablero: Android descarta la PWA cuando lleva un rato en
   segundo plano, y al volver el sistema la relanza desde `start_url`, que es
   `index.html`. La pantalla donde estaba nunca se guardó en ningún lado.

   Lo dispara cualquier cambio de app —WhatsApp, la cámara, la galería, una
   llamada—, y el propio tablero manda a WhatsApp desde cuatro botones. O sea
   que rompe justo el flujo de venta normal.

   LO QUE HACE ESTE ARCHIVO
   ------------------------
   1. En cada app: apunta dónde estás (página + sección + búsqueda) y hasta
      dónde habías bajado.
   2. En el menú: si venías de algo hace poco, te devuelve ahí.

   LAS DOS FORMAS DE NO ESTORBAR
   -----------------------------
   · Si tocas «‹ Menú» a propósito, se borra la marca. Salir por tu cuenta
     cuenta como haber terminado, y que te devuelva sería una trampa.
   · Si llegas con el botón ATRÁS del teléfono, tampoco te devuelve. Sin esto
     el «atrás» quedaría inservible: te regresaría a la misma pantalla de la
     que intentas salir, una y otra vez.

   Se carga con <script src="./continuidad.js"> ANTES del resto: así apunta la
   página aunque el script grande de la app falle.
   ============================================================ */
(function(){
  'use strict';

  var K = 'hes_donde';
  /* Media hora. Más arriba empieza a devolverte a la pantalla de ayer al abrir
     la app por la mañana, que ya no es "seguir", es estorbar. Más abajo no
     cubre una plática larga de WhatsApp con un cliente. */
  var VENTANA_MS = 30 * 60 * 1000;

  function pagina(){ return (location.pathname.split('/').pop() || 'index.html').toLowerCase(); }
  var ESTOY_EN_EL_MENU = pagina() === 'index.html' || pagina() === '';

  function leer(){
    try { return JSON.parse(localStorage.getItem(K) || 'null'); } catch(e){ return null; }
  }
  function olvidar(){
    try { localStorage.removeItem(K); } catch(e){}   // sin almacenamiento no había nada que olvidar
  }
  function guardar(){
    if(ESTOY_EN_EL_MENU) return;   // el menú no es un sitio donde uno "estaba"
    try {
      localStorage.setItem(K, JSON.stringify({
        url: pagina() + location.search + location.hash,
        y: Math.round(window.scrollY || 0),
        ts: Date.now()
      }));
    } catch(e){}   // cuota llena: se pierde la marca, no la sesión
  }

  // ── En una app: apuntar dónde estoy ─────────────────────────
  if(!ESTOY_EN_EL_MENU){
    /* Se LEE antes de guardar. Al revés —que es como estaba— el `guardar()` de
       arranque escribe el scroll actual, que siempre es 0 porque la página
       acaba de cargar, y pisa la altura que se venía a restaurar. La marca
       quedaba correcta y aun así el asesor volvía arriba del todo. */
    var d = leer();
    var aqui = pagina() + location.search + location.hash;
    var mismaPantalla = !!d && d.url === aqui && Date.now() - d.ts < VENTANA_MS;
    var alturaGuardada = mismaPantalla ? (d.y || 0) : 0;

    guardar();
    /* Se apunta al OCULTARSE, que es el único momento garantizado: cuando
       Android mata la app no hay aviso, y `unload` no llega en móvil. */
    document.addEventListener('visibilitychange', function(){
      if(document.visibilityState === 'hidden') guardar();
    });
    window.addEventListener('pagehide', guardar);
    // Y cada pocos segundos mientras se usa, para que el scroll y la sección
    // no se queden viejos si el proceso muere sin pasar por 'hidden'.
    setInterval(function(){ if(document.visibilityState === 'visible') guardar(); }, 5000);

    /* Salir al menú a propósito borra la marca. En captura porque el enlace se
       pinta dentro del HTML, se escucha en fase de captura sobre el documento:
       corre antes de que el navegador siga el enlace. */
    document.addEventListener('click', function(e){
      var a = e.target && e.target.closest && e.target.closest('a[href*="index.html"]');
      if(a) olvidar();
    }, true);
    window.HES_salirAlMenu = olvidar;   // por si alguna app navega con JS

    // Devolver el scroll. El tablero pinta en varios pasos (caché primero, nube
    // después), así que se intenta un rato en vez de una sola vez.
    if(alturaGuardada > 0){
      var intentos = 0;
      var t = setInterval(function(){
        intentos++;
        if(document.body && document.body.scrollHeight > alturaGuardada + window.innerHeight){
          window.scrollTo(0, alturaGuardada);
          clearInterval(t);
        } else if(intentos > 20){ clearInterval(t); }   // nunca creció tanto: se queda arriba
      }, 100);
    }
    return;
  }

  // ── En el menú: devolver a donde estaba ─────────────────────
  var d = leer();
  if(!d || !d.url) return;
  if(Date.now() - d.ts > VENTANA_MS){ olvidar(); return; }
  if(/^index\.html/.test(d.url)) return;   // nunca reenviar al propio menú

  /* Sin sesión, al menú. Las apps sin `hes_store` no enseñan datos: muestran un
     «vuelve a entrar» con un enlace. Devolver ahí a alguien cuya sesión se cayó
     sería cambiarle el login por un callejón sin salida. */
  try {
    if(!localStorage.getItem('hes_store')){ olvidar(); return; }
  } catch(e){ return; }   // sin localStorage no se puede saber: mejor el menú

  /* El botón ATRÁS del teléfono no debe reabrir lo que se acaba de cerrar. */
  try {
    var nav = performance.getEntriesByType('navigation')[0];
    if(nav && nav.type === 'back_forward') return;
  } catch(e){}   // navegador sin esta API: se prefiere devolver a no devolver

  // `replace` y no `href`: así el «atrás» lleva a donde el usuario espera y no
  // deja el menú atrapado entre dos entradas del historial.
  location.replace(d.url);
})();
