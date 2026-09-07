/* ============================================================
   Corregir o borrar un ticket de Mr Fix
   ============================================================
   6-sep-2026. Corre en cada commit desde `verificar.py`.

   Pedido en piso: «cuando suben un ticket mal del de Mr Fix no se puede borrar,
   no se puede modificar». Y las dos cosas, a elección: unas veces sobra el
   ticket entero y otras solo está mal un campo.

   ⚠️ EL RIESGO QUE ESTO INTRODUCE es el mismo que vigila `mrfix_tipo.js` para
   la captura, y aquí vuelve por partida doble: accesorio y reparación se
   corrigen y se borran desde LA MISMA lista, y lo único que los separa es qué
   función se llama. Si esa decisión se rompe, una reparación entra en
   `accesorios_ventas` —o una línea de accesorio se borra creyendo que era una
   reparación— y eso acaba en el Excel regional que comparten diez tiendas.
   Se vería, si acaso, al cuadrar la región semanas después.

   Por eso la prueba mira LA LLAMADA QUE SALE A LA RED, no la pantalla: es el
   único punto donde la decisión ya no se deshace.
   ============================================================ */
'use strict';
const fs = require('fs'), path = require('path');
const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'captura_series.html'), 'utf8');

const { crearEntorno } = require('./dom.js');

const EQUIPO = ['Jorge Medina Rejon', 'Luis de Jesus Ortega Vidal'];
const STORE  = { store_id:'1217', nombre:'Angelopolis', gas_url:'', gas_token:'tok12345',
                 vendedores:EQUIPO };
const GERENTE = { empno:'900001', nombre:'Quien sea', puesto:'Gerente de Tienda' };
const ASESOR  = { empno:'900003', nombre:'Otro',      puesto:'Asesor de Tienda' };

/* Un día con las dos cosas: es el caso normal de un ticket de Mr Fix. */
const DIA = [
  { tipo:'accesorio', id:11, dia:'2026-09-06', ticket:'33999', producto:'MICA HR',
    sku:'43739', cantidad:1, precio:149, importe:149, vendedor:EQUIPO[0],
    captura_id:'c1', tiene_foto:true, capturado_por:'900003' },
  { tipo:'reparacion', id:22, dia:'2026-09-06', ticket:'34010', producto:null,
    sku:null, cantidad:null, precio:null, importe:850, vendedor:null,
    captura_id:'c2', tiene_foto:true, capturado_por:'900003' }
];

const esperar = () => new Promise(r => setTimeout(r, 30));

/* Abre la pantalla como `quien` y devuelve con qué se llamó a la red.
   `dia` es lo que contesta `mrfix_dia` (una lista, o null para «no contestó»). */
async function abrir(quien, dia){
  const llamadas = [];
  const fetchFalso = (url, opciones) => {
    const fn = String(url).split('/rpc/')[1] || String(url);
    let body = {};
    try{ body = JSON.parse((opciones && opciones.body) || '{}'); }catch(e){}
    llamadas.push({ fn, body });

    let cuerpo = [];
    if(fn === 'mrfix_dia'){
      if(dia === null) return Promise.resolve({ ok:false, status:500, json:()=>Promise.resolve({}) });
      cuerpo = dia;
    }else if(fn === 'accesorios_catalogo_lista'){
      cuerpo = [{ id:1, nombre:'MICA HR',   articulo:'43739-MICAHR',   precio:149, sku:'43739', orden:10 },
                { id:2, nombre:'MICA MATTE', articulo:'43739-MICAMATTE', precio:149, sku:'43739', orden:20 }];
    }else if(/_editar$|_eliminar$/.test(fn)){
      cuerpo = { ok:true, borradas:1 };
    }
    return Promise.resolve({ ok:true, status:200,
      json:()=>Promise.resolve(cuerpo), text:()=>Promise.resolve(JSON.stringify(cuerpo)) });
  };

  const ent = crearEntorno({
    html, ruta:'/t/captura_series.html', fetch: fetchFalso, confirm:true,
    ls:{ hes_store: JSON.stringify(STORE), hes_empleado: JSON.stringify(quien) }
  });
  if(ent.err) return { error: ent.err };

  try{
    // El catálogo hace falta para el selector de producto al corregir.
    ent.correr('abrirAcc();');
    await esperar();
    ent.correr('abrirMrFixDia();');
    await esperar();
  }catch(e){ return { error: (e && e.message) || String(e) }; }

  return { ent, llamadas,
           lista: () => ent.htmlDe('mfLista'),
           abierto: () => ent.el('mfPanel').classList.contains('show'),
           deFn: (fn) => llamadas.filter(c => c.fn === fn) };
}

(async () => {
  const fallos = [];
  const ok = (t, c, extra) => { if(!c) fallos.push(t + (extra ? ' -> ' + extra : '')); };

  /* ── 1 · La lista enseña las dos cosas, distinguidas ────────────────── */
  {
    const r = await abrir(GERENTE, DIA);
    ok('la pantalla arranca', !r.error, r.error);
    if(!r.error){
      ok('el panel se abre para el gerente', r.abierto());
      ok('se pide el día con el token', (r.deFn('mrfix_dia')[0] || {}).body?.p_token === 'tok12345',
         JSON.stringify(r.deFn('mrfix_dia')[0]));
      ok('sale el accesorio con su producto', r.lista().indexOf('MICA HR') >= 0);
      ok('y la reparación NO finge tener producto',
         r.lista().indexOf('trabajo del técnico') >= 0, r.lista().slice(0, 300));
      ok('cada uno dice lo que es',
         r.lista().indexOf('reparación') >= 0 && r.lista().indexOf('accesorio') >= 0);
    }
  }

  /* ── 2 · Al asesor no se le abre ────────────────────────────────────── */
  {
    /* Esconder el botón no basta: `abrirMrFixDia()` es global y la pantalla se
       sirve igual a todos. Mismo criterio que el ✏️ de corregir una venta, y el
       servidor lo vuelve a comprobar con `p_quien`. */
    const r = await abrir(ASESOR, DIA);
    if(!r.error){
      ok('el asesor no abre el panel ni llamándolo a mano', !r.abierto());
      ok('y no se le pide el día', r.deFn('mrfix_dia').length === 0);
    }
  }

  /* ── 3 · Cada tipo va a SU función, y no a la del otro ──────────────── */
  {
    const r = await abrir(GERENTE, DIA);
    if(!r.error){
      // El accesorio es la fila 0; la reparación, la 1.
      r.ent.correr('abrirMfEditar(0);');
      r.ent.el('mfTicket').value  = '33999';
      r.ent.el('mfFecha').value   = '2026-09-06';
      r.ent.el('mfCant').value    = '1';
      r.ent.el('mfPrecio').value  = '149';
      r.ent.el('mfImporte').value = '149';
      r.ent.correr('guardarMfEdicion();');
      await esperar();
      ok('corregir un accesorio llama a accesorio_editar', r.deFn('accesorio_editar').length === 1,
         JSON.stringify(r.llamadas.map(c => c.fn)));
      ok('y NO a reparacion_editar', r.deFn('reparacion_editar').length === 0);
      const b = (r.deFn('accesorio_editar')[0] || {}).body || {};
      ok('manda el id de la fila', b.p_id === 11, JSON.stringify(b));
      ok('y el SKU del catálogo, no tecleado', b.p_sku === '43739', JSON.stringify(b));
      // `p_quien` es lo que el servidor comprueba contra el puesto.
      ok('y quién lo hace', b.p_quien === '900001', JSON.stringify(b));

      r.ent.correr('abrirMfEditar(1);');
      r.ent.el('mfTicket').value  = '34010';
      r.ent.el('mfFecha').value   = '2026-09-06';
      r.ent.el('mfImporte').value = '900';
      r.ent.correr('guardarMfEdicion();');
      await esperar();
      ok('corregir una reparación llama a reparacion_editar', r.deFn('reparacion_editar').length === 1);
      ok('y NO a accesorio_editar otra vez', r.deFn('accesorio_editar').length === 1);
    }
  }

  /* ── 4 · Borrar, también cada uno por su puerta ─────────────────────── */
  {
    const r = await abrir(GERENTE, DIA);
    if(!r.error){
      r.ent.correr('borrarMfTicket(1);');   // la reparación
      await esperar();
      ok('borrar una reparación llama a reparacion_eliminar', r.deFn('reparacion_eliminar').length === 1,
         JSON.stringify(r.llamadas.map(c => c.fn)));
      ok('y NO a accesorio_eliminar', r.deFn('accesorio_eliminar').length === 0);
      const b = (r.deFn('reparacion_eliminar')[0] || {}).body || {};
      ok('con el id y quién', b.p_id === 22 && b.p_quien === '900001', JSON.stringify(b));
    }
  }

  /* ── 5 · La reparación no pide lo que no tiene ──────────────────────── */
  {
    const r = await abrir(GERENTE, DIA);
    if(!r.error){
      r.ent.correr('abrirMfEditar(1);');
      /* Producto, piezas y vendedor se ESCONDEN en una reparación, no se dejan
         vacíos: un campo que no se usa se acaba llenando de cualquier cosa. Es
         la misma decisión que en el panel de captura. */
      ok('en una reparación no se piden producto ni piezas ni vendedor',
         r.ent.el('mfSoloAcc').style.display === 'none',
         'display: ' + r.ent.el('mfSoloAcc').style.display);
      r.ent.correr('abrirMfEditar(0);');
      ok('y en un accesorio sí', r.ent.el('mfSoloAcc').style.display !== 'none');
    }
  }

  /* ── 6 · «No contestó» no puede leerse como «no hay nada» ───────────── */
  {
    /* `mrfix_dia` devuelve lista vacía cuando el token no sirve — así lo hace
       todo Mr Fix. Si un fallo de red se pintara igual que un día sin capturas,
       quien lo vea cierra la pantalla tan tranquilo y da por bueno que no había
       nada que corregir. */
    const sinRed = await abrir(GERENTE, null);
    if(!sinRed.error)
      ok('un fallo de red se dice como fallo',
         sinRed.lista().indexOf('No se pudo consultar') >= 0, sinRed.lista().slice(0, 160));

    const vacio = await abrir(GERENTE, []);
    if(!vacio.error){
      ok('un día sin capturas se dice distinto',
         vacio.lista().indexOf('no se ha capturado') >= 0, vacio.lista().slice(0, 160));
      /* Y aun así se menciona la sesión vieja: con el token caducado la lista
         llega vacía y parece un día tranquilo. */
      ok('y menciona que puede ser la sesión', vacio.lista().indexOf('sesión') >= 0);
    }
  }

  if(fallos.length){
    console.log('mrfix corregir: ' + fallos.length + ' fallo(s)');
    fallos.forEach(f => console.log('   · ' + f));
    process.exit(1);
  }
  console.log('mrfix corregir: cada tipo se corrige y se borra por su puerta, y el asesor no entra');

})();
