/* ============================================================
   Las tareas salen del horario, no de una lista aparte
   ============================================================
   19-sep-2026. Corre en cada commit desde `verificar.py`.

   El checklist de piso se reparte SOLO, leyendo el horario que la página acaba
   de pintar. Toda su gracia está en dos frases, y las dos se rompen sin dar
   ningún error —el reparto se vería igual de bien, solo que mal—:

     1. nadie recibe una tarea el día que descansa o está de vacaciones
     2. lo que se hace a la apertura solo puede tocarle a quien ESE día abre

   Y una tercera que es el motivo de que esto exista: quien limpia no lleva
   horario en el planeador, así que su turno de sanitario solo se dice en la
   nota al pie.
   Si esa nota desaparece, nadie se entera de que le tocaba.

   Se mira `_reparto` —lo que se decidió— y también lo que quedó ESCRITO en el
   panel, porque al asesor no se le puede nombrar a un compañero: eso es su
   horario dicho de otra forma (ver `horario_solo_mio.js`).
   ============================================================ */
'use strict';
const fs = require('fs'), path = require('path');
const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'horarios.html'), 'utf8');

const { crearEntorno } = require('./dom.js');

/* Nombres inventados: este repo es público. Importa la forma —dos de gestión y
   dos asesores, con descansos distintos—, no quién es.

   ⚠️ Ninguno puede ser trozo de una palabra que la página escriba por su cuenta.
   'ANA' —el de `horario_solo_mio.js`— aquí daba un fallo falso: está dentro de
   «TU SEMANA», que encabeza la tarjeta del propio asesor. */
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
  /* Quien limpia y no lleva turno. Viene de la CONFIGURACIÓN, no del código:
     su nombre real vive en `horarios_config` (Supabase) porque estos dos repos
     son públicos. Aquí va uno de los de `NOMBRES_EJEMPLO`. */
  externos: [ { key:'@elena', nombre:'ELENA', dias:[1,2,3,4,5,6] } ]   // todos menos el domingo
};

const SUPABASE_FALSO = {
  createClient: () => ({
    auth: { getSession: async () => ({ data:{ session:null } }),
            signInWithPassword: async () => ({ error:{ message:'no' } }),
            signOut: async () => ({}) },
    from: () => ({ select(){ return this; }, eq(){ return this; },
                   maybeSingle: async () => ({ data:null }),
                   upsert: async () => ({ error:null }),
                   delete(){ return this; },
                   then: (f) => f({ data:[], error:null }) }),
    rpc: async () => ({ data:null })
  })
};

const fallos = [];
const ok = (t, c, extra) => { if(!c) fallos.push(t + (extra ? ' -> ' + extra : '')); };

/* Arranca la página como alguien, pinta la semana y devuelve lo que se decidió
   (`_reparto`), el horario del que salió (`dias`) y lo que se escribió. */
function repartirComo(opciones, tienda, equipo) {
  const ent = crearEntorno({ html, ruta:'/tablero-hes1217/horarios.html',
                             extras:{ supabase: SUPABASE_FALSO } });
  if (ent.err) return { error: ent.err };
  try {
    ent.correr('aplicarEquipo(' + JSON.stringify(equipo || EQUIPO) + ');');
    ent.correr('fijarSesion({ store_id:"' + (tienda || '1217') + '", nombre:"Angelopolis" }, '
               + JSON.stringify(opciones) + ');');
    ent.correr('var _d = generarSemana(_semana, null, null);'
             + 'renderTabla(_semana, _domingo, _d, calcularComidas(_d));');
  } catch(e) { return { error: (e && e.message) || String(e) }; }
  return {
    ent,
    reparto: JSON.parse(ent.correr('JSON.stringify(_reparto)')),
    dias:    JSON.parse(ent.correr('JSON.stringify(_d)')),
    panel:   ent.htmlDe('panel-tareas'),
    movil:   ent.htmlDe('vista-movil'),
    tabla:   ent.htmlDe('cuerpo')
  };
}

const NO_ESTA = ['descanso','vacante','ausente','permiso','capacitacion'];
const ABREN   = ['apertura','apertura_10','doble','comp_apertura'];
// Los días que viene el apoyo del equipo de prueba: todos menos el domingo.
const DIAS_APOYO = EQUIPO.externos[0].dias;

const ger = repartirComo({ puedeEditar:true });
ok('la página arranca para el gerente', !ger.error, ger.error);

if (!ger.error) {

  /* ── 1 · Nadie trabaja el día que descansa ──────────────────────────── */
  {
    ok('hay reparto', ger.reparto.length > 0);
    for (const t of ger.reparto) {
      for (const p of t.quienes) {
        const turno = ger.dias[t.dia][p];
        ok('«' + t.nombre + '» no cae en un día libre de ' + p,
           NO_ESTA.indexOf(turno) < 0, 'día ' + t.dia + ' = ' + turno);
      }
    }
  }

  /* ── 2 · Lo de la apertura, a quien abre ────────────────────────────── */
  {
    /* Sin excepciones: quien tenga una tarea de apertura ABRE ese día. Cuando
       nadie de su grupo abre, la tarea pasa a quien sí abra —nunca a quien
       entra a media tarde—.

       Este bloque no pilló el fallo la primera vez porque se saltaba justo ese
       caso, y el error se vio en pantalla: un asesor con turno de cierre
       12:30–21:00 al que se le pedía limpiar pantallas antes de abrir. Una
       prueba que perdona el caso difícil pasa por el motivo equivocado. */
    let deApertura = 0;
    for (const t of ger.reparto) {
      if (t.momento !== 'apertura') continue;
      for (const p of t.quienes) {
        deApertura++;
        ok('«' + t.nombre + '» solo le toca a quien abre',
           ABREN.indexOf(ger.dias[t.dia][p]) >= 0,
           p + ' el día ' + t.dia + ' hace ' + ger.dias[t.dia][p]);
      }
    }
    ok('y hay tareas de apertura que comprobar', deApertura > 0);
  }

  /* ── 3 · El apoyo sin horario: sus días y su nota al pie ───────────── */
  {
    /* La rueda del sanitario incluye a quien no tiene horario. Se recorren las
       semanas hasta que le toca: lo que se comprueba es que cuando le toca, le
       toca un día que ella SÍ viene y que se dice en alguna parte. */
    let visto = false;
    for (let s = 1; s <= 12 && !visto; s++) {
      const rep = JSON.parse(ger.ent.correr(
        'JSON.stringify(repartirTareas(_d, ' + s + '))'));
      const san = rep.find(t => t.id === 'sanitario');
      ok('el sanitario siempre tiene a alguien (semana ' + s + ')', !!san);
      if (san && san.externos.indexOf('@elena') >= 0) {
        visto = true;
        ok('cuando le toca al apoyo, cae en un día que sí viene',
           DIAS_APOYO.indexOf(san.dia) >= 0, 'día ' + san.dia);
        ok('y nadie del equipo la acompaña esa semana', san.quienes.length === 0);
      }
    }
    ok('al apoyo le toca el sanitario dentro de las primeras 12 semanas', visto);

    /* La bodega rueda igual que el sanitario desde el 20-sep-2026: una persona
       por semana, y el apoyo entra en la rueda. Cuando le toca a él, también
       lleva su nota al pie —es la única forma de que se entere—. */
    let notaBodega = false;
    for (let s = 1; s <= 12 && !notaBodega; s++) {
      const rep = JSON.parse(ger.ent.correr('JSON.stringify(repartirTareas(_d, ' + s + '))'));
      const bod = rep.find(t => t.id === 'bodega');
      ok('la bodega siempre tiene a alguien (semana ' + s + ')',
         !!bod && (bod.quienes.length + bod.externos.length) > 0);
      if (bod && bod.externos.indexOf('@elena') >= 0) {
        notaBodega = true;
        ok('la bodega del apoyo cae en un día que sí viene',
           DIAS_APOYO.indexOf(bod.dia) >= 0, 'día ' + bod.dia);
      }
    }
    ok('al apoyo también le toca la bodega dentro de las primeras 12 semanas', notaBodega);
  }

  /* ── 3-quater · Las mesas: el domingo el asesor las hace solo ───────── */
  {
    /* El apoyo viene todos los días menos el domingo. Los días que viene, las
       mesas y pantallas son suyas —con el asesor de apertura si lo hay, y ella
       sola si no—. El domingo no viene: ese día las hace el asesor solo, y
       nadie puede quedarse esperándola.

       Sin esta prueba el error se ve al revés de como es: el panel del domingo
       enseñaría el nombre de alguien que no está en la tienda. */
    for (let s = 1; s <= 8; s++) {
      const rep = JSON.parse(ger.ent.correr(
        'JSON.stringify(repartirTareas(_d, ' + s + '))'));
      const mesas = rep.filter(t => t.id === 'mesas');
      for (const t of mesas)
        ok('las mesas del día ' + t.dia + ' no llaman al apoyo si no viene',
           t.externos.indexOf('@elena') < 0 || DIAS_APOYO.indexOf(t.dia) >= 0,
           'semana ' + s);

      const dom = mesas.find(t => t.dia === 0);
      ok('el domingo las mesas tienen dueño (semana ' + s + ')',
         !!dom && dom.quienes.length > 0, JSON.stringify(dom || null));
      if (dom) {
        ok('y el domingo las hace alguien del equipo, sin apoyo',
           dom.externos.length === 0, dom.externos.join(','));
        ok('y ese alguien abre el domingo',
           ABREN.indexOf(ger.dias[0][dom.quienes[0]]) >= 0,
           dom.quienes[0] + ' hace ' + ger.dias[0][dom.quienes[0]]);
      }
      for (const d of DIAS_APOYO) {
        const t = mesas.find(x => x.dia === d);
        ok('el día ' + d + ' las mesas son del apoyo (semana ' + s + ')',
           !!t && t.externos.indexOf('@elena') >= 0, JSON.stringify(t || null));
      }
    }
  }

  /* ── 3-quinquies · Si no abre ningún asesor, el apoyo lo hace solo ─── */
  {
    /* Con un único asesor que descansa el martes, ese día no hay quien abra de
       su grupo. Las mesas NO pueden saltar al gerente —él ya está barriendo— ni
       quedarse sin hacer: ese día son del apoyo, sola.

       El equipo normal de prueba nunca cae en este hueco, así que sin montar
       uno a propósito la rama se quedaría sin probar y solo se vería en tienda,
       el martes, con el gerente limpiando pantallas. */
    const solo = Object.assign({}, EQUIPO, {
      asesores: [ { key:'A1', nombre:'CARO ASESORA', cargo:'Asesor', emp:'900003', descFijo:2 } ]
    });
    const v = repartirComo({ puedeEditar:true }, '1217', solo);
    ok('la página arranca con un solo asesor', !v.error, v.error);
    if (!v.error) {
      const mar = v.reparto.find(t => t.id === 'mesas' && t.dia === 2);
      ok('el martes las mesas siguen ahí', !!mar, JSON.stringify(v.reparto.filter(t => t.id === 'mesas')));
      if (mar) {
        ok('y las hace el apoyo', mar.externos.indexOf('@elena') >= 0, mar.externos.join(','));
        ok('sola, sin llamar a gerencia', mar.quienes.length === 0, mar.quienes.join(','));
      }
    }
  }

  /* ── 3-bis · Las dos semanales no caen en la misma persona ───────────── */
  {
    /* Sanitario y bodega ruedan las dos. Si giraran igual, cada semana le
       tocarían LAS DOS a la misma persona y ninguna al resto: el reparto se
       vería impecable y sería lo contrario de una rotación. */
    for (let s = 1; s <= 20; s++) {
      const rep = JSON.parse(ger.ent.correr('JSON.stringify(repartirTareas(_d, ' + s + '))'));
      const san = rep.find(t => t.id === 'sanitario');
      const bod = rep.find(t => t.id === 'bodega');
      if (!san || !bod) continue;
      const aS = san.quienes.concat(san.externos);
      const aB = bod.quienes.concat(bod.externos);
      ok('semana ' + s + ': sanitario y bodega van a personas distintas',
         !aS.some(k => aB.indexOf(k) >= 0), aS.join(',') + ' vs ' + aB.join(','));
    }
  }

  /* ── 3-ter · Las semanales esquivan el fin de semana ─────────────────── */
  {
    /* Sábado y domingo son los dos días que más venden: mandar ahí el sanitario
       o la bodega es quitarle piso a la venta. Solo se admite cuando la persona
       no trabaja ningún día entre semana. */
    for (let s = 1; s <= 20; s++) {
      const rep = JSON.parse(ger.ent.correr('JSON.stringify(repartirTareas(_d, ' + s + '))'));
      for (const t of rep) {
        if (t.frec !== 'semanal' || !t.quienes.length) continue;
        if (t.dia !== 0 && t.dia !== 6) continue;
        const p     = t.quienes[0];
        const entre = [1,2,3,4].filter(d => NO_ESTA.indexOf(ger.dias[d][p]) < 0);
        ok('«' + t.nombre + '» en fin de semana solo si no hay día entre semana',
           entre.length === 0, p + ' semana ' + s + ' libre: ' + entre.join(','));
      }
    }
  }

  /* ── 4 · La rueda pasa por todos ────────────────────────────────────── */
  {
    const tocados = new Set();
    for (let s = 1; s <= 20; s++) {
      const rep = JSON.parse(ger.ent.correr('JSON.stringify(repartirTareas(_d, ' + s + '))'));
      const san = rep.find(t => t.id === 'sanitario');
      if (san) san.quienes.concat(san.externos).forEach(k => tocados.add(k));
    }
    for (const k of ['G1','G2','A1','A2','@elena'])
      ok('el sanitario le toca a ' + k + ' alguna vez en 20 semanas', tocados.has(k),
         [...tocados].join(','));

    const bodega = new Set();
    for (let s = 1; s <= 20; s++) {
      const rep = JSON.parse(ger.ent.correr('JSON.stringify(repartirTareas(_d, ' + s + '))'));
      const b = rep.find(t => t.id === 'bodega');
      if (b) b.quienes.concat(b.externos).forEach(k => bodega.add(k));
    }
    for (const k of ['G1','G2','A1','A2','@elena'])
      ok('la bodega le toca a ' + k + ' alguna vez en 20 semanas', bodega.has(k),
         [...bodega].join(','));
  }

  /* ── 5 · El mismo horario da el mismo reparto ───────────────────────── */
  {
    /* Si el reparto cambiara entre dos pintados, cada teléfono vería una cosa
       distinta —y no se guarda en ningún lado, así que no habría forma de
       saber cuál era la buena—. */
    const a = ger.ent.correr('JSON.stringify(repartirTareas(_d, 40))');
    const b = ger.ent.correr('JSON.stringify(repartirTareas(_d, 40))');
    ok('repartir dos veces da lo mismo', a === b);
    const c = ger.ent.correr('JSON.stringify(repartirTareas(_d, 41))');
    ok('y otra semana reparte distinto', a !== c);
  }

  /* ── 6 · El gerente ve nombres; el panel se enciende ────────────────── */
  {
    ok('el gerente ve el panel', ger.panel.indexOf('Tareas de la semana') >= 0, ger.panel.slice(0,120));
    /* Se pregunta a la función que lo decide y no al panel de hoy: qué tareas
       caen esta semana depende del día en que se corra la prueba —y el sábado
       después de las 17:00 la página ya enseña la semana siguiente—. */
    const txt = ger.ent.correr('quienesTexto_({ quienes:["A2"], externos:[], frec:"semanal" })');
    ok('el gerente ve el nombre de quien le toca', txt.indexOf('DANI') >= 0, txt);
    ok('la tabla lleva la fila de tareas', ger.tabla.indexOf('Tareas') >= 0);
  }
}

/* ── 7 · El asesor: su tarea, sin nombrar a nadie más ─────────────────── */
{
  const v = repartirComo({ empno:'900003', puesto:'Asesor' });   // CARO
  ok('la página arranca para el asesor', !v.error, v.error);
  if (!v.error) {
    ok('el asesor ve el panel', v.panel.indexOf('Tareas de la semana') >= 0);
    for (const n of ['NORA GERENTE','BENI SUBGER','DANI ASESOR','NORA','BENI','DANI']) {
      ok('no se nombra a ' + n + ' en el panel de tareas', v.panel.indexOf(n) < 0, v.panel.slice(0,400));
      ok('ni en sus tarjetas', v.movil.indexOf(n) < 0, v.movil.slice(0,300));
      ok('ni en la tabla', v.tabla.indexOf(n) < 0);
    }
    // Lo mismo por la función que lo decide, que no depende del día de hoy.
    const otro = v.ent.correr('quienesTexto_({ quienes:["A2"], externos:[], frec:"semanal" })');
    ok('a un compañero se le llama compañero, sin nombre',
       otro.indexOf('DANI') < 0 && otro.length > 0, otro);
    const mia = v.ent.correr('quienesTexto_({ quienes:["A1"], externos:[], frec:"semanal" })');
    ok('y lo suyo se le dice «te toca»', mia.indexOf('te toca') >= 0, mia);
    const conApoyo = v.ent.correr('quienesTexto_({ quienes:[], externos:["@elena"], frec:"semanal" })');
    ok('al apoyo sí se le nombra: no está en el planeador',
       conApoyo.indexOf('ELENA') >= 0, conApoyo);
  }
}

/* ── 8 · Fuera de la 1217 esto no existe ──────────────────────────────── */
{
  /* Este archivo se publica también en `planeador-odemas`, para las tiendas sin
     tablero. Allá el checklist no se pidió: si se encendiera solo, repartiría
     tareas inventadas a equipos que nunca las acordaron. */
  const v = repartirComo({ puedeEditar:true }, '1300');
  ok('en otra tienda el panel queda vacío', !v.error && v.panel === '', v.error || v.panel.slice(0,200));
}

/* ── 9 · El catálogo y el CHECK del SQL dicen lo mismo ────────────────── */
{
  /* La palomita se guarda en `tareas_hechas`, que valida el id contra un CHECK.
     Agregar una tarea al HTML y olvidar el SQL no rompe el reparto —se ve
     perfecto— pero al palomearla la base la rechaza. El reparto se vería bien y
     el checklist no registraría nada. */
  const sql = fs.readFileSync(path.join(raiz, 'supabase_tareas.sql'), 'utf8');
  const m   = sql.match(/tarea\s+IN\s*\(([^)]*)\)/i);
  ok('el SQL declara los ids de tarea', !!m);
  if (m) {
    const enSql = m[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).sort();
    const enApp = (html.match(/id:\s*'([a-z]+)',\s*\n?\s*nombre:/g) || []);
    const ids   = [];
    const re    = /\{\s*id:\s*'([a-z_]+)',\s*nombre:/g;
    let x; while ((x = re.exec(html)) !== null) ids.push(x[1]);
    ok('el catálogo del HTML tiene tareas', ids.length > 0, String(enApp.length));
    ok('cada tarea del catálogo está en el CHECK del SQL',
       ids.every(i => enSql.indexOf(i) >= 0), 'app: ' + ids.join(',') + ' · sql: ' + enSql.join(','));
    ok('y el CHECK no declara tareas que la app no reparte',
       enSql.every(i => ids.indexOf(i) >= 0), 'app: ' + ids.join(',') + ' · sql: ' + enSql.join(','));
  }
}

/* ── 10 · Sin nadie de apoyo capturado, el reparto sigue en pie ───────── */
{
  /* El nombre de quien limpia se captura en Admin → Equipo y vive en Supabase,
     no en el código: estos dos repos son públicos. Así que la app tiene que
     aguantar el rato en que ese dato todavía no está —y el día que la tienda
     deje de tener apoyo—: sin él no hay nota al pie ni acompañante, pero el
     sanitario y la bodega siguen teniendo dueño. */
  const ent = crearEntorno({ html, ruta:'/tablero-hes1217/horarios.html',
                             extras:{ supabase: SUPABASE_FALSO } });
  if (ent.err) { ok('la página arranca sin apoyo capturado', false, ent.err); }
  else {
    const sinApoyo = Object.assign({}, EQUIPO); delete sinApoyo.externos;
    let err = null;
    try {
      ent.correr('aplicarEquipo(' + JSON.stringify(sinApoyo) + ');');
      ent.correr('fijarSesion({ store_id:"1217", nombre:"Angelopolis" }, { puedeEditar:true });');
      ent.correr('var _d = generarSemana(_semana, null, null);'
               + 'renderTabla(_semana, _domingo, _d, calcularComidas(_d));');
    } catch(e) { err = (e && e.message) || String(e); }
    ok('la página arranca sin apoyo capturado', !err, err);
    if (!err) {
      const rep = JSON.parse(ent.correr('JSON.stringify(_reparto)'));
      ok('el sanitario sigue teniendo dueño', rep.some(t => t.id === 'sanitario' && t.quienes.length));
      ok('y nadie queda marcado como externo', rep.every(t => !t.externos.length),
         JSON.stringify(rep.filter(t => t.externos.length)));
      ok('sin apoyo no se escribe ninguna nota al pie',
         ent.htmlDe('panel-tareas').indexOf('tar-nota') < 0);
    }
  }
}

if (fallos.length) {
  console.log('tareas · reparto: ' + fallos.length + ' fallo(s)');
  fallos.forEach(f => console.log('   · ' + f));
  process.exit(1);
}
console.log('tareas · reparto: sale del horario, respeta descansos y aperturas, y el apoyo sin horario se nombra al pie');
