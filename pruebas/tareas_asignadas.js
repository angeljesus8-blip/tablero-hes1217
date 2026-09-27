/* ============================================================
   Encargos: lo que gerencia asigna a mano
   ============================================================
   27-sep-2026. Corre en cada commit desde `verificar.py`.

   El checklist de piso se reparte solo; los encargos los escribe gerencia
   («hoy, Fulano, cuenta los accesorios»). Lo que no se puede romper, y que se
   rompería sin dar un solo error:

     1. el asesor ve SOLO lo suyo — un encargo ajeno lleva fecha y nombre, y
        eso es el horario de otro dicho de otra forma;
     2. el texto lo escribe una persona: se pinta escapado, nunca como HTML;
     3. no se le encarga nada a quien ese día no está en la tienda;
     4. lo que no se hizo su día sigue saliendo como atrasado;
     5. una carga fallida no se lee «sin encargos»;
     6. fuera de la 1217 esto no existe.
   ============================================================ */
'use strict';
process.env.TZ = 'America/Mexico_City';
function relojEn(iso){
  const fijo = new Date(iso).getTime();
  return class extends Date {
    constructor(...a){ a.length ? super(...a) : super(fijo); }
    static now(){ return fijo; }
  };
}
// Miércoles 23-sep-2026, 12:00 en CDMX: la semana va del domingo 20 al sábado 26.
const RELOJ = relojEn('2026-09-23T18:00:00Z');
const HOY = '2026-09-23', DESDE = '2026-09-20', HASTA = '2026-09-26';
const fs = require('fs'), path = require('path');
const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'horarios.html'), 'utf8');
const { crearEntorno } = require('./dom.js');

// Nombres inventados, los mismos de `tareas_rotacion.js`: este repo es público.
const EQUIPO = {
  horaApertura: 10, horaCierre: 21,
  gerentes: [
    { key:'G1', nombre:'NORA GERENTE',  cargo:'Gerente de Tienda', emp:'900001', descFijo:5 },
    { key:'G2', nombre:'BENI SUBGER',   cargo:'Subgerente',        emp:'900002', descFijo:4 }
  ],
  asesores: [
    { key:'A1', nombre:'CARO ASESORA',  cargo:'Asesor',            emp:'900003', descFijo:3 },
    { key:'A2', nombre:'DANI ASESOR',   cargo:'Asesor',            emp:'900004', descFijo:1 }
  ],
  externos: [ { key:'@elena', nombre:'ELENA', descanso:0 } ]
};
const NO_ESTA = ['descanso','vacante','ausente','permiso','capacitacion'];
const CEBO = 'Contar <img src=x onerror=alert(1)> vitrina';

/* Un Supabase de mentira que APUNTA lo que se le pide. `cfg.from(q)` y
   `cfg.rpc(fn, args)` deciden qué contesta. */
function sbFalso(cfg){
  const log = [];
  const client = {
    auth: { getSession: async () => ({ data:{ session:null } }),
            signInWithPassword: async () => ({ error:{ message:'no' } }),
            signOut: async () => ({}) },
    from(tabla){
      const q = { tabla, accion:'select', payload:null, filtros:[], or:null };
      log.push(q);
      const b = {
        select(){ return b; }, order(){ return b; },
        eq(k, v){ q.filtros.push([k, v]); return b; },
        or(s){ q.or = s; return b; },
        insert(p){ q.accion = 'insert'; q.payload = p; return b; },
        update(p){ q.accion = 'update'; q.payload = p; return b; },
        upsert(p){ q.accion = 'upsert'; q.payload = p; return b; },
        delete(){ q.accion = 'delete'; return b; },
        maybeSingle: async () => ({ data:null }),
        then(f, r){ return Promise.resolve((cfg.from || (() => ({ data:[], error:null })))(q)).then(f, r); }
      };
      return b;
    },
    rpc: async (fn, args) => { log.push({ rpc: fn, args }); return (cfg.rpc || (() => ({ data:null })))(fn, args); }
  };
  return { mod: { createClient: () => client }, log };
}

const esperar = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };

async function arrancar(opciones, cfg, tienda){
  const sb  = sbFalso(cfg || {});
  const ent = crearEntorno({ html, ruta:'/tablero-hes1217/horarios.html',
                             extras:{ supabase: sb.mod, Date: RELOJ } });
  if (ent.err) return { error: ent.err };
  try {
    ent.correr('aplicarEquipo(' + JSON.stringify(EQUIPO) + ');');
    ent.correr('fijarSesion({ store_id:"' + (tienda || '1217') + '", nombre:"Angelopolis" }, '
               + JSON.stringify(opciones) + ');');
    ent.correr('var _d = generarSemana(_semana, null, null);'
             + 'renderTabla(_semana, _domingo, _d, calcularComidas(_d));');
  } catch(e) { return { error: (e && e.message) || String(e) }; }
  await esperar();
  return { ent, sb, dias: JSON.parse(ent.correr('JSON.stringify(_d)')),
           panel: () => ent.htmlDe('panel-tareas'), movil: () => ent.htmlDe('vista-movil') };
}

const fallos = [];
const ok = (t, c, extra) => { if (!c) fallos.push(t + (extra ? ' -> ' + extra : '')); };
const fechaDe = d => { const f = new Date(2026, 8, 20 + d); return f.toISOString().slice(0, 10); };

(async () => {

/* ── 1 · El asesor: lo suyo, escapado, con lo atrasado arriba ─────────── */
{
  const v = await arrancar({ empno:'900003' }, {
    rpc: (fn, a) => fn === 'tareas_asignadas_mias'
      ? { data: [
          { id: 1, fecha: '2026-09-16', texto: 'Acomodar bodega vieja', hecha: false, mia: false },
          { id: 2, fecha: HOY,          texto: CEBO,                    hecha: false, mia: false },
          { id: 3, fecha: '2026-09-25', texto: 'Revisar exhibidor',     hecha: false, mia: false } ] }
      : { data: null }
  });
  ok('arranca como asesor', !v.error, v.error);
  if (!v.error) {
    const pide = v.sb.log.find(x => x.rpc === 'tareas_asignadas_mias');
    ok('pide SUS encargos al servidor, con su número', !!pide && pide.args.p_empno === '900003',
       JSON.stringify(pide && pide.args));
    ok('y de la semana que ve', !!pide && pide.args.p_desde === DESDE && pide.args.p_hasta === HASTA,
       JSON.stringify(pide && pide.args));
    ok('el asesor NUNCA lee la tabla directo (traería los de todos)',
       !v.sb.log.some(x => x.tabla === 'tareas_asignadas'));
    const p = v.panel();
    ok('el texto sale escapado', p.indexOf('&lt;img') >= 0 && p.indexOf('<img') < 0, p.slice(0, 300));
    ok('la tarjeta del celular también lo escapa',
       v.movil().indexOf('<img') < 0 && v.movil().indexOf('&lt;img') >= 0);
    ok('lo de la semana pasada sale como atrasado',
       p.indexOf('Atrasados') >= 0 && p.indexOf('Acomodar bodega vieja') >= 0);
    ok('lo atrasado va ANTES que lo de hoy',
       p.indexOf('Acomodar bodega vieja') < p.indexOf('&lt;img'));
    // La casilla del viernes, apagada; la de hoy, encendida.
    const chk = id => (p.match(new RegExp('<input[^>]*class="enc-chk" data-id="' + id + '"[^>]*>')) || [''])[0];
    ok('lo de hoy se puede marcar', chk(2) && chk(2).indexOf('disabled') < 0, chk(2));
    ok('lo del viernes todavía no', /disabled/.test(chk(3)), chk(3));
    ok('el asesor no ve el formulario de asignar', p.indexOf('enc-form') < 0);
    ok('ni puede borrar', p.indexOf('enc-quitar') < 0);

    // Marcar pasa por el RPC con su número, no por la tabla.
    v.ent.correr('marcarEncargo_({ dataset:{ id:"2" }, checked:true, disabled:false })');
    await esperar();
    const marca = v.sb.log.find(x => x.rpc === 'tarea_asignada_marcar');
    ok('marcar va por el RPC con su número', !!marca && marca.args.p_empno === '900003' && marca.args.p_id === 2,
       JSON.stringify(marca && marca.args));
  }
}

/* ── 2 · Gerencia: todo, con nombres, y el formulario ────────────────── */
{
  const filas = [
    { id: 10, fecha: HOY, para_empno: '900003', texto: 'Contar accesorios', hecha_en: null, hecha_por: null },
    { id: 11, fecha: '2026-09-18', para_empno: '900004', texto: 'Etiquetar precios', hecha_en: null, hecha_por: null }
  ];
  const v = await arrancar({ puedeEditar:true }, {
    from: q => q.tabla !== 'tareas_asignadas' ? { data:[], error:null }
      : q.accion === 'select' ? { data: filas, error:null }
      : { data: [{ id: 99 }], error:null }
  });
  ok('arranca como gerente', !v.error, v.error);
  if (!v.error) {
    const lee = v.sb.log.find(x => x.tabla === 'tareas_asignadas' && x.accion === 'select');
    ok('gerencia lee la tabla con su sesión', !!lee);
    ok('filtrada por su tienda', !!lee && lee.filtros.some(f => f[0] === 'store_id' && f[1] === '1217'));
    ok('trae la semana y lo atrasado de antes',
       !!lee && lee.or && lee.or.indexOf('fecha.gte.' + DESDE) >= 0 && lee.or.indexOf('hecha_en.is.null') >= 0,
       lee && lee.or);
    const p = v.panel();
    ok('ve los encargos de todos, con nombre', p.indexOf('CARO') >= 0 && p.indexOf('DANI') >= 0, p.slice(0, 400));
    ok('lo atrasado va marcado', p.indexOf('⚠ Atrasado') >= 0);
    ok('tiene el formulario', p.indexOf('id="enc-guardar"') >= 0);
    ok('y puede borrar', p.indexOf('enc-quitar') >= 0);

    // No se le encarga nada a quien ese día no está.
    let visto = 0;
    for (let d = 0; d < 7; d++) {
      const cand = JSON.parse(v.ent.correr('JSON.stringify(candidatosEncargo_(' + d + '))')).map(c => c.emp);
      for (const k of ['G1','G2','A1','A2']) {
        const emp = EQUIPO.gerentes.concat(EQUIPO.asesores).find(x => x.key === k).emp;
        if (NO_ESTA.indexOf(v.dias[d][k]) >= 0) {
          visto++;
          ok('el día ' + d + ' ' + k + ' no está y no sale para encargarle', cand.indexOf(emp) < 0, cand.join(','));
        }
      }
    }
    ok('hubo días de descanso que comprobar', visto > 0);

    // Guardar a quien descansa: rechazado, sin escribir nada.
    const futuroLibre = [3,4,5,6].map(d => ({ d, k: ['G1','G2','A1','A2'].find(k => NO_ESTA.indexOf(v.dias[d][k]) >= 0) }))
                                 .find(x => x.k);
    if (futuroLibre) {
      const emp = EQUIPO.gerentes.concat(EQUIPO.asesores).find(x => x.key === futuroLibre.k).emp;
      const antes = v.sb.log.filter(x => x.accion === 'insert').length;
      v.ent.correr('_encForm = { dia:"' + futuroLibre.d + '", para:"' + emp + '", texto:"Algo" }; guardarEncargo_();');
      await esperar();
      ok('a quien descansa no se le guarda nada', v.sb.log.filter(x => x.accion === 'insert').length === antes);
      ok('y se le dice por qué', /no está/.test(v.ent.el('enc-msg').textContent), v.ent.el('enc-msg').textContent);
    }
    ok('hay un día libre de hoy en adelante para probar el rechazo', !!futuroLibre);

    // Un día que ya pasó tampoco.
    {
      const antes = v.sb.log.filter(x => x.accion === 'insert').length;
      v.ent.correr('_encForm = { dia:"1", para:"900003", texto:"Algo" }; guardarEncargo_();');
      await esperar();
      ok('a un día que ya pasó no se le guarda nada', v.sb.log.filter(x => x.accion === 'insert').length === antes);
    }

    // Guardar bien: lo que viaja es la fecha del día elegido, su número y el texto.
    const dBueno = [3,4,5,6].find(d => NO_ESTA.indexOf(v.dias[d]['A1']) < 0);
    if (dBueno !== undefined) {
      v.ent.correr('_encForm = { dia:"' + dBueno + '", para:"900003", texto:"  Limpiar vitrina  " }; guardarEncargo_();');
      await esperar();
      const ins = v.sb.log.find(x => x.accion === 'insert' && x.tabla === 'tareas_asignadas');
      ok('guarda el encargo', !!ins);
      ok('con la fecha del día elegido, su número, su tienda y el texto limpio',
         !!ins && ins.payload.fecha === fechaDe(dBueno) && ins.payload.para_empno === '900003'
               && ins.payload.store_id === '1217' && ins.payload.texto === 'Limpiar vitrina',
         JSON.stringify(ins && ins.payload));
    }
    ok('A1 trabaja algún día de hoy en adelante', dBueno !== undefined);
  }
}

/* ── 3 · El subgerente que entra con su número: ve, no asigna ────────── */
{
  const v = await arrancar({ empno:'900002', puesto:'Subgerente' }, {
    rpc: fn => fn === 'tareas_asignadas_mias' ? { data: [] } : { data: null }
  });
  ok('arranca como subgerente por número', !v.error, v.error);
  if (!v.error) {
    ok('sin sesión no se le ofrece asignar (la base lo rechazaría)', v.panel().indexOf('enc-form') < 0);
    ok('pide lo suyo por el RPC', v.sb.log.some(x => x.rpc === 'tareas_asignadas_mias'));
    ok('y no lee la tabla', !v.sb.log.some(x => x.tabla === 'tareas_asignadas'));
  }
}

/* ── 4 · Si la carga falla, se dice ──────────────────────────────────── */
{
  const v = await arrancar({ empno:'900003' }, {
    rpc: fn => fn === 'tareas_asignadas_mias' ? { data: null, error: { message: 'red' } } : { data: null }
  });
  ok('arranca con la red caída', !v.error, v.error);
  if (!v.error)
    ok('una carga fallida no se lee como «sin encargos»', v.panel().indexOf('No se pudieron cargar los encargos') >= 0);
}

/* ── 5 · Fuera de la 1217 no existe ─────────────────────────────────── */
{
  const v = await arrancar({ puedeEditar:true }, {}, '1300');
  ok('arranca en otra tienda', !v.error, v.error);
  if (!v.error) {
    ok('en otra tienda no se piden encargos',
       !v.sb.log.some(x => x.tabla === 'tareas_asignadas' || x.rpc === 'tareas_asignadas_mias'));
    ok('ni se pinta el panel', v.panel() === '');
  }
}

/* ── 6 · El SQL y la app dicen lo mismo ─────────────────────────────── */
{
  const sql = fs.readFileSync(path.join(raiz, 'supabase_tareas_asignadas.sql'), 'utf8');
  const tope = (sql.match(/char_length\(btrim\(texto\)\)\s+BETWEEN\s+1\s+AND\s+(\d+)/i) || [])[1];
  const app  = (html.match(/const ENCARGO_MAX\s*=\s*(\d+)/) || [])[1];
  ok('el tope de letras es el mismo en el SQL y en la app', tope && tope === app, tope + ' vs ' + app);
  ok('el RPC del asesor filtra por SU número',
     /a\.para_empno\s*=\s*p_empno/.test(sql));
  ok('marcar comprueba que sea suyo',
     /a\.para_empno\s*=\s*p_empno/.test(sql.slice(sql.indexOf('tarea_asignada_marcar'))));
  ok('marcar no deja adelantarse a su día', /'todavia_no'/.test(sql));
  ok('la tabla tiene RLS', /ALTER TABLE public\.tareas_asignadas ENABLE ROW LEVEL SECURITY/.test(sql));
}

if (fallos.length) {
  console.log('tareas · encargos: ' + fallos.length + ' fallo(s)');
  fallos.forEach(f => console.log('   · ' + f));
  process.exit(1);
}
console.log('tareas · encargos: cada quien ve lo suyo, escapado; nada a quien descansa; lo atrasado no se pierde');
})().catch(e => { console.log('tareas · encargos: la prueba reventó -> ' + ((e && e.stack) || e)); process.exit(1); });
