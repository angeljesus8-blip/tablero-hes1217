/* ============================================================
   El catálogo de accesorios se guarda COMPLETO
   ============================================================
   Corre en cada commit desde `verificar.py`.

   Existe por un fallo que estuvo dos días en el servidor sin que nadie lo
   viera, porque no daba error: `accesorio_catalogo_guardar` se escribió el
   18-ago, el día ANTES de que el catálogo tuviera `articulo` y `sku`, y solo
   guardaba (nombre, precio, orden). Un producto dado de alta con ella quedaba:

     · sin `articulo` → `accAdivinar` se salta las filas sin código, así que ese
       producto NUNCA se propone al leer un ticket. Parecería que el OCR empeoró.
     · con `sku` 43739 → cierto para micas, falso para los Office, que van al
       reporte de comisiones con SU código. La columna E del Excel saldría mal.

   Nunca llegó a usarse porque no había pantalla. Ahora la hay, así que estas
   comprobaciones son lo único que impide que vuelva:

     1. El alta manda `p_articulo` y `p_sku`; editar manda el id.
     2. El aviso de códigos parecidos usa LA MISMA regla que la adivinanza.
     3. Un asesor no ve el botón.

   La 2 importa porque son dos usos de la misma idea en sitios distintos: si el
   aviso dijera «todo bien» con un código que la adivinanza va a empatar, el
   gerente lo guardaría confiado y el producto dejaría de proponerse solo.
   ============================================================ */
'use strict';
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'captura_series.html'), 'utf8');

const { crearEntorno } = require('./dom.js');

const EQUIPO = ['Jorge Medina Rejón', 'Ana Ramírez Solís'];
const STORE  = { store_id:'1217', nombre:'Angelopolis', gas_url:'https://gas.example/exec',
                 gas_token:'t', vendedores:EQUIPO };

/* Lo que devolvería `accesorios_catalogo_admin`: productos reales del catálogo
   sembrado, con la colisión de $149 que ya existe en la tienda. */
const CATALOGO = [
  { id:1, articulo:'43739-MICAHR',    nombre:'MICA HR',         precio_ref:149,  sku:'43739', orden:10,  activo:true, usos:7 },
  { id:2, articulo:'43739-MICAMATTE', nombre:'MICA MATTE',      precio_ref:149,  sku:'43739', orden:20,  activo:true, usos:3 },
  { id:3, articulo:'63602',           nombre:'OFFICE PERSONAL', precio_ref:2249, sku:'63602', orden:300, activo:true, usos:0 }
];

const fallos = [];
const ok = (t, c, extra) => { if(!c) fallos.push(t + (extra ? ' -> ' + extra : '')); };

/* Solo se contesta a las funciones de catálogo. Todo lo demás rechaza, igual
   que en el resto de pruebas: así el arranque de la pantalla es el que ya está
   probado y esto no acaba midiendo otra cosa sin querer. */
function arrancar(puesto, catCaptura){
  const llamadas = [];
  const ent = crearEntorno({
    html,
    ruta: '/t/captura_series.html',
    ls: { hes_store: JSON.stringify(STORE),
          hes_empleado: JSON.stringify({ empno:'<empno>',
                                         nombre:'Ana Ramírez Solís',
                                         puesto: puesto }) },
    fetch: function(url, opt){
      const fn = String(url).split('/rpc/')[1] || '';
      let body = {};
      try{ body = JSON.parse((opt && opt.body) || '{}'); }catch(e){}
      let data;
      if(fn.indexOf('accesorios_catalogo_admin') === 0)      data = CATALOGO;
      else if(fn.indexOf('accesorios_catalogo_lista') === 0) data = catCaptura || CATALOGO;
      else if(fn.indexOf('accesorio_catalogo_') === 0)       data = { ok:true, id:99 };
      else return Promise.reject(new Error('sin red'));
      llamadas.push({ fn: fn, body: body });
      return Promise.resolve({ ok:true, json: () => Promise.resolve(data) });
    }
  });
  return Object.assign(ent, {
    llamadas: llamadas,
    guardados: () => llamadas.filter(x => x.fn.indexOf('accesorio_catalogo_guardar') === 0)
  });
}

async function bloque1(){
  const s = arrancar('Gerente de Tienda');
  ok('la pantalla arranca', !s.err, s.err);
  if(s.err) return;

  await s.caja.abrirAccCat();
  ok('el catálogo se pinta', s.el('catLista').innerHTML.indexOf('MICA HR') >= 0,
     s.el('catLista').innerHTML.slice(0, 120));

  // ── Alta ──
  s.caja.catNuevo();
  s.el('catNombre').value = 'MEMORIA USB ADATA 256GB';
  s.el('catArt').value    = '43739-USB256';
  s.el('catPrecio').value = '649';
  s.el('catSku').value    = '43739';
  s.el('catOrden').value  = '135';
  await s.caja.catGuardar();

  const g = s.guardados()[0];
  ok('el alta llega al servidor', !!g, 'no se llamó a accesorio_catalogo_guardar');
  if(g){
    ok('y con el nombre', g.body.p_nombre === 'MEMORIA USB ADATA 256GB', g.body.p_nombre);
    /* ESTAS DOS son el fallo que esta prueba existe para impedir. */
    ok('y CON EL CÓDIGO DE ARTÍCULO, o el producto no se propondría nunca',
       g.body.p_articulo === '43739-USB256', 'llegó: ' + JSON.stringify(g.body.p_articulo));
    ok('y CON EL SKU, que es la columna E del reporte de comisiones',
       g.body.p_sku === '43739', 'llegó: ' + JSON.stringify(g.body.p_sku));
    ok('y con el precio como número, no como texto',
       g.body.p_precio === 649, JSON.stringify(g.body.p_precio));
    ok('y sin id, porque es un alta',
       g.body.p_id === null || g.body.p_id === undefined, 'llegó id ' + g.body.p_id);
    ok('y diciendo quién lo hace, que es lo que el servidor comprueba',
       g.body.p_quien === '<empno>', g.body.p_quien);
  }

  // ── Editar: manda el id, no crea un duplicado ──
  s.llamadas.length = 0;
  await s.caja.abrirAccCat();
  s.caja.catElegir(0);                        // MICA HR
  ok('al elegir un producto se llena su código',
     s.el('catArt').value === '43739-MICAHR', s.el('catArt').value);
  ok('y se avisa de cuántas ventas llevan ese nombre, antes de renombrarlo',
     s.el('catUsos').style.display === 'block' &&
     s.el('catUsos').innerHTML.indexOf('7') >= 0, s.el('catUsos').innerHTML);

  s.el('catPrecio').value = '159';            // subió de precio
  await s.caja.catGuardar();
  const e = s.guardados()[0];
  ok('editar manda el id del producto', !!e && e.body.p_id === 1,
     'llegó id ' + (e && e.body.p_id));
  /* Si al editar se perdiera el artículo, el producto seguiría existiendo pero
     dejaría de proponerse: el fallo original, por la puerta de atrás. */
  ok('y conserva el código de artículo al editar',
     !!e && e.body.p_articulo === '43739-MICAHR', e && e.body.p_articulo);

  // ── Dar de baja NO borra: manda activo=false ──
  s.llamadas.length = 0;
  await s.caja.catBaja(0);
  const b = s.llamadas.filter(x => x.fn.indexOf('accesorio_catalogo_baja') === 0)[0];
  ok('la baja manda el id y activo=false', !!b && b.body.p_id === 1 && b.body.p_activo === false,
     JSON.stringify(b && b.body));
}

/* ── 2 · El aviso coincide con la adivinanza ────────────────────────────── */
async function bloque2(){
  /* El catálogo de CAPTURAR se sirve con los dos códigos que empiezan igual:
     así se puede comprobar, sobre el mismo dato, que el aviso advierte de algo
     real. Se pasa por la RPC y no tocando `_accCat` porque las `let` del script
     no son alcanzables desde fuera del contexto. */
  const s = arrancar('Gerente de Tienda', [
    { articulo:'43739-MICAHR',     nombre:'MICA HR',      precio_ref:149, sku:'43739' },
    { articulo:'43739-MICAHRPLUS', nombre:'MICA HR PLUS', precio_ref:199, sku:'43739' }
  ]);
  if(s.err){ fallos.push('la pantalla no arranca (bloque 2): ' + s.err); return; }

  await s.caja.abrirAccCat();
  s.caja.catNuevo();

  // Un código que no choca con nadie.
  s.el('catArt').value = '43739-USB256';
  s.caja.catMirarArt();
  ok('un código distinto no dispara el aviso',
     s.el('catAvisoArt').style.display === 'none',
     'avisó de más: ' + s.el('catAvisoArt').innerHTML);

  // Uno que sí: comparte «MICAHR» con la mica que ya existe.
  s.el('catArt').value = '43739-MICAHRPLUS';
  s.caja.catMirarArt();
  ok('un código que empieza igual que otro SÍ avisa',
     s.el('catAvisoArt').style.display === 'block',
     'no avisó, y este es el caso que rompe la propuesta');
  ok('y dice con cuál choca',
     s.el('catAvisoArt').innerHTML.indexOf('MICA HR') >= 0, s.el('catAvisoArt').innerHTML);

  /* La comprobación de verdad: que el aviso no se haya separado de la
     adivinanza. Con los dos códigos en el catálogo de capturar, un ticket de
     MICA HR ya no se resuelve solo —empatan en 6 letras—, que es exactamente
     de lo que avisa la caja de arriba. Si esto empezara a proponer algo, el
     aviso estaría advirtiendo de un problema que ya no existe. */
  await s.caja.abrirAcc();
  const propuesta = s.caja.accAdivinar('SERVICIO: 43739-MICAHR');
  ok('y con ese empate la app deja de proponer, que es de lo que avisa',
     propuesta === null, 'propuso: ' + propuesta);

  /* El precio repetido es aviso distinto: MICA HR y MICA MATTE cuestan las dos
     $149 y por eso ninguna se marca sola al leer el ticket. */
  await s.caja.abrirAccCat();
  s.caja.catNuevo();
  s.el('catPrecio').value = '149';
  s.caja.catMirarPrecio();
  ok('un precio que ya tiene otro producto avisa',
     s.el('catAvisoPrecio').style.display === 'block', 'no avisó del precio repetido');
}

/* ── 3 · Un asesor no ve el botón ───────────────────────────────────────── */
async function bloque3(){
  const s = arrancar('Asesor de Tienda');
  if(s.err){ fallos.push('la pantalla no arranca (bloque 3): ' + s.err); return; }
  await s.caja.abrirAcc();
  /* Esconde, no impide: el servidor lo vuelve a comprobar con
     `puede_gestionar_`. Pero si el botón se viera, un asesor podría cambiarle
     el precio de referencia a todo el catálogo creyendo que puede. */
  ok('el asesor no ve reporte ni catálogo',
     s.el('accGestion').style.display === 'none',
     'quedó en ' + s.el('accGestion').style.display);

  const s2 = arrancar('Subgerente de Tienda');
  if(!s2.err){
    await s2.caja.abrirAcc();
    /* Y el subgerente SÍ: es quien cubre los días que el gerente libra. Se
       comprueba en los dos sentidos porque un portero que dice que no a todo
       también «pasa» la prueba de que el asesor no entra. */
    ok('el subgerente sí los ve', s2.el('accGestion').style.display === 'flex',
       'quedó en ' + s2.el('accGestion').style.display);
  }
}

Promise.resolve()
  .then(bloque1).then(bloque2).then(bloque3)
  .then(function(){
    if(fallos.length){
      console.log('FALLOS en el catálogo de accesorios:');
      fallos.forEach(f => console.log('  · ' + f));
      process.exit(1);
    }
    console.log('catálogo de accesorios: bien');
  }, function(err){
    console.log('FALLO en el catálogo de accesorios: ' + (err && err.stack || err));
    process.exit(1);
  });
