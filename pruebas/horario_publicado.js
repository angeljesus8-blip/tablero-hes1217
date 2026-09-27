/* ============================================================
   El equipo ve el horario PUBLICADO, y le llega sin recargar
   ============================================================
   26-sep-2026. Corre en cada commit desde `verificar.py`.

   Tres fallos del mismo día, todos de la vista del asesor:

     1. Al navegar con ◄ ► dejaba de enseñar la semana guardada y pintaba una
        RECALCULADA (y desde el mismo día el equipo ya no navega: ve solo la
        semana que le toca): `mostrarHorarioEquipo` no dejaba las semanas guardadas en
        `_cache`, y `renderSemana` las buscaba ahí. «Les aparecía otro horario
        distinto al mío; ya que recargaron ya se podía ver bien.»
     2. Una semana futura sin guardar (la 41, con su configuración vacía) salía
        como horario. Para el equipo tiene que decir que no se ha publicado;
        el gerente la ve, pero rotulada como borrador.
     3. Con la pantalla abierta, nada volvía a pedir el horario: ni el cambio
        del sábado a las 5 p. m. ni una semana recién guardada llegaban hasta
        recargar.

   Nombres inventados a propósito: este repo es público.
   ============================================================ */
'use strict';
process.env.TZ = 'America/Mexico_City';   // antes de crear cualquier Date
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'horarios.html'), 'utf8');
const { crearEntorno } = require('./dom.js');

const EQUIPO = {
  horaApertura: 10, horaCierre: 21,
  gerentes: [
    { key:'G1', nombre:'ANA GERENTE', cargo:'Gerente de Tienda', emp:'900001', descFijo:5 },
    { key:'G2', nombre:'BENI SUBGER', cargo:'Subgerente',        emp:'900002', descFijo:4 }
  ],
  asesores: [
    { key:'A1', nombre:'CARO ASESORA', cargo:'Asesor', emp:'900003', descFijo:3 },
    { key:'A2', nombre:'DANI ASESOR',  cargo:'Asesor', emp:'900004', descFijo:1 }
  ]
};

/* Un reloj que la prueba puede adelantar: `reloj.t` es "ahora". */
const reloj = { t: 0 };
class RelojDate extends Date {
  constructor(...a){ a.length ? super(...a) : super(reloj.t); }
  static now(){ return reloj.t; }
}
const en = (iso) => { reloj.t = new Date(iso).getTime(); };

let rpcs = 0, datosServidor = null;
const SUPABASE_FALSO = { createClient: () => ({
  auth: { getSession: async () => ({ data:{ session:null } }), signOut: async () => ({}) },
  from: () => ({ select(){ return this; }, eq(){ return this; }, maybeSingle: async () => ({ data:null }),
                 upsert: async () => ({ error:null }) }),
  // Solo cuenta las lecturas del horario: las tareas también llaman a rpc.
  rpc: async (fn) => {
    if (fn !== 'horario_equipo') return { data: [] };
    rpcs++; return { data: datosServidor };
  } }) };

const fallos = [];
const ok = (t, c, extra) => { if(!c) fallos.push(t + (extra ? ' -> ' + extra : '')); };

/* Una semana "guardada" que el generador NUNCA daría —el lunes descansan
   todos—, para distinguir a simple vista la publicada de una recalculada. */
function arrancar(iso, opciones){
  en(iso);
  const ent = crearEntorno({ html, ruta:'/tablero-hes1217/horarios.html',
    extras:{ supabase: SUPABASE_FALSO, Date: RelojDate } });
  if(ent.err) throw new Error('la página se cae al cargar: ' + ent.err);
  ent.correr('aplicarEquipo(' + JSON.stringify(EQUIPO) + ');');
  ent.correr('fijarSesion({ store_id:"1217", nombre:"A" }, ' + JSON.stringify(opciones) + ');');
  return ent;
}
const MARCA = 'publicada';
function datosCon(ent, semanasGuardadas, excepciones, conPublicadas){
  return ent.correr(`(function(){
    const sg = {};
    ${JSON.stringify(semanasGuardadas)}.forEach(function(n){
      const d = generarSemana(n, null, null);
      for (const p in d[1]) d[1][p] = 'descanso';
      sg['semana_' + n] = { dias: d };
    });
    const exc = ${JSON.stringify(excepciones)};
    return ${conPublicadas ? `{ equipo:${JSON.stringify(EQUIPO)}, historial:{}, excepciones:Object.assign(exc,{__publicadas:sg}), semanas_guardadas:{} }`
                           : `{ equipo:${JSON.stringify(EQUIPO)}, historial:{}, excepciones:exc, semanas_guardadas:sg }`};
  })()`);
}
// «publicada» si el lunes descansan todos (la marca); si no, lo que haya.
const lunes   = (ent) => {
  const l = ent.correr('_diasActuales && _diasActuales[1]');
  return l && Object.values(l).every(v => v === 'descanso') ? MARCA : JSON.stringify(l);
};
const visible = (ent, id) => ent.el(id).style.display !== 'none';
const VACIA = { vacaciones:{}, turno_especial:{}, descanso_override:{} };

(async () => {
  // Martes 22-sep-2026 10:00 a. m. (CDMX): semana en curso = 39.
  const MARTES = '2026-09-22T16:00:00Z';

  /* 1 · El equipo ve SOLO la semana que le toca (26-sep-2026: «ellos no deben
        de ver entre semanas, solo su semana actual»), y es la publicada. */
  {
    const ent = arrancar(MARTES, { empno:'900003', puesto:'Asesor' });
    ent.correr('mostrarHorarioEquipo(' + JSON.stringify(datosCon(ent, [39, 40], { semana_41: VACIA })) + ')');
    ok('ASESOR · entra viendo la semana publicada', lunes(ent) === MARCA, lunes(ent));
    ok('ASESOR · sin flechas para cambiar de semana',
       ent.el('btn-sem-ant').style.visibility === 'hidden' && ent.el('btn-sem-sig').style.visibility === 'hidden');
    ent.correr('navSemana(1); navSemana(2);');
    ok('ASESOR · llamar a navSemana no lo mueve de semana', ent.correr('_semana') === 39, ent.correr('_semana'));
    ok('ASESOR · y sigue la publicada, no una recalculada', lunes(ent) === MARCA, lunes(ent));
    /* Subgerente que entra con su número: ve al equipo, pero no edita aquí, así
       que tampoco navega. */
    const sub = arrancar(MARTES, { empno:'900002', puesto:'Subgerente' });
    sub.correr('mostrarHorarioEquipo(' + JSON.stringify(datosCon(sub, [39, 40], {})) + ')');
    sub.correr('navSemana(1)');
    ok('SUBGERENTE CON NÚMERO · tampoco cambia de semana', sub.correr('_semana') === 39);
  }

  /* 2 · Sábado después de las 5 p. m. le toca la semana siguiente. Si esa no
        está guardada, no se le pinta nada: se le dice que no se ha publicado. */
  {
    const ent = arrancar('2026-09-26T23:05:00Z', { empno:'900003', puesto:'Asesor' });   // sáb 5:05 p. m.
    ent.correr('mostrarHorarioEquipo(' + JSON.stringify(datosCon(ent, [39], { semana_40: VACIA })) + ')');
    ok('SIN PUBLICAR · le toca la 40', ent.correr('_semana') === 40, ent.correr('_semana'));
    ok('SIN PUBLICAR · aviso visible', visible(ent, 'sin-asignar'));
    ok('SIN PUBLICAR · sin tabla', !visible(ent, 'wrapper-tabla'));
    ok('SIN PUBLICAR · le dice que no se ha publicado',
       /todavía no se publica/.test(ent.el('sin-asignar-tit').textContent), ent.el('sin-asignar-tit').textContent);
    ok('SIN PUBLICAR · y no le habla de configurar excepciones',
       !/Configura/.test(ent.el('sin-asignar-sub').innerHTML));
  }

  /* Los respaldos de antes del 4-ago-2026 traen la semana en `__publicadas`. */
  {
    const ent = arrancar(MARTES, { empno:'900003', puesto:'Asesor' });
    ent.correr('mostrarHorarioEquipo(' + JSON.stringify(datosCon(ent, [39], {}, true)) + ')');
    ok('RESPALDO VIEJO · `__publicadas` se sigue leyendo', lunes(ent) === MARCA, lunes(ent));
  }

  /* 3 · El gerente sí ve el borrador de la 41, y dice que es borrador. */
  {
    const ent = arrancar(MARTES, { puedeEditar:true });
    ent.correr('_cache = ' + JSON.stringify((() => { const d = datosCon(ent, [39, 40], { semana_41: VACIA });
      return { historial:{}, excepciones:d.excepciones, semanas_guardadas:d.semanas_guardadas }; })()) + '; renderSemana();');
    ok('GERENTE · con flechas', ent.el('btn-sem-sig').style.visibility !== 'hidden');
    ent.correr('navSemana(2)');
    ok('GERENTE · sí cambia de semana', ent.correr('_semana') === 41, ent.correr('_semana'));
    ok('GERENTE · la semana con configuración y sin guardar se ve', visible(ent, 'wrapper-tabla'));
    ok('GERENTE · rotulada como borrador que el equipo no ve',
       /Borrador/.test(ent.el('badge-semana').textContent) && /equipo aún no lo ve/.test(ent.el('badge-semana').textContent),
       ent.el('badge-semana').textContent);
    ent.correr('navSemana(1)');
    ok('GERENTE · sin configuración: sin asignar, con su instrucción',
       visible(ent, 'sin-asignar') && /Configura/.test(ent.el('sin-asignar-sub').innerHTML));
    ent.correr('navSemana(-2)');
    ok('GERENTE · la guardada no dice borrador', !/Borrador/.test(ent.el('badge-semana').textContent));
  }

  /* 4 · El latido: el sábado a las 5 p. m. pasa solo a la semana siguiente. */
  {
    const ent = arrancar('2026-09-26T22:59:00Z', { empno:'900003', puesto:'Asesor' });   // sáb 4:59 p. m.
    const d = datosCon(ent, [39, 40], {});
    datosServidor = d;
    ent.correr('mostrarHorarioEquipo(' + JSON.stringify(d) + ')');
    ok('SÁBADO 4:59 · todavía la semana 39', ent.correr('_semana') === 39, ent.correr('_semana'));
    rpcs = 0;
    en('2026-09-26T22:59:40Z');
    await ent.correr('latidoEquipo_()');
    ok('SÁBADO 4:59 · el latido no pide nada si no toca', rpcs === 0, rpcs);
    en('2026-09-26T23:00:05Z');                                                          // 5:00 p. m.
    await ent.correr('latidoEquipo_()');
    ok('SÁBADO 5:00 · el latido vuelve a pedir el horario', rpcs === 1, rpcs);
    ok('SÁBADO 5:00 · y pasa sola a la semana 40', ent.correr('_semana') === 40, ent.correr('_semana'));
    ok('SÁBADO 5:00 · enseñando la publicada', lunes(ent) === MARCA);
  }

  /* 4b · Aunque la última lectura sea de hace segundos: el cambio de semana no
        espera los 30 s con que se evita repetir al alternar de app. */
  {
    const ent = arrancar('2026-09-26T22:59:50Z', { empno:'900003', puesto:'Asesor' });   // sáb 4:59:50
    datosServidor = datosCon(ent, [39, 40], {});
    ent.correr('mostrarHorarioEquipo(' + JSON.stringify(datosServidor) + ')');
    rpcs = 0;
    en('2026-09-26T23:00:05Z');
    await ent.correr('latidoEquipo_()');
    ok('SÁBADO 5:00 RECIÉN LEÍDO · igual se pide y se pasa a la 40',
       rpcs === 1 && ent.correr('_semana') === 40, 'rpcs=' + rpcs + ' semana=' + ent.correr('_semana'));
  }

  /* 5 · Con la pantalla abierta, lo guardado llega en ≤ 2 minutos. */
  {
    const ent = arrancar(MARTES, { empno:'900003', puesto:'Asesor' });
    datosServidor = datosCon(ent, [], {});           // al leer: nada guardado aún
    ent.correr('mostrarHorarioEquipo(' + JSON.stringify(datosServidor) + ')');
    ok('ABIERTA · sin guardar, no se le pinta horario', visible(ent, 'sin-asignar') && !visible(ent, 'wrapper-tabla'));
    datosServidor = datosCon(ent, [39], {});         // el gerente guarda
    rpcs = 0;
    en('2026-09-22T16:01:30Z');
    await ent.correr('latidoEquipo_()');
    ok('ABIERTA · antes de 2 min no se pide', rpcs === 0, rpcs);
    en('2026-09-22T16:02:00Z');
    await ent.correr('latidoEquipo_()');
    ok('ABIERTA · a los 2 min se vuelve a pedir', rpcs === 1, rpcs);
    ok('ABIERTA · y ya enseña la que guardó el gerente', lunes(ent) === MARCA && visible(ent, 'wrapper-tabla'), lunes(ent));
  }

  /* 6 · El gerente no se refresca solo: puede tener cambios sin guardar. */
  {
    const ent = arrancar(MARTES, { puedeEditar:true });
    ent.correr('_cache = { historial:{}, excepciones:{}, semanas_guardadas:{} }; renderSemana();');
    rpcs = 0;
    en('2026-09-22T17:00:00Z');
    await ent.correr('latidoEquipo_()');
    ok('GERENTE · el latido no le toca la pantalla', rpcs === 0, rpcs);
  }

  if (fallos.length) {
    console.log('FALLAS en horario_publicado.js:\n  - ' + fallos.join('\n  - '));
    process.exit(1);
  }
  console.log('horario publicado: al navegar, sin publicar y sin recargar, el equipo ve lo que publicó el gerente');
})().catch(e => { console.log('FALLA horario_publicado.js: ' + (e && e.stack || e)); process.exit(1); });
