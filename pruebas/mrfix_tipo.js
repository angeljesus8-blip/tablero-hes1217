/* ============================================================
   Mr Fix: el tipo elegido decide a QUÉ TABLA va la venta
   ============================================================
   Corre en cada commit desde `verificar.py`.

   Accesorio y reparación se capturan en el MISMO panel desde el 24-ago-2026:
   un solo botón «🔧 Mr Fix» y un selector arriba. Eso quitó una duplicación
   real —había dos flujos idénticos de foto y OCR— pero metió un riesgo que con
   dos botones no existía: ahora lo único que separa una cosa de la otra es una
   rama `if` dentro de `guardarAcc`.

   Y lo que hay al otro lado de esa rama no es cosmético. `accesorios_reporte`
   arma el pegado del Excel regional leyendo `accesorios_ventas`; una reparación
   guardada con `accesorio_guardar` entra en ese Excel como venta de accesorio,
   mueve las comisiones de todo el equipo y el importe de una hoja que comparten
   diez tiendas. No da error en ningún sitio: se vería, si acaso, al cuadrar la
   región semanas después.

   Por eso esta prueba no mira la pantalla: mira LA LLAMADA que sale a la red.
   Es el único punto donde la decisión ya no se puede deshacer.
   ============================================================ */
'use strict';
const fs = require('fs'), path = require('path');
const RUTA = path.join(__dirname, '..', 'captura_series.html');
const html = fs.readFileSync(RUTA, 'utf8');

const { crearEntorno } = require('./dom.js');

const EQUIPO = ['Jorge Medina Rejón', 'Luis de Jesús Ortega Vidal'];
const STORE  = { store_id:'1217', nombre:'Angelopolis', gas_url:'', gas_token:'tok12345',
                 vendedores:EQUIPO };
const EMP    = { empno:'2', nombre:'Luis de Jesús Ortega Vidal', puesto:'gerente' };

/* Captura una venta del tipo pedido y devuelve las funciones RPC que se
   llamaron, en orden. El `fetch` falso responde a todo lo que la pantalla pida
   —el catálogo entre otras cosas— y va anotando. */
async function capturar(tipo){
  const llamadas = [];
  const fetchFalso = (url, opciones) => {
    const fn = String(url).split('/rpc/')[1] || String(url);
    llamadas.push(fn);
    let cuerpo = [];
    if(fn === 'accesorios_catalogo_lista'){
      cuerpo = [{ id:1, nombre:'MICA HR', articulo:'43739-MICAHR', precio:149, sku:'43739', orden:10 }];
    }else if(fn === 'accesorio_guardar' || fn === 'reparacion_guardar'){
      cuerpo = { ok:true, id:1, importe:149 };
    }
    return Promise.resolve({
      ok:true, status:200,
      json: () => Promise.resolve(cuerpo),
      text: () => Promise.resolve(JSON.stringify(cuerpo))
    });
  };

  const ent = crearEntorno({
    html, ruta:'/t/captura_series.html', fetch: fetchFalso,
    ls: { hes_store: JSON.stringify(STORE), hes_empleado: JSON.stringify(EMP) }
  });
  if(ent.err) return { error: ent.err };

  try{
    /* `abrirAcc` es async: pide el catalogo con await. Sin esperarla, el
       selector de producto sigue vacio cuando se guarda y la venta se cae en la
       validacion, no en la rama que esta prueba quiere mirar. */
    ent.correr('abrirAcc();');
    await esperar();
    ent.correr('accTipo(' + JSON.stringify(tipo) + ');');
    // Los datos que el asesor teclea.
    ent.el('accTicket').value = '33999';
    ent.el('accPrecio').value = '149';
    ent.el('accFecha').value  = '2026-08-24';
    /* El producto se deja puesto TAMBIEN en la reparacion, aunque ahi ni se
       pregunte. Es el estado real del panel despues de capturar un accesorio, y
       sobre todo es lo que hace fuerte esta prueba: si el tipo se ignorara, con
       el producto vacio la venta se caeria en la validacion y el fallo se veria
       como «falta el producto». Con el producto puesto, una reparacion mal
       enrutada llega hasta `accesorio_guardar` — que es el fallo de verdad, el
       que acaba en el Excel— y la prueba lo dice con ese nombre. */
    ent.el('accProd').value = 'MICA HR';
    ent.correr('guardarAcc();');
    await esperar();
  }catch(e){ return { error: (e && e.message) || String(e) }; }

  return {
    llamadas,
    // Lo que la pantalla le diria al asesor si se negara a guardar. Se devuelve
    // para que un fallo diga POR QUE y no solo que la llamada no salio.
    queja: (ent.el('accError').style.display !== 'none')
             ? (ent.el('accError').textContent || '') : '',
    // Lo que ve el asesor: qué campos quedan a la vista con cada tipo
    verProducto: ent.el('accSoloAcc').style.display !== 'none',
    verPiezas:   ent.el('accSoloPiezas').style.display !== 'none',
    verVendedor: ent.el('accSoloVend').style.display !== 'none',
    avisoExcel:  ent.el('accNotaRep').style.display !== 'none'
  };
}

// La promesa de `guardarAcc` se resuelve en un microtask; se le da un respiro.
const esperar = () => new Promise(r => setTimeout(r, 30));

(async () => {
  const fallos = [];

  for(const [tipo, debe, prohibida] of [
        ['acc', 'accesorio_guardar',  'reparacion_guardar'],
        ['rep', 'reparacion_guardar', 'accesorio_guardar']]){
    const r = await capturar(tipo);
    if(r.error){ fallos.push(tipo + ': la pantalla se cae -> ' + r.error); continue; }

    if(r.llamadas.indexOf(debe) < 0){
      fallos.push(tipo + ': no llamo a `' + debe + '`' +
                  (r.queja ? ' — la pantalla dice: "' + r.queja + '"' : '') +
                  '. Salieron: ' + (r.llamadas.join(', ') || 'ninguna'));
    }
    /* Lo que de verdad protege el Excel. Si una reparacion sale por
       `accesorio_guardar`, acaba en `accesorios_ventas` y de ahi al pegado
       regional, sin que nada avise. */
    if(r.llamadas.indexOf(prohibida) >= 0){
      fallos.push(tipo + ': llamo a `' + prohibida + '`, QUE ES LA TABLA DE LA OTRA COSA' +
                  (tipo === 'rep' ? ' — esa reparacion acabaria en el Excel de comisiones' : ''));
    }
  }

  /* Y que el panel se vea como lo que es. No es cosmetica: el producto, las
     piezas y el vendedor no existen en una reparacion, y dejarlos a la vista
     invita a rellenarlos para que luego no se guarden en ninguna parte. */
  const acc = await capturar('acc');
  const rep = await capturar('rep');
  if(!acc.error && !rep.error){
    if(!acc.verProducto) fallos.push('accesorio: el selector de producto no se ve');
    if(!acc.verVendedor) fallos.push('accesorio: no se pregunta quien lo vendio');
    if(acc.avisoExcel)   fallos.push('accesorio: enseña el aviso de que NO va al Excel, y si va');
    if(rep.verProducto)  fallos.push('reparacion: pide producto, que no tiene');
    if(rep.verPiezas)    fallos.push('reparacion: pide piezas, que no tiene');
    if(rep.verVendedor)  fallos.push('reparacion: pide vendedor, y no comisiona a nadie');
    if(!rep.avisoExcel)  fallos.push('reparacion: no avisa de que no entra en el Excel');
  }

  if(fallos.length){
    console.log('mrfix: ' + fallos.length + ' fallo(s)');
    fallos.forEach(f => console.log('   · ' + f));
    process.exit(1);
  }
  console.log('mrfix: el tipo elegido manda la venta a su tabla, y el panel se ve como lo que es');
})();
