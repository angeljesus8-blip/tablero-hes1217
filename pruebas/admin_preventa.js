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
      if(nombre === 'tablero_todo')
        return o.inventario === 'error' ? { data:null, error:{ message:'sin red' } }
                                        : { data:{ inventario: o.inventario || [] }, error:null };
      if(nombre === 'carga_catalogo'){
        if(o.listaTrasCarga) o.lista = o.listaTrasCarga;
        return { data:{ ok:true, skus:2, agotados:0 }, error:null };
      }
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

  /* ── 8 · Si el inventario cierra una preventa, Admin lo dice ─────────── */
  {
    /* La cierra el trigger de supabase_preventa_autocierre.sql; aquí solo se
       cuida que el gerente se entere y de cuántas piezas llegaron. Un cierre
       callado deja al equipo buscando la tarjeta de preventa que ya no está. */
    const D3 = { sku:'900206', producto:'PRUEBA WATCH EN PREVENTA', precio:7999,
                 cupo:null, apartadas:2, quedan:null, activa:true };
    const OTRA = { sku:'900207', producto:'PRUEBA SIGUE EN PREVENTA', precio:999,
                   cupo:null, apartadas:0, quedan:null, activa:true };
    const { ent } = abrir({ lista:[D3, OTRA], listaTrasCarga:[Object.assign({}, D3, { activa:false }), OTRA] });
    await ent.correr("parsedCat=[{sku:'900206',desc:'x',onhand:'3'},{sku:'900207',desc:'y',onhand:'0'}]; subirCatalogo()");
    const h = ent.htmlDe('resCat');
    ok('la carga sale bien', /Catálogo actualizado/.test(h), h);
    ok('se avisa la preventa que se cerró', /PRUEBA WATCH EN PREVENTA — 3 en tienda/.test(h), h);
    ok('y no la que sigue abierta', !/PRUEBA SIGUE EN PREVENTA/.test(h), h);

    const sin = abrir({ lista:[OTRA] });
    await sin.ent.correr("parsedCat=[{sku:'900207',desc:'y',onhand:'0'}]; subirCatalogo()");
    ok('sin cierres no hay aviso de preventa', !/preventa/i.test(sin.ent.htmlDe('resCat')),
       sin.ent.htmlDe('resCat'));

    const caida = abrir({ lista:'error' });
    await caida.ent.correr("parsedCat=[{sku:'900206',desc:'x',onhand:'3'}]; subirCatalogo()");
    ok('si no se puede leer la preventa, la carga igual sale y no inventa un cierre',
       /Catálogo actualizado/.test(caida.ent.htmlDe('resCat')) &&
       !/preventa/i.test(caida.ent.htmlDe('resCat')), caida.ent.htmlDe('resCat'));
  }

  /* ── 9 · Abrir la preventa desde el CEA de promociones ─────────────────── */
  {
    /* El CEA 282 (Watch D3): mismo formato que uno de promos. Se ofrece
       preventa SOLO para lo que nunca ha llegado; un agotado que trae promo
       no es preventa, es traspaso. */
    /* Tal como las devuelve el lector con el PDF real del CEA 282: precios en
       texto con coma y SIN fecha de fin en el renglón (la pone el campo). Con
       números limpios esta prueba pasaba y el PDF de verdad daba $0. */
    const FILAS = [
      { sku:'900210', desc:'PRUEBA WATCH NUEVO NG', pr:'9,999.00', pp:'7,999.00', est:'Activo', d2:'' },
      { sku:'900211', desc:'PRUEBA WATCH NUEVO BN', pr:'9,999.00', pp:'7,999.00', est:'Activo', d2:'' },
      { sku:'900212', desc:'PRUEBA AGOTADO CON PROMO', pr:'4,999.00', pp:'3,999.00', est:'Activo', d2:'' },
      { sku:'900213', desc:'PRUEBA EOL NUEVO', pr:'999.00', pp:'499.00', est:'EOL', d2:'' },
      { sku:'900214', desc:'PRUEBA YA EN PREVENTA', pr:'2,999.00', pp:'1,999.00', est:'Activo', d2:'' }
    ];
    const INV = [{ sku:'900212', onhand:0 }];   // existió y se agotó
    const PV  = [{ sku:'900214', producto:'PRUEBA YA EN PREVENTA', precio:1999, cupo:null,
                   apartadas:0, quedan:null, activa:true }];
    const { ent, llamadas } = abrir({ lista:PV, inventario:INV });
    ent.correr('window.__F = ' + JSON.stringify(FILAS));
    await ent.correr('pvCeaPreparar(window.__F)');
    const h = ent.htmlDe('pvCea');
    ok('ofrece los que nunca llegaron', /900210/.test(h) && /900211/.test(h), h);
    ok('no ofrece el agotado que sí existió', !/900212/.test(h), h);
    ok('ni el EOL', !/900213/.test(h), h);
    ok('el que ya está en preventa se ve, sin casilla', /ya está en preventa/.test(h) &&
       (h.match(/class="pvCeaChk"/g) || []).length === 2, h);
    ok('nada viene marcado solo', !/checked/.test(h), h);
    ok('el precio sale del texto del CEA, no en $0', /\$7,999 \(regular \$9,999\)/.test(h) && !/\$0/.test(h), h);
    ent.el('vigD2Promos').value = '2026-10-31';

    await ent.correr('pvCeaAbrir()');
    ok('sin marcar nada no se abre nada', !llamadas.some(l => l.fn === 'carga_preventa'));

    /* El DOM de prueba no arma elementos desde innerHTML: las casillas se
       simulan con lo que pvCeaAbrir les lee (checked y data-i). */
    ent.correr("window.__chk = [0,1].map(i => ({ checked: i === 0, disabled:false, " +
               "getAttribute: () => String(i) })); " +
               "document.querySelectorAll = s => s === '.pvCeaChk' ? window.__chk : [];");
    await ent.correr('pvCeaAbrir()');
    const alta = llamadas.filter(l => l.fn === 'carga_preventa')[0];
    const f0 = alta && alta.args.p_filas;
    ok('abre solo lo marcado', f0 && f0.length === 1 && f0[0].sku === '900210', JSON.stringify(f0));
    ok('al precio de promo, con su nombre y sin cupo',
       f0 && f0[0].precio === 7999 && f0[0].producto === 'PRUEBA WATCH NUEVO NG' && f0[0].cupo === null,
       JSON.stringify(f0));
    const res = ent.htmlDe('resPvCea');
    ok('recuerda subir las promos y la fecha del CEA', /Sube también las promociones/.test(res) &&
       /2026-10-31/.test(res), res);

    /* Sin inventario no se sabe qué es nuevo: ofrecer «todo» abriría preventa
       de la tienda entera. */
    const caida = abrir({ lista:[], inventario:'error' });
    caida.ent.correr('window.__F = ' + JSON.stringify(FILAS));
    await caida.ent.correr('pvCeaPreparar(window.__F)');
    ok('sin inventario no ofrece nada', caida.ent.el('pvCea').style.display === 'none',
       caida.ent.htmlDe('pvCea'));
  }

  if(fallos.length){
    console.log('admin · preventa: ' + fallos.length + ' fallo(s)');
    fallos.forEach(f => console.log('   · ' + f));
    process.exit(1);
  }
  console.log('admin · preventa: se abre y se termina desde la pantalla, y el cupo vacío '
            + 'no se vuelve un cero, el cierre por inventario se avisa, y el CEA ofrece preventa solo de lo que nunca llegó (9 bloques)');
})();
