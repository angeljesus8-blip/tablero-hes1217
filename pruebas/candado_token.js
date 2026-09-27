/* ============================================================
   La venta y los apartados viajan con el token, y el nombre se escapa
   ============================================================
   27-sep-2026. Corre en cada commit desde `verificar.py`.

   Hasta v289, `venta_guardar`, `apartados_lista` y `tablero_todo` contestaban
   a cualquiera que tuviera la clave publicable, y esa clave va en el HTML de
   un repo público. Se podían meter ventas, y leer nombre y teléfono de cada
   cliente con apartado. Y el nombre del vendedor de una venta así se pintaba
   sin escapar en el leaderboard del tablero, en todos los celulares.
   Ver supabase_candado.sql.

   Lo que se prueba aquí es el lado del cliente:
     1 · Captura manda el token con la venta, pero NO lo guarda en la cola.
     2 · El tablero lo manda al pedir `tablero_todo` y `apartados_lista`.
     3 · `apartados_ok: false` se enseña como carga fallida, no como «no hay».
     4 · Un nombre de vendedor con HTML dentro sale como texto.

   ⚠️ ESTA PRUEBA PASA AUNQUE EL SQL NO ESTÉ APLICADO. El SQL va ANTES de
   publicar: una app que manda `p_token` a una función que aún no lo tiene
   recibe PGRST202 y deja de guardar ventas.
   ============================================================ */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const raiz = path.join(__dirname, '..');
const fallos = [];
const ok = (t, c, extra) => { if(!c) fallos.push(t + (extra ? ' -> ' + extra : '')); };
const TOKEN = 'tok-candado-1217';

(async () => {

  /* ── 1 · Captura ───────────────────────────────────────────────────── */
  {
    const { crearEntorno } = require('./dom.js');
    const html = fs.readFileSync(path.join(raiz, 'captura_series.html'), 'utf8');
    const llamadas = [];
    const fetchFalso = (url, op) => {
      const fn = String(url).split('/rpc/')[1] || '';
      let body = {}; try{ body = JSON.parse((op && op.body) || '{}'); }catch(e){}
      llamadas.push({ fn, body });
      const r = fn === 'venta_guardar' ? { ok:true, id:1 } : [];
      return Promise.resolve({ ok:true, status:200, json:() => Promise.resolve(r),
                               text:() => Promise.resolve(JSON.stringify(r)) });
    };
    const ent = crearEntorno({
      html, ruta:'/t/captura_series.html', fetch: fetchFalso,
      ls: { hes1217_store: JSON.stringify({ store_id:'1217', nombre:'Prueba', gas_url:'',
                                            gas_token: TOKEN, vendedores:['Prueba Uno'] }),
            hes1217_empleado: JSON.stringify({ empno:'1', nombre:'Prueba Uno', puesto:'gerente' }) }
    });
    ok('Captura arranca', !ent.err, ent.err);
    if(!ent.err){
      const cuerpo = JSON.parse(ent.correr(`JSON.stringify(_sbCuerpo({
        serie:'S-1', sku:'900001', desc:'PRUEBA', precio:'100', vend:'Prueba Uno',
        seguro:true, fecha:'27/9/2026', hora:'1:00 p', id:'c1' }))`));
      /* Si el token se guardara en el cuerpo, las ventas de la cola llevarían
         una copia del token de cuando se capturaron: al cambiarlo, esas ventas
         no entrarían nunca. */
      ok('el cuerpo que va a la cola NO lleva el token', !('p_token' in cuerpo), JSON.stringify(cuerpo));

      llamadas.length = 0;
      await ent.correr('_sbInsertar(' + JSON.stringify(cuerpo) + ')');
      const v = llamadas.filter(l => l.fn === 'venta_guardar')[0];
      ok('la venta sale con el token de la sesión', v && v.body.p_token === TOKEN,
         JSON.stringify(v && v.body));
      ok('y con todo lo que ya llevaba', v && v.body.p_serie === 'S-1' && v.body.p_quien === '1',
         JSON.stringify(v && v.body));

      /* Una venta vieja, ya en la cola desde v289, sin token: al subir lo lleva. */
      llamadas.length = 0;
      await ent.correr(`_sbInsertar({ p_store:'1217', p_serie:'S-VIEJA' })`);
      const w = llamadas.filter(l => l.fn === 'venta_guardar')[0];
      ok('una venta de la cola de antes sube con el token', w && w.body.p_token === TOKEN,
         JSON.stringify(w && w.body));
    }
  }

  /* ── 2-4 · Tablero ─────────────────────────────────────────────────── */
  {
    const { domFalso, TIENDA } = require('./entorno.js');
    const html = fs.readFileSync(path.join(raiz, 'tablero.html'), 'utf8');
    const js = (html.match(/<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?<\/script>/g) || [])
      .map(b => b.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')).join('\n;\n');
    domFalso();
    Object.assign(global, require('../nombres.js'));
    localStorage.setItem('hes1217_store', JSON.stringify({ store_id:'1217', nombre:'Prueba',
                                                          gas_url:'', gas_token: TOKEN }));
    try{
      vm.runInThisContext(js, { filename:'tablero.html' });
    }catch(e){ ok('el tablero arranca', false, e && e.message); }

    const llamadas = [];
    let respuesta = null;
    global.fetch = (url, op) => {
      const fn = String(url).split('/rpc/')[1] || '';
      let body = {}; try{ body = JSON.parse((op && op.body) || '{}'); }catch(e){}
      llamadas.push({ fn, body });
      const r = fn === 'tablero_todo' ? respuesta : fn === 'apartados_lista' ? TIENDA.apartados : [];
      return Promise.resolve({ ok:true, status:200, json:() => Promise.resolve(r) });
    };
    const de = fn => llamadas.filter(l => l.fn === fn)[0];

    respuesta = JSON.parse(JSON.stringify(TIENDA));
    await vm.runInThisContext('cargarTodoSupabase()');
    ok('tablero_todo se pide con el token', de('tablero_todo') && de('tablero_todo').body.p_token === TOKEN,
       JSON.stringify(de('tablero_todo')));
    ok('con el servidor de antes (sin apartados_ok) los apartados cargan como siempre',
       vm.runInThisContext('CARGAS.apartados') === 'ok' && vm.runInThisContext('APARTADOS.length') === 4,
       vm.runInThisContext('CARGAS.apartados') + ' / ' + vm.runInThisContext('APARTADOS.length'));

    await vm.runInThisContext('cargarApartadosNube()');
    ok('apartados_lista se pide con el token', de('apartados_lista') && de('apartados_lista').body.p_token === TOKEN,
       JSON.stringify(de('apartados_lista')));

    /* 3 · El servidor no aceptó el token. Lo que NO puede pasar es que la
       pestaña diga «no hay apartados»: el asesor le negaría el equipo al
       cliente. Tiene que quedar como carga fallida, y los de antes, a la vista. */
    respuesta = Object.assign(JSON.parse(JSON.stringify(TIENDA)), { apartados: [], apartados_ok: false });
    await vm.runInThisContext('cargarTodoSupabase()');
    ok('sin permiso, los apartados quedan como carga fallida', vm.runInThisContext('CARGAS.apartados') === 'error',
       vm.runInThisContext('CARGAS.apartados'));
    ok('y no se borran los que ya estaban en pantalla', vm.runInThisContext('APARTADOS.length') === 4,
       String(vm.runInThisContext('APARTADOS.length')));

    /* 4 · El cebo: un vendedor con HTML dentro, como el que podía meter
       cualquiera con venta_guardar abierta. */
    respuesta = Object.assign(JSON.parse(JSON.stringify(TIENDA)), {
      ventas_hoy: [ { vendedor:'<img src=x onerror=alert(1)> Uno', con_seguro:1, sin_seguro:0 } ] });
    await vm.runInThisContext('cargarTodoSupabase()');
    // Desplegada: plegada no pinta las filas, y el cebo pasaría sin probarse.
    const eq = vm.runInThisContext('EQUIPO_ABIERTO = true; equipoHtml()');
    ok('el nombre del vendedor sale como texto, no como HTML',
       eq.indexOf('<img') < 0 && eq.indexOf('&lt;img') >= 0, eq.slice(0, 300));
    ok('nombreCorto no revienta sin nombre', vm.runInThisContext('nombreCorto(null)') === '');
  }

  if(fallos.length){
    console.error('FALLA · candado_token:\n  - ' + fallos.join('\n  - '));
    process.exit(1);
  }
  console.log('candado: la venta y los apartados viajan con el token (la cola no lo guarda), ' +
              'el «sin permiso» no se lee como «no hay apartados», y el nombre del vendedor sale escapado');
})();
