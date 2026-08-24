/* ============================================================
   Mr Fix: el TICKET decide si es accesorio o reparacion
   ============================================================
   Corre en cada commit desde `verificar.py`.

   El asesor ya no elige el tipo a mano: los accesorios se reconocen por su
   codigo de articulo (43739 y los dos de Office) y la reparacion por el suyo,
   que el gerente configura en Admin. Los dos salen del ticket detras de
   `SERVICIO:`.

   Lo que se vigila aqui no es que acierte, sino CUANDO SE CALLA. Equivocarse
   no es un campo mal puesto: manda la venta a la otra tabla. Un accesorio
   guardado como reparacion no entra en el Excel regional y esa comision no se
   le paga a nadie, sin que nada avise. Y el OCR de esta impresora falla de
   verdad: `CARGA100WTS` se leyo `CARGATOONTS 2 77`.

   Por eso hay tres casos que NO puede decidir: ticket con las dos cosas,
   ticket sin codigos reconocibles, y codigo de reparacion sin configurar.
   ============================================================ */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'captura_series.html'), 'utf8');
const codigos = fs.readFileSync(path.join(__dirname, '..', 'acc_codigos.js'), 'utf8');

/* Se ejecutan SOLO las piezas que deciden, no la pantalla entera: `accClave`
   y `accPrefijo` de acc_codigos.js, y `accCodigos` + `accQueEs` de la pagina.
   Asi la prueba falla por la regla y no por cualquier otra cosa del panel. */
function motor(skuRep){
  const trozo = (nombre) => {
    const i = html.indexOf('function ' + nombre + '(');
    if(i < 0) throw new Error('no encuentro ' + nombre + ' en captura_series.html');
    // Hasta la llave que cierra, contando anidamiento.
    let j = html.indexOf('{', i), hondo = 0, k = j;
    for(; k < html.length; k++){
      if(html[k] === '{') hondo++;
      else if(html[k] === '}'){ hondo--; if(!hondo) break; }
    }
    return html.slice(i, k + 1);
  };
  const caja = { _cfgCS: { sku_reparacion: skuRep } };
  vm.createContext(caja);
  vm.runInContext(codigos + '\n' +
    'var SKU_REP = String((_cfgCS && _cfgCS.sku_reparacion) || "").trim().toUpperCase().replace(/\s+/g, "");\n' +
    trozo('accCodigos') + '\n' + trozo('accQueEs'), caja);
  return (texto) => vm.runInContext('accQueEs(' + JSON.stringify(texto) + ')', caja);
}

const REP = '90001';
const queEs = motor(REP);
const sinConfigurar = motor('');

const T_ACC  = 'ATENDIDO POR ARTURO\nSERVICIO: 43739-MICAHR\nIMPORTE 149.00';
const T_REP  = 'ATENDIDO POR ARTURO\nSERVICIO: 90001-PANTALLA\nIMPORTE 850.00';
const T_MIX  = 'SERVICIO: 43739-MICAHR\nSERVICIO: 90001-PANTALLA\nIMPORTE 999.00';
const T_NADA = 'ATENDIDO POR ARTURO\nTOTAL 149.00';
// El OCR de esta impresora confunde 0->O y 1->T: el codigo llega deformado.
const T_OCR  = 'SERVICIO: 9OOOT-PANTALLA\nIMPORTE 850.00';

const CASOS = [
  ['accesorio solo',              queEs,         T_ACC,  'acc', false],
  ['reparacion sola',             queEs,         T_REP,  'rep', true ],
  ['reparacion con el OCR sucio', queEs,         T_OCR,  'rep', true ],
  ['ticket con las DOS cosas',    queEs,         T_MIX,  null,  true ],
  ['sin codigos legibles',        queEs,         T_NADA, null,  false],
  ['codigo sin configurar',       sinConfigurar, T_REP,  null,  false],
];

const fallos = [];
for(const [titulo, fn, texto, espera, debeDecir] of CASOS){
  let r;
  try{ r = fn(texto); }
  catch(e){ fallos.push(titulo + ': revienta -> ' + ((e && e.message) || e)); continue; }

  if(r.tipo !== espera){
    fallos.push(titulo + ': decidio "' + r.tipo + '" y tenia que ser "' + espera + '"' +
      (espera === null
        ? ' — decidir aqui manda la venta a una tabla sin poder saber si es la buena'
        : ''));
  }
  if(debeDecir && !r.porque){
    fallos.push(titulo + ': no explica por que. Sin motivo, el asesor no sabe si ' +
                'mirarlo o fiarse');
  }
}

if(fallos.length){
  console.log('mrfix-detecta: ' + fallos.length + ' fallo(s)');
  fallos.forEach(f => console.log('   · ' + f));
  process.exit(1);
}
console.log('mrfix-detecta: ' + CASOS.length + ' tickets, decide solo cuando el papel no deja dudas');
