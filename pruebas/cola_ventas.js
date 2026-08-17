/* ============================================================
   La venta llega a Supabase aunque el Apps Script no conteste
   ============================================================
   Corre en cada commit desde `verificar.py`.

   Existe por el cambio del 17-ago-2026 (fase 5). Hasta v168 la venta iba al
   Sheet y solo llegaba a Supabase SI el Sheet confirmaba. Como el stock del
   tablero se calcula descontando de la tabla `ventas` DE SUPABASE, un Apps
   Script caído significaba inventario que no descuenta — sin un solo error.

   Las dos comprobaciones de aquí son las que, rotas, no dan ninguna señal:

     1. Una venta capturada sin red acaba en la cola de Supabase.
     2. Lo que quedó en la cola VIEJA se rescata al actualizar.

   La 2 solo puede fallar una vez, el día que cada teléfono pasa a v169, y para
   entonces ya no hay forma de saber qué se perdió: son ventas que existen en la
   hoja y no en Supabase, o sea stock que no baja y comisiones que no se pagan.

   `fetch` rechaza SIEMPRE en este entorno, que es justo el escenario que
   importa: si la venta llega igual a la cola, la inversión está bien hecha.
   ============================================================ */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'captura_series.html'), 'utf8');

const bloques = html.match(/<script[^>]*>[\s\S]*?<\/script>/g) || [];
const js = bloques
  .filter(b => !/\ssrc=/.test(b.slice(0, b.indexOf('>'))))
  .filter(b => !/type="module"/.test(b.slice(0, b.indexOf('>'))))
  .map(b => b.slice(b.indexOf('>') + 1, b.lastIndexOf('</script>')))
  .join('\n;\n');

const EQUIPO = ['Arnulfo Gonzalez Arrieta', 'Miguel Angel Garcia Gutierrez'];
const STORE  = { store_id:'1217', nombre:'Angelopolis', gas_url:'https://gas.example/exec',
                 gas_token:'t', vendedores:EQUIPO };
const EMP    = { empno:'2', nombre:'Miguel Angel Garcia Gutierrez', puesto:'asesor' };

/* ── El DOM respeta el ORDEN del documento ───────────────────────────────
   El DOM falso de las otras pruebas devuelve un elemento para cualquier id, y
   eso esconde una clase entera de fallo: tocar durante la carga un elemento
   que se pinta MÁS ABAJO que el <script>.

   Pasó el 17-ago-2026 al escribir la pantalla de corregir ventas: un
   `addEventListener` a nivel superior sobre `$('edSku')`, cuyo <div> está 30
   líneas DESPUÉS del cierre del script. En el navegador eso es null y
   `null.addEventListener` tumbaba la captura entera al arrancar — no el modal,
   toda la pantalla. Con el DOM permisivo las pruebas decían "todo en orden".

   No basta con comprobar que el id exista en el HTML: `edSku` existe. Hay que
   comparar POSICIONES. Durante la carga, un id que aparece después de donde
   empieza el script principal todavía no está en el documento. Al terminar la
   carga se levanta la bandera y ya existen todos, como en el navegador. */
const POS_ID = new Map();
for(const m of html.matchAll(/\bid="([^"]+)"/g)){
  if(!POS_ID.has(m[1])) POS_ID.set(m[1], m.index);
}
// El bloque de <script> más largo es el principal; los paneles van tras él.
const POS_SCRIPT = (() => {
  let mejor = 0, largo = -1;
  for(const m of html.matchAll(/<script(?![^>]*\ssrc=)(?![^>]*type="module")[^>]*>/g)){
    const fin = html.indexOf('</script>', m.index);
    if(fin - m.index > largo){ largo = fin - m.index; mejor = m.index; }
  }
  return mejor;
})();

function arrancar(extraLS){
  const LS = Object.assign({
    hes_store: JSON.stringify(STORE),
    hes_empleado: JSON.stringify(EMP)
  }, extraLS || {});
  const els = {};
  let cargando = true;          // se baja en cuanto termina de correr el script
  function el(id){
    // Durante la carga, lo que se pinta por debajo del script todavía no existe.
    if(cargando && POS_ID.has(id) && POS_ID.get(id) > POS_SCRIPT) return null;
    if(!els[id]) els[id] = (function(){
      /* `classList` de verdad, con un Set. Con los `add(){}` vacíos de antes no
         se puede comprobar COMPORTAMIENTO —si un panel se abrió—, solo que una
         función devuelva lo esperado. Y el fallo del 17-ago-2026 fue justo ese:
         `puedeVerVentas_()` daba true y el botón igual no abría nada, porque el
         handler no la llamaba. Probar la función habría dado verde. */
      const clases = new Set();
      return {
      id, style:{}, dataset:{}, value:'', textContent:'', children:[],
      innerHTML:'',
      classList:{ add:c=>clases.add(c), remove:c=>clases.delete(c),
                  toggle:(c,on)=>{ if(on===undefined){ clases.has(c)?clases.delete(c):clases.add(c); }
                                   else { on ? clases.add(c) : clases.delete(c); } },
                  contains:c=>clases.has(c) },
      querySelectorAll:()=>[], addEventListener(){}, appendChild(){},
      closest:()=>null, focus(){}, remove(){}, onclick:null,
      insertBefore(){}, scrollIntoView(){}
      };
    })();
    return els[id];
  }
  const caja = {
    console,
    location:{ href:'', search:'', hash:'', pathname:'/t/captura_series.html', replace(){}, reload(){} },
    navigator:{ serviceWorker:{ addEventListener(){}, ready:{ then(){ return { catch(){} }; } },
                                register(){ return { catch(){} }; } } },
    document:{ getElementById: el, querySelectorAll:()=>[], querySelector:()=>null,
      createElement:()=>el('t'+Math.random()), head: el('head'), body: el('body'),
      readyState:'complete', addEventListener(){} },
    localStorage:{ getItem: k => (k in LS ? LS[k] : null),
      setItem:(k,v)=>{ LS[k] = String(v); }, removeItem: k => { delete LS[k]; } },
    sessionStorage:{ getItem:()=>null, setItem(){}, removeItem(){} },
    // El escenario que importa: la nube no contesta, ni el GAS ni Supabase.
    fetch: () => Promise.reject(new Error('sin red')),
    alert:()=>{}, confirm:()=>true, prompt:()=>null,
    setInterval:()=>0, clearInterval:()=>{}, setTimeout:(f)=>{ if(typeof f==='function') f(); return 0; },
    clearTimeout:()=>{},
    scrollTo:()=>{}, addEventListener:()=>{}, removeEventListener:()=>{},
    AbortController: class { constructor(){ this.signal = {}; } abort(){} },
    Blob: class {}, URL:{ createObjectURL:()=>'', revokeObjectURL:()=>{} },
    XMLHttpRequest: class { open(){} send(){} setRequestHeader(){} },
    Image: class {}, FileReader: class {}, requestAnimationFrame:()=>0,
    URLSearchParams, TextEncoder, TextDecoder, Date, JSON, Math, RegExp,
    Promise, Array, Object, String, Number, Boolean, Error, Set, Map, isNaN, parseFloat, parseInt,
    encodeURIComponent, decodeURIComponent, btoa: s => Buffer.from(s,'binary').toString('base64'),
  };
  caja.window = caja; caja.globalThis = caja;
  vm.createContext(caja);
  let err = null;
  try{ vm.runInContext(js, caja, { filename:'captura.js' }); }catch(e){ err = e.message; }
  cargando = false;   // documento completo: a partir de aquí existe todo
  /* Para tocar las variables del script. Las `let`/`const` de nivel superior no
     aparecen en el objeto global —solo `var` y las funciones—, pero sí viven en
     el ámbito léxico del contexto, que otro `runInContext` sí alcanza. */
  const correr = (codigo) => vm.runInContext(codigo, caja, { filename:'prueba.js' });
  return { err, LS, els, caja, correr,
           colaSb: () => { try{ return JSON.parse(LS['hes1217_sb_pend'] || '[]'); }catch(e){ return []; } },
           colaGas: () => { try{ return JSON.parse(LS['hes1217_pending'] || '[]'); }catch(e){ return []; } } };
}

const fallos = [];
const ok = (t, c, extra) => { if(!c) fallos.push(t + (extra ? ' -> ' + extra : '')); };

/* ── 1 · Capturar sin red deja la venta en la cola de Supabase ──────────── */
{
  const s = arrancar();
  ok('la pantalla arranca', !s.err, s.err);
  if(!s.err){
    s.els['serie'].value  = 'SERIE-PRUEBA-1';
    s.els['sku'].value    = '900001';
    s.els['precio'].value = '4999';
    s.els['desc'].value   = 'Equipo de prueba';
    s.caja.setVend(EQUIPO[1]);            // ya eligió su nombre
    s.els['btnAdd'].onclick();            // abre el modal del seguro
    s.caja.finalizarVenta(true);          // "con Assurant"

    const cola = s.colaSb();
    ok('la venta entra en la cola de Supabase aunque no haya red',
       cola.length === 1, 'la cola quedó con ' + cola.length);
    if(cola.length){
      ok('y con la serie correcta', cola[0].p_serie === 'SERIE-PRUEBA-1', cola[0].p_serie);
      /* El seguro es lo que decide el Assurant. `false` y `null` NO son lo
         mismo: null es "no se sabe" y hunde el attach si se confunden. */
      ok('y con el seguro tal cual se marcó', cola[0].p_seguro === true, String(cola[0].p_seguro));
      ok('y con el id de captura, que es lo único que permite borrarla luego',
         !!cola[0].p_captura_id, 'llegó vacío');
    }
    /* Y a la hoja NO va nada (fase 6, v170). Se comprueba explícitamente: si
       alguien reintrodujera la doble escritura, volvería a haber dos verdades
       —que es lo que esta migración vino a resolver— y nada daría error. */
    ok('y a la hoja ya no se le manda nada', s.colaGas().length === 0,
       'la cola del Sheet quedó con ' + s.colaGas().length);
  }
}

/* ── 2 · Lo que quedó en la cola vieja se rescata ───────────────────────── */
{
  const viejas = [
    { id:'i1', fecha:'16/8/2026', hora:'12:00', serie:'VIEJA-1', sku:'900001',
      desc:'Pendiente de ayer', precio:'1999', vend:EQUIPO[0], seguro:false },
    { id:'i2', fecha:'16/8/2026', hora:'12:05', serie:'VIEJA-2', sku:'900002',
      desc:'Otra pendiente', precio:'2999', vend:EQUIPO[0], seguro:true }
  ];
  const s = arrancar({ hes1217_pending: JSON.stringify(viejas) });
  ok('la pantalla arranca con la cola vieja', !s.err, s.err);
  if(!s.err){
    const cola = s.colaSb();
    ok('las capturas de la cola vieja se rescatan a Supabase',
       cola.length === 2, 'se rescataron ' + cola.length + ' de 2');
    ok('conservando la serie', cola.length === 2 && cola[0].p_serie === 'VIEJA-1');
    /* Sin esto, esas ventas subirían solo a la hoja: stock que no baja y
       comisiones que no se pagan, sin ningún aviso. */
    ok('y la marca queda puesta para no reencolarlas en cada arranque',
       !!s.LS['hes1217_cola_a_supabase']);
  }
}

/* ── 3 · Y no se rescatan dos veces ─────────────────────────────────────── */
{
  const viejas = [{ id:'i1', fecha:'16/8/2026', hora:'12:00', serie:'VIEJA-1', sku:'900001',
                    desc:'Pendiente', precio:'1999', vend:EQUIPO[0], seguro:false }];
  const s = arrancar({ hes1217_pending: JSON.stringify(viejas),
                       hes1217_cola_a_supabase: '1755400000000' });
  if(!s.err){
    ok('con la marca ya puesta, la cola vieja no se vuelve a encolar',
       s.colaSb().length === 0, 'se encolaron ' + s.colaSb().length);
  }
}

/* ── 4 · La prioridad de precio, en un solo sitio ───────────────────────
   `precioDeCatalogo_` se extrajo el 17-ago-2026 para que la captura y la
   corrección de una venta no tengan dos ideas del precio bueno. Al extraerla se
   tocó `aplicarProducto`, que es el camino de escanear Y el de teclear, y no lo
   cubría ninguna prueba.

   La regla es la de la cadena 3 del MAPA y se repite en el tablero y en el
   Apps Script: EOL al 50% manda sobre promoción, y promoción sobre regular.
   Invertirla cobraría de más a un cliente con el equipo en la mano. */
{
  const s = arrancar();
  if(!s.err){
    const hoy = new Date();
    const iso = hoy.getFullYear() + '-' + String(hoy.getMonth()+1).padStart(2,'0')
              + '-' + String(hoy.getDate()).padStart(2,'0');
    const FICHA = "({ s:'900001', d:'Equipo de prueba', p:10000 })";

    // Sin nada: el regular
    ok('sin promo ni EOL se cobra el precio regular',
       s.correr('precioDeCatalogo_(' + FICHA + ').precio') === '10000');

    // Con promo vigente: la promo
    s.correr("PROMOS['900001'] = { pp:'8500', d1:'" + iso + "', d2:'" + iso + "' };");
    ok('con promoción vigente se cobra la promoción',
       s.correr('precioDeCatalogo_(' + FICHA + ').precio') === '8500',
       s.correr('precioDeCatalogo_(' + FICHA + ').precio'));

    // Con las dos a la vez: manda el EOL, NUNCA la promo
    s.correr("EOL_VENTA['900001'] = 5000;");
    ok('con EOL y promoción a la vez manda el EOL al 50%',
       s.correr('precioDeCatalogo_(' + FICHA + ').precio') === '5000',
       s.correr('precioDeCatalogo_(' + FICHA + ').precio'));
    ok('y se sabe de dónde salió el precio, para poder decirlo en pantalla',
       s.correr('precioDeCatalogo_(' + FICHA + ').motivo') === 'eol',
       s.correr('precioDeCatalogo_(' + FICHA + ').motivo'));
  }
}

/* ── 5 · La pieza de exhibición viaja hasta la nube ─────────────────────
   El interruptor decide DOS cosas: qué precio se cobra y de qué contador se
   descuenta la pieza. Si `exhibicion` se cayera en cualquier escalón —del
   formulario al item, del item a la cola, de la cola al cuerpo de la RPC— la
   venta se guardaría como de bodega: descontaría una caja que sigue en el
   almacén y dejaría el aparador ocupado por una pieza que ya salió.

   Es la cadena 1 del MAPA otra vez: lo que no se nombra en cada escalón se
   pierde en silencio. Por eso se comprueba el extremo final, el cuerpo que
   sale hacia Supabase, y no los intermedios. */
{
  const s = arrancar();
  if(!s.err){
    s.els['serie'].value  = 'SERIE-EXHIB-1';
    s.els['sku'].value    = '900001';
    s.els['precio'].value = '2500';
    s.els['desc'].value   = 'EOL de piso';
    s.caja.setVend(EQUIPO[1]);
    s.caja.document.getElementById('exhChk').checked = true;   // «es la de exhibición»
    s.els['btnAdd'].onclick();
    s.caja.finalizarVenta(false);

    const cola = s.colaSb();
    ok('la marca de exhibición llega al cuerpo que va a Supabase',
       cola.length === 1 && cola[0].p_de_exhibicion === true,
       cola.length ? String(cola[0].p_de_exhibicion) : 'la cola quedó vacía');
  }
}

/* ── 6 · Y una venta normal NO se marca ─────────────────────────────────
   La otra mitad, y no es simétrica de la de arriba: si esto fallara, TODAS las
   ventas descontarían del aparador en vez de la bodega. El stock de almacén
   dejaría de bajar nunca y el tablero prometería cajas que no existen. */
{
  const s = arrancar();
  if(!s.err){
    s.els['serie'].value  = 'SERIE-NORMAL-1';
    s.els['sku'].value    = '900001';
    s.els['precio'].value = '5000';
    s.caja.setVend(EQUIPO[1]);
    s.els['btnAdd'].onclick();
    s.caja.finalizarVenta(true);

    const cola = s.colaSb();
    ok('una venta normal se manda explícitamente como NO de exhibición',
       cola.length === 1 && cola[0].p_de_exhibicion === false,
       cola.length ? String(cola[0].p_de_exhibicion) : 'la cola quedó vacía');
  }
}

/* Los bloques que siguen tocan handlers `async` (el onclick de «Ventas del
   día» hace `await flushSupabase()` antes de abrir el panel), así que hay que
   esperarlos de verdad. Comprobar justo después de pulsar daba un falso rojo:
   el panel todavía no se había abierto. */
(async function(){

/* ── 7 · Quien puede corregir, puede llegar a la lista ──────────────────
   El ✏️ vive DENTRO del panel «Ventas del día», que hasta v175 solo abría la
   persona designada en `hoja_auth`. O sea que el subgerente tenía permiso de
   corregir —el servidor se lo concede— y ninguna forma de llegar al botón.
   Una puerta daba el permiso y la otra lo bloqueaba, sin decir nada.

   Se prueban las dos direcciones: sin ellas, "arreglarlo" abriendo el panel a
   todos pasaría igual de desapercibido. */
{
  const sub = { empno:'973345', nombre:EQUIPO[1], puesto:'Subgerente de Tienda' };
  const s = arrancar({ hes_empleado: JSON.stringify(sub) });
  if(!s.err){
    ok('el subgerente sí puede abrir Ventas del día',
       s.caja.document.getElementById('btnCsv').style.display !== 'none',
       'quedó display=' + s.caja.document.getElementById('btnCsv').style.display);

    /* Y AL PULSARLO tiene que abrirse. Ver el botón y poder usarlo son dos
       preguntas distintas, y el 17-ago-2026 se cambió solo la primera: el
       gerente veía «Ventas del día» y al tocarlo le decía que no tenía permiso.

       SE PULSA EL BOTÓN DE VERDAD, no se llama a `puedeVerVentas_()`. Esa
       comprobación habría dado verde con el fallo puesto, porque la función
       estaba bien — lo que no la usaba era el handler. */
    await s.caja.document.getElementById('btnCsv').onclick();
    ok('y al pulsarlo se abre la lista, no un aviso de permiso',
       s.caja.document.getElementById('vdPanel').classList.contains('show'));
  }
}
{
  // Asesor que NO es el de `hoja_auth`: sigue sin ver la lista, como siempre.
  const ases = { empno:'747851', nombre:EQUIPO[0], puesto:'Asesor de Tienda' };
  const s = arrancar({ hes_empleado: JSON.stringify(ases) });
  if(!s.err){
    ok('y un asesor cualquiera sigue sin verla',
       s.caja.document.getElementById('btnCsv').style.display === 'none',
       'quedó display=' + s.caja.document.getElementById('btnCsv').style.display);
  }
}

/* ── 8 · Las entregas se distinguen en «Ventas del día» ─────────────────
   Una entrega de preventa o traspaso NO es una venta de hoy: el cliente pagó
   semanas antes, no cuenta para el Assurant, no descuenta stock y no se puede
   corregir con el ✏️. Sin distintivo, quien cuadra la caja contra el POS busca
   renglones que no va a encontrar.

   Se comprueba también lo que NO debe pasar: que la venta normal siga siendo
   la única con ✏️. Las entregas no tienen `captura_id` —las crea
   `apartado_entregar`, no la app— y por eso el botón no les sale; si algún día
   lo tuvieran, el servidor las rechaza igual, pero el asesor se llevaría el
   viaje en balde. */
{
  const sub = { empno:'973345', nombre:EQUIPO[1], puesto:'Subgerente de Tienda' };
  const s = arrancar({ hes_empleado: JSON.stringify(sub) });
  if(!s.err){
    s.correr(`
      _vdVentas = [
        { serie:'S-NORMAL', sku:'900001', desc:'Venta normal', precio:'1000',
          vend:'X', hora:'10:00', captura_id:'i1', foto:false, entrega:'' },
        { serie:'S-PREVENTA', sku:'900002', desc:'Entrega de preventa', precio:'2000',
          vend:'Y', hora:'11:00', captura_id:'', foto:false, entrega:'preventa' },
        { serie:'S-TRASPASO', sku:'900003', desc:'Entrega de traspaso', precio:'3000',
          vend:'Z', hora:'12:00', captura_id:'', foto:false, entrega:'traspaso' }
      ];
      _vdFecha = new Date();
      pintarVentasDia();
    `);
    const lista = s.caja.document.getElementById('vdLista').innerHTML || '';

    ok('la entrega de preventa se marca', lista.indexOf('preventa') >= 0);
    ok('y la de traspaso también, con su propia etiqueta',
       lista.indexOf('traspaso') >= 0);
    ok('exactamente dos filas llevan distintivo, no las tres',
       (lista.match(/vd-ent/g) || []).length === 2,
       'salieron ' + (lista.match(/vd-ent/g) || []).length);
    ok('solo la venta normal ofrece el ✏️ de corregir',
       (lista.match(/abrirEditarVenta/g) || []).length === 1,
       'salieron ' + (lista.match(/abrirEditarVenta/g) || []).length);

    const pie = s.caja.document.getElementById('vdAyuda').innerHTML || '';
    ok('y el pie dice cuántas no están en el corte de hoy',
       pie.indexOf('2 son entregas') >= 0, pie);
  }
}

if(fallos.length){
  console.log('cola de ventas: ' + fallos.length + ' fallo(s)');
  fallos.forEach(f => console.log('   · ' + f));
  process.exit(1);
}
console.log('cola de ventas: la venta llega a Supabase sin red, y la cola vieja se rescata');

})();
