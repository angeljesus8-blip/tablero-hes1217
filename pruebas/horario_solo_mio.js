/* ============================================================
   El asesor ve SU horario; el gerente, el de todos
   ============================================================
   6-sep-2026. Corre en cada commit desde `verificar.py`.

   Pedido en piso: «en el proyecto de horarios, lo que pueden ver los chicos
   sería solamente su horario individual; el gerente sí el de todo el equipo».

   El horario ajeno salía por CUATRO sitios, y esconder tres no sirve de nada:

     1. las tarjetas del resto del equipo, en la vista de celular
     2. el botón «Ver tabla completa»
     3. la tabla, que en pantalla ancha se ve sin pedirla
     4. el pie de descansos fijos, que nombra a todo el equipo

   Es la misma forma del fallo de `seccionVisible_` en el tablero, donde el
   olvidado fue el hash de la URL.

   ⚠️ Y la tabla no basta con taparla por CSS: si se ESCRIBE con los datos de
   todos, el horario ajeno viaja dentro del HTML y se lee con «inspeccionar».
   Por eso la prueba mira lo que se escribió en `#cuerpo`, no si se ve.
   ============================================================ */
'use strict';
const fs = require('fs'), path = require('path');
const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'horarios.html'), 'utf8');

const { crearEntorno } = require('./dom.js');

/* Nombres inventados a propósito: este repo es público. Lo que importa es la
   forma —dos de gestión y dos asesores, cada uno con su número—, no quién es. */
const EQUIPO = {
  horaApertura: 10, horaCierre: 21,
  gerentes: [
    { key:'G1', nombre:'ANA GERENTE',   cargo:'Gerente de Tienda', emp:'900001', descFijo:5 },
    { key:'G2', nombre:'BENI SUBGER',   cargo:'Subgerente',        emp:'900002', descFijo:4 }
  ],
  asesores: [
    { key:'A1', nombre:'CARO ASESORA',  cargo:'Asesor',            emp:'900003', descFijo:3 },
    { key:'A2', nombre:'DANI ASESOR',   cargo:'Asesor',            emp:'900004', descFijo:1 }
  ]
};

/* El cliente de Supabase que la página espera de un <script src>. Ninguna de
   estas rutas se usa en la prueba —se llama a las funciones de pintado
   directamente—, pero sin el objeto el archivo no llega ni a cargarse. */
const SUPABASE_FALSO = {
  createClient: () => ({
    auth: { getSession: async () => ({ data:{ session:null } }),
            signInWithPassword: async () => ({ error:{ message:'no' } }),
            signOut: async () => ({}) },
    from: () => ({ select(){ return this; }, eq(){ return this; },
                   maybeSingle: async () => ({ data:null }),
                   upsert: async () => ({ error:null }) }),
    rpc: async () => ({ data:null })
  })
};

const fallos = [];
const ok = (t, c, extra) => { if(!c) fallos.push(t + (extra ? ' -> ' + extra : '')); };

/* Arranca la página, identifica a alguien y pinta la semana. Devuelve lo que
   quedó escrito en cada uno de los cuatro sitios. */
function verComo(opciones){
  const ent = crearEntorno({
    html, ruta:'/t/horarios.html', extras:{ supabase: SUPABASE_FALSO }
  });
  if(ent.err) return { error: ent.err };

  try{
    ent.correr('aplicarEquipo(' + JSON.stringify(EQUIPO) + ');');
    ent.correr('fijarSesion({ store_id:"1217", nombre:"Angelopolis" }, '
               + JSON.stringify(opciones) + ');');
    /* La cadena real de pintado: genera los turnos de la semana y de ahí salen
       la tabla y las tarjetas. Si se llamara solo a `renderMovil`, la tabla
       —que es el sitio que de verdad filtra datos— no se probaría. */
    ent.correr('const _d = generarSemana(_semana, null, null);'
             + 'renderTabla(_semana, _domingo, _d, calcularComidas(_d));');
  }catch(e){ return { error: (e && e.message) || String(e) }; }

  return {
    movil:  ent.htmlDe('vista-movil'),
    tabla:  ent.htmlDe('cuerpo'),
    pie:    ent.htmlDe('nota-pie'),
    soloMio: ent.el('body').classList.contains('solo-mi-horario')
  };
}

const NOMBRES_AJENOS = ['BENI SUBGER', 'CARO ASESORA', 'DANI ASESOR'];

/* ── 1 · El asesor: su semana y nada más ────────────────────────────────── */
{
  const v = verComo({ empno:'900003', puesto:'Asesor' });     // CARO
  ok('la página arranca para el asesor', !v.error, v.error);
  if(!v.error){
    ok('ve su propia semana', v.movil.indexOf('CARO ASESORA') >= 0, v.movil.slice(0, 200));
    ok('la página se marca como «solo mi horario»', v.soloMio === true);

    for(const n of ['BENI SUBGER', 'DANI ASESOR', 'ANA GERENTE']){
      ok('no ve a ' + n + ' en las tarjetas', v.movil.indexOf(n) < 0);
      /* La que más importa: que el dato NO ESTÉ, no que no se vea. */
      ok('no ve a ' + n + ' en la tabla', v.tabla.indexOf(n) < 0, v.tabla.slice(0, 300));
      ok('no ve a ' + n + ' en el pie de descansos', v.pie.indexOf(n.split(' ')[0]) < 0, v.pie);
    }
    ok('no se le ofrece la tabla completa', v.movil.indexOf('Ver tabla completa') < 0);
    // Su propio descanso fijo sí: es el dato con el que pide un cambio.
    ok('sí ve su propio descanso fijo', v.pie.indexOf('CARO') >= 0, v.pie);
  }
}

/* ── 2 · El gerente: el equipo entero ───────────────────────────────────── */
{
  const v = verComo({ empno:'900001', puesto:'Gerente de Tienda' });
  ok('el gerente arranca', !v.error, v.error);
  if(!v.error){
    ok('el gerente NO se marca como «solo mi horario»', v.soloMio === false);
    for(const n of NOMBRES_AJENOS)
      ok('el gerente ve a ' + n + ' en la tabla', v.tabla.indexOf(n) >= 0);
    ok('y se le ofrece la tabla completa', v.movil.indexOf('Ver tabla completa') >= 0);
  }
}

/* ── 3 · El subgerente que entra con su NÚMERO ──────────────────────────── */
{
  /* La trampa de este cambio, y el motivo de que `_verTodo` no sea
     `_puedeEditar`. Quien entra con su número no edita el horario —eso lo
     decide la RLS con su sesión de correo—, pero si lleva la tienda tiene que
     verlo entero. Atándolo a la edición, el subgerente vería una cosa entrando
     con su número y otra con su correo: la misma persona, el mismo puesto,
     distinta puerta. Es el fallo de `hoja_auth` y el de `vincular_mi_cuenta`,
     por tercera vez. */
  const v = verComo({ empno:'900002', puesto:'Subgerente' });
  ok('el subgerente por número ve al equipo', !v.error && v.tabla.indexOf('CARO ASESORA') >= 0,
     v.error || 'no lo ve');
  ok('y no se le marca «solo mi horario»', !v.error && v.soloMio === false);
}

/* ── 4 · El gerente dueño, que entra por correo y no tiene ficha ────────── */
{
  /* No trae `empno` ni puesto: su ficha no existe porque la cuenta es la de la
     tienda. Se cae en `puedeEditar`, y eso NO es un agujero — un asesor nunca
     llega aquí con sesión de Supabase. */
  const v = verComo({ puedeEditar:true });
  ok('el dueño sin ficha ve el equipo', !v.error && v.tabla.indexOf('CARO ASESORA') >= 0,
     v.error || 'no lo ve');
}

/* ── 5 · Un número que no está en el planeador ──────────────────────────── */
{
  /* Este hueco lo ABRE este cambio: antes, quien no se reconocía veía igual el
     horario de todos. Ahora no hay a quién enseñar, y una pantalla en blanco se
     lee como «la app no sirve» en vez de «falta un dato». */
  const v = verComo({ empno:'999999', puesto:'Asesor' });
  ok('un número desconocido no se queda con la pantalla vacía',
     !v.error && v.movil.indexOf('No encontramos tu horario') >= 0,
     v.error || v.movil.slice(0, 200));
  ok('y aun así no se le enseña a nadie más',
     !v.error && NOMBRES_AJENOS.every(n => v.tabla.indexOf(n) < 0), v.tabla.slice(0, 200));
}

/* ── 6 · La puerta de atrás ─────────────────────────────────────────────── */
{
  /* `verTablaCompleta` es global: sin su propia guardia, teclearla en la
     consola —o un botón que quede pintado de una versión en caché— abre la
     tabla del equipo. Aquí ya no hay datos ajenos que enseñar, pero la guardia
     es lo que impide que un cambio futuro los devuelva por esta puerta. */
  const ent = crearEntorno({ html, ruta:'/t/horarios.html', extras:{ supabase: SUPABASE_FALSO } });
  if(ent.err){ fallos.push('no arranca (bloque 6): ' + ent.err); }
  else{
    ent.correr('aplicarEquipo(' + JSON.stringify(EQUIPO) + ');');
    ent.correr('fijarSesion({ store_id:"1217", nombre:"A" }, { empno:"900003", puesto:"Asesor" });');
    ent.correr('verTablaCompleta(true);');
    ok('al asesor no se le abre la tabla ni llamándola a mano',
       !ent.el('body').classList.contains('ver-tabla'));
  }
}

if(fallos.length){
  console.log('horario · solo el mío: ' + fallos.length + ' fallo(s)');
  fallos.forEach(f => console.log('   · ' + f));
  process.exit(1);
}
console.log('horario · solo el mío: el asesor ve su semana por los cuatro sitios, el gerente el equipo entero');
