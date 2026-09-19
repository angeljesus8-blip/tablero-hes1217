/* ============================================================
   Admin · Preventa: abrirla y terminarla sin un deploy
   ============================================================
   17-sep-2026. Corre en cada commit desde `verificar.py`.

   El 5-sep la preventa de los Pura 90S se quedó frenando apartados después de
   que el equipo ya había llegado: el cupo vivía en `preventa_cupo` y no había
   ninguna pantalla para tocarlo. Terminar la preventa pedía entrar a Supabase a
   correr un UPDATE a mano, así que no se hizo.

   Esta pestaña existe para eso. Lo que cuidan estos casos NO es que se pinte la
   lista: es que las dos frases que se parecen —«quedan 0» y «sin límite»— nunca
   se digan igual, y que el alta no deje pasar una fila que el tablero no sabría
   dibujar. Las dos fallan sin dar ningún error.
   ============================================================ */
'use strict';
const fs = require('fs'), path = require('path');
const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'admin.html'), 'utf8');

const { crearEntorno } = require('./dom.js');

const STORE = { store_id:'1217', nombre:'Angelopolis', gas_url:'', gas_token:'tok1217x',
                vendedores:[] };

/* `lista` – lo que contesta preventa_lista: filas, o 'error' para la RPC caída
   `falta` – la función todavía no está pegada en Supabase (PGRST202)          */
function supaFalso(o, llamadas){
  return { createClient: () => ({
    auth: { getSession: async () => ({ data:{ session:null }, error:null }) },
    rpc: async (nombre, args) => {
      llamadas.push({ fn:nombre, args:args });
      if(o.falta) return { data:null, error:{ message:
        'Could not find the function public.' + nombre + ' in the schema cache (PGRST202)' } };
      if(nombre === 'preventa_lista')
        return o.lista === 'error'
          ? { data:null, error:{ message:'sin red' } }
          : { data: o.lista || [], error:null };
      if(nombre === 'carga_preventa')    return { data:{ ok:true, filas:1 }, error:null };
      if(nombre === 'preventa_terminar') return { data:{ ok:true, cerradas: o.cerradas || 1 }, error:null };
      return { data:null, error:null };
    },
    from: () => ({ select: () => ({ eq: () => ({ order: () => ({ order: async () => ({ data:[], error:null }) }) }) }) })
  })};
}

function abrir(o){
  const llamadas = [];
  const ent = crearEntorno({ html, ruta:'/t/admin.html',
                             ls:{ hes1217_store: JSON.stringify(STORE) },
                             extras:{ supabase: supaFalso(o, llamadas) } });
  return { ent, llamadas };
}

(async () => {
  const fallos = [];
  const ok = (t, c, extra) => { if(!c) fallos.push(t + (extra ? ' -> ' + extra : '')); };

  /* ── 1 · El SQL sin pegar se dice con todas sus letras ───────────────── */
  {
    const { ent } = abrir({ falta:true });
    ok('admin.html carga', !ent.err, ent.err);
    await ent.correr('cargarPreventaAdmin()');
    const h = ent.htmlDe('pvLista');
    ok('el 404 de PostgREST se traduce', /supabase_preventa_abrir\.sql/.test(h), h);
    ok('y no se disfraza de «no hay preventa»', !/No hay ninguna preventa/.test(h), h);
    ok('sin poder leer, no se ofrece terminar nada',
       ent.el('pvBtnTodo').style.display === 'none', ent.el('pvBtnTodo').style.display);
  }

  /* ── 2 · La RPC caída tampoco dice «no hay preventa» ─────────────────── */
  {
    /* La mentira cara: el gerente lee que no hay preventa, no la termina, y el
       cupo sigue frenando apartados. Es exactamente el 5-sep otra vez. */
    const { ent } = abrir({ lista:'error' });
    await ent.correr('cargarPreventaAdmin()');
    const h = ent.htmlDe('pvLista');
    ok('la RPC caída se lee como error', /No se pudo leer la preventa/.test(h), h);
    ok('y no como una lista vacía', !/No hay ninguna preventa/.test(h), h);
  }

  /* ── 3 · Sin preventa se dice qué significa eso ──────────────────────── */
  {
    const { ent } = abrir({ lista:[] });
    await ent.correr('cargarPreventaAdmin()');
    ok('sin filas se explica que nada frena apartados',
       /No hay ninguna preventa/.test(ent.htmlDe('pvLista')), ent.htmlDe('pvLista'));
    ok('y no hay botón de terminar todas',
       ent.el('pvBtnTodo').style.display === 'none');
  }

  /* ── 4 · «Quedan 0» y «sin límite» no se pueden confundir ────────────── */
  {
    const { ent } = abrir({ lista:[
      { sku:'900201', producto:'PRUEBA PREVENTA CON CUPO', precio:12999,
        cupo:36, apartadas:36, quedan:0, activa:true },
      { sku:'900202', producto:'PRUEBA PREVENTA SIN LIMITE', precio:4999,
        cupo:null, apartadas:8, quedan:null, activa:true },
      { sku:'900203', producto:'PRUEBA PREVENTA YA TERMINADA', precio:999,
        cupo:10, apartadas:3, quedan:7, activa:false }
    ] });
    await ent.correr('cargarPreventaAdmin()');
    const h = ent.htmlDe('pvLista');
    ok('la agotada enseña su cuenta', /36 de 36 · quedan 0/.test(h), h);
    ok('la de sin tope dice «sin límite»', /8 apartadas · sin límite/.test(h), h);
    ok('y no inventa un «quedan» para ella', !/quedan null|quedan undefined/.test(h), h);
    ok('las abiertas ofrecen terminarse',
       (h.match(/pvTerminar\('9002/g) || []).length === 2, h);
    ok('la terminada ya no ofrece el botón', !/pvTerminar\('900203'/.test(h), h);
    ok('y se ve que está terminada', /terminada<\/span>/.test(h), h);
    ok('con preventas abiertas sí hay «terminar todas»',
       ent.el('pvBtnTodo').style.display === '', ent.el('pvBtnTodo').style.display);
  }

  /* ── 5 · El alta no deja pasar una fila que el tablero no sabría pintar ─ */
  {
    const { ent, llamadas } = abrir({ lista:[] });
    ent.el('pvSku').value = '900204';
    ent.el('pvProducto').value = '';     // sin nombre: la tarjeta saldría muda
    await ent.correr('pvAbrir()');
    ok('sin producto no se abre la preventa',
       !llamadas.some(l => l.fn === 'carga_preventa'), JSON.stringify(llamadas));
    ok('y se dice por qué hace falta el nombre',
       /Falta el producto/.test(ent.htmlDe('resPvAlta')), ent.htmlDe('resPvAlta'));

    ent.el('pvProducto').value = 'PRUEBA PREVENTA CON STOCK';
    ent.el('pvCupo').value = '36 piezas';   // el cupo son piezas, no texto
    await ent.correr('pvAbrir()');
    ok('un cupo que no es número no llega a la base',
       !llamadas.some(l => l.fn === 'carga_preventa'), JSON.stringify(llamadas));
  }

  /* ── 6 · El cupo vacío viaja como NULL, no como cero ─────────────────── */
  {
    /* En la base, `cupo` NULL es «sin límite» y 0 es «no se puede apartar
       nada». Mandar 0 por descuido abre una preventa que bloquea todo. */
    const { ent, llamadas } = abrir({ lista:[] });
    ent.el('pvSku').value = '900205';
    ent.el('pvProducto').value = 'PRUEBA PREVENTA SIN LIMITE';
    ent.el('pvCupo').value = '';
    await ent.correr('pvAbrir()');
    const alta = llamadas.filter(l => l.fn === 'carga_preventa')[0];
    ok('el alta llega a la base', !!alta, JSON.stringify(llamadas));
    ok('con el cupo en null', alta && alta.args.p_filas[0].cupo === null,
       JSON.stringify(alta && alta.args.p_filas[0]));
    ok('y con la tienda y el token de esta tienda',
       alta && alta.args.p_store === '1217' && alta.args.p_token === 'tok1217x',
       JSON.stringify(alta && { s:alta.args.p_store, t:alta.args.p_token }));
    ok('se avisa que es sin límite', /sin límite/.test(ent.htmlDe('resPvAlta')),
       ent.htmlDe('resPvAlta'));
  }

  /* ── 7 · Terminar una preventa y terminarlas todas son dos cosas ─────── */
  {
    const { ent, llamadas } = abrir({ lista:[
      { sku:'900201', producto:'PRUEBA PREVENTA CON CUPO', precio:12999,
        cupo:36, apartadas:36, quedan:0, activa:true }
    ], cerradas:1 });
    await ent.correr('cargarPreventaAdmin()');
    await ent.correr("pvTerminar('900201')");
    const una = llamadas.filter(l => l.fn === 'preventa_terminar')[0];
    ok('terminar una manda su SKU', una && una.args.p_sku === '900201',
       JSON.stringify(una && una.args));

    await ent.correr('pvTerminar(null)');
    const todas = llamadas.filter(l => l.fn === 'preventa_terminar')[1];
    ok('terminar todas manda p_sku en null', todas && todas.args.p_sku === null,
       JSON.stringify(todas && todas.args));
    ok('y se confirma lo que quedó suelto',
       /vuelve a apartarse/.test(ent.htmlDe('resPvFin')), ent.htmlDe('resPvFin'));
  }

  if(fallos.length){
    console.log('admin · preventa: ' + fallos.length + ' fallo(s)');
    fallos.forEach(f => console.log('   · ' + f));
    process.exit(1);
  }
  console.log('admin · preventa: se abre y se termina desde la pantalla, y el cupo vacío '
            + 'no se vuelve un cero (7 bloques)');
})();
