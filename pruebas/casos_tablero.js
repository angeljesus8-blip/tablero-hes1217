/* ============================================================
   Qué se comprueba del tablero, en castellano
   ============================================================
   Este archivo NO se ejecuta solo: lo corre `humo_tablero.js` dentro del
   mismo contexto que el JavaScript del tablero, que es la única forma de
   ver sus funciones sin tocar el archivo de producción.

   Cada comprobación es una invariante que, rota, significa que alguien en
   la tienda ve un número falso o un botón que no debería existir.
   Al añadir una, deja escrito POR QUÉ importa.
   ============================================================ */

aplicarTodo(Object.assign(_deSupabase(JSON.parse(JSON.stringify(TIENDA))), { __sb:true }));
const app = document.getElementById('app');

// ── 1 · Las seis pantallas se pintan ────────────────────────
for(const f of ['inicio','promo','apartados','eol','resurtir','inv']){
  let err = null;
  try { filtroActivo = f; busqueda = ''; render(); } catch(e){ err = e.message; }
  ok('la sección "'+f+'" se pinta', !err && app.innerHTML.length > 40, err || 'salió vacía');
}

// ── 2 · Y el buscador, incluso sin resultados ───────────────
for(const q of ['prueba','900003','cliente','zzzz']){
  let err = null;
  try { filtroActivo = 'promo'; busqueda = q; render(); } catch(e){ err = e.message; }
  ok('buscar "'+q+'" no revienta', !err, err);
}
busqueda = '';

// ── 3 · Los cinco estados de existencia ─────────────────────
const esperado = { '900001':'hay', '900002':'hay', '900003':'piso',
                   '900004':'50', '900005':'no', '900006':'traer', '900007':'traer' };
for(const sku of Object.keys(esperado)){
  const k = estadoSku(sku).k;
  ok('SKU '+sku+' es "'+esperado[sku]+'"', k === esperado[sku], 'dice "'+k+'"');
}

/* Solo se vende lo que hay en bodega, o la de piso si está descontinuada.
   La exhibición de un producto ACTIVO no se vende — ver MAPA, cadena 5. */
ok('vendible = stock, o piso solo si es EOL',
   tieneExistencia_('900001') && tieneExistencia_('900004') &&
   !tieneExistencia_('900003') && !tieneExistencia_('900006'));

// ── 4 · El botón de apartar, solo donde toca ────────────────
filtroActivo = 'promo'; render();
const conBoton = [...new Set([...app.innerHTML.matchAll(/abrirApartado\('(\d+)'/g)].map(m => m[1]))];
ok('no se aparta lo que sí se puede vender',
   !conBoton.some(s => tieneExistencia_(s) && !APARTAR_EXCEPCION.has(s)),
   conBoton.filter(s => tieneExistencia_(s) && !APARTAR_EXCEPCION.has(s)).join(', '));
ok('no se aparta un descontinuado agotado',
   !conBoton.some(s => estadoSku(s).k === 'no'),
   conBoton.filter(s => estadoSku(s).k === 'no').join(', '));

// ── 5 · Los contadores no se contradicen ────────────────────
ok('Resurtir = sin nada + con pieza de piso',
   cuenta('resurtir') === AGOTADOS.length + RESURTIR.length,
   cuenta('resurtir') + ' vs ' + (AGOTADOS.length + RESURTIR.length));

/* Una promo sin fila de inventario tiene que entrar igual a la lista de
   pedidos: si no, se anuncia en el folleto y nadie la pide nunca. */
ok('la promo sin inventario entra a Resurtir',
   AGOTADOS.some(x => x.sku === '900099' && x.nuncaLlego));

/* El total del Assurant y la suma de las filas del equipo salen de la misma
   fuente desde v151. Si se separan, el gerente ve dos números distintos del
   mismo KPI y no sabe cuál reportar. */
const att = attTotal();
ok('Assurant: el total es la suma de las filas',
   filasLeaderboard().reduce((a, f) => a + f.total, 0) === att.c + att.s,
   filasLeaderboard().reduce((a, f) => a + f.total, 0) + ' vs ' + (att.c + att.s));

// Lo que cuenta la tarjeta de Apartados es trabajo pendiente, no historial
ok('Apartados cuenta solo los que faltan por entregar', cuenta('apartados') === 2,
   'dice ' + cuenta('apartados') + ', deberían ser 2 (ni el entregado ni el cancelado)');

// ── 6 · La sección y la búsqueda viajan en la URL ───────────
irA('resurtir');
ok('irA escribe la sección en la URL', location.hash === '#resurtir', location.hash);
busqueda = 'mate 11'; _urlAlDia();
ok('la búsqueda también va en la URL', /resurtir/.test(location.hash) && /mate/.test(location.hash),
   location.hash);
