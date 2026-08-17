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

function arrancar(extraLS){
  const LS = Object.assign({
    hes_store: JSON.stringify(STORE),
    hes_empleado: JSON.stringify(EMP)
  }, extraLS || {});
  const els = {};
  function el(id){
    if(!els[id]) els[id] = {
      id, style:{}, dataset:{}, value:'', textContent:'', children:[],
      innerHTML:'',
      classList:{ add(){}, remove(){}, toggle(){}, contains(){ return false; } },
      querySelectorAll:()=>[], addEventListener(){}, appendChild(){},
      closest:()=>null, focus(){}, remove(){}, onclick:null,
      insertBefore(){}, scrollIntoView(){}
    };
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
  return { err, LS, els, caja,
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

if(fallos.length){
  console.log('cola de ventas: ' + fallos.length + ' fallo(s)');
  fallos.forEach(f => console.log('   · ' + f));
  process.exit(1);
}
console.log('cola de ventas: la venta llega a Supabase sin red, y la cola vieja se rescata');
