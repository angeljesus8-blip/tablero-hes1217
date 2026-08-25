/* ============================================================
   Mr Fix: el TICKET decide si es accesorio o reparacion
   ============================================================
   Corre en cada commit desde `verificar.py`.

   El asesor ya no elige el tipo a mano: los accesorios se reconocen por su
   codigo de articulo (43739 y los dos de Office) y las reparaciones por los
   suyos, que el gerente configura en Admin. Los dos salen del ticket detras de
   `SERVICIO:`.

   Lo que se vigila aqui no es que acierte, sino CUANDO SE CALLA. Equivocarse
   no es un campo mal puesto: manda la venta a la otra tabla. Un accesorio
   guardado como reparacion no entra en el Excel regional y esa comision no se
   le paga a nadie, sin que nada avise. Y el OCR de esta impresora falla de
   verdad: `CARGA100WTS` se leyo `CARGATOONTS 2 77`.

   Por eso hay tres casos que NO puede decidir: ticket con las dos cosas,
   ticket sin codigos reconocibles, y codigos sin configurar.
   ============================================================ */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'captura_series.html'), 'utf8');
const codigos = fs.readFileSync(path.join(__dirname, '..', 'acc_codigos.js'), 'utf8');

/* Se ejecutan SOLO las piezas que deciden, no la pantalla entera: `accClave`
   y `accPrefijo` de acc_codigos.js, y `accCodigos` + `accQueEs` de la pagina.
   Asi la prueba falla por la regla y no por cualquier otra cosa del panel.

   `SKUS_REP` se saca del propio HTML y no se reescribe aqui: si se copiara, el
   dia que cambie como se parte la lista —hoy por coma, espacio o salto— esta
   prueba seguiria probando la version vieja y diria que todo va bien. */
function motor(skusRep){
  const trozo = (nombre) => {
    const i = html.indexOf('function ' + nombre + '(');
    if(i < 0) throw new Error('no encuentro ' + nombre + ' en captura_series.html');
    let j = html.indexOf('{', i), hondo = 0, k = j;
    for(; k < html.length; k++){
      if(html[k] === '{') hondo++;
      else if(html[k] === '}'){ hondo--; if(!hondo) break; }
    }
    return html.slice(i, k + 1);
  };
  const decl = html.indexOf('var SKUS_REP =');
  if(decl < 0) throw new Error('no encuentro `var SKUS_REP =` en captura_series.html');
  const finDecl = html.indexOf(';', decl);

  const caja = { _cfgCS: { sku_reparacion: skusRep } };
  vm.createContext(caja);
  /* `accPartirSkus` va aparte desde el 24-ago: SKUS_REP dejo de ser constante
     porque `abrirAcc` lo refresca del servidor, y partir la lista se saco a su
     propia funcion. Se traen las dos del HTML, sin copiar ninguna. */
  vm.runInContext(codigos + '\n' +
    trozo('accPartirSkus') + '\n' +
    html.slice(decl, finDecl + 1) + '\n' +
    trozo('accCodigos') + '\n' + trozo('accQueEs'), caja);
  return (texto) => vm.runInContext('accQueEs(' + JSON.stringify(texto) + ')', caja);
}

/* Los DOS de la 1217, dichos por Angel el 24-ago-2026. Son dos y no uno, y esa
   es la razon de que la configuracion sea una lista: con uno solo configurado,
   las reparaciones cobradas con el OTRO se guardarian como accesorio y
   entrarian en el Excel de comisiones. */
const REP_A = '100175537', REP_B = '100175545';
const queEs = motor(REP_A + ',' + REP_B);
const soloUno = motor(REP_A);            // como si se hubiera configurado a medias
const sinConfigurar = motor('');

const T_ACC  = 'ATENDIDO POR ARTURO\nSERVICIO: 43739-MICAHR\nIMPORTE 149.00';
const T_REPA = 'ATENDIDO POR ARTURO\nSERVICIO: 100175537\nIMPORTE 850.00';
const T_REPB = 'ATENDIDO POR ARTURO\nSERVICIO: 100175545\nIMPORTE 1200.00';
const T_MIX  = 'SERVICIO: 43739-MICAHR\nSERVICIO: 100175545\nIMPORTE 999.00';
const T_NADA = 'ATENDIDO POR ARTURO\nTOTAL 149.00';
// El OCR de esta impresora confunde 1->T y 0->O: el codigo llega deformado.
const T_OCR  = 'SERVICIO: TOOT75537\nIMPORTE 850.00';

const CASOS = [
  ['accesorio solo',                queEs,         T_ACC,  'acc', false],
  ['reparacion con el primer sku',  queEs,         T_REPA, 'rep', true ],
  ['reparacion con el SEGUNDO sku', queEs,         T_REPB, 'rep', true ],
  ['reparacion con el OCR sucio',   queEs,         T_OCR,  'rep', true ],
  ['ticket con las DOS cosas',      queEs,         T_MIX,  null,  true ],
  ['sin codigos legibles',          queEs,         T_NADA, null,  false],
  ['codigos sin configurar',        sinConfigurar, T_REPA, null,  false],
  /* Configurado a medias: el segundo sku se lee como ACCESORIO y esa reparacion
     acabaria en el Excel de comisiones. No es un fallo del codigo —hace lo que
     le dijeron— pero deja escrito, y comprobado, por que la lista lleva los dos
     y por que quitar uno no es inofensivo. */
  ['solo un sku configurado',       soloUno,       T_REPB, 'acc', false],
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
