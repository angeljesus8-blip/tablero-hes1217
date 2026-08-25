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
    /* `accCodigos` se carga aunque `accQueEs` ya no lo use: si alguien vuelve
       a leerlo de ahi —el fallo del 24-ago— la prueba tiene que fallar diciendo
       QUE decidio mal, no «accCodigos is not defined», que suena a prueba rota
       y no a deteccion rota. */
    trozo('accCodigos') + '\n' +
    trozo('accNum') + '\n' + trozo('accNum3') + '\n' +
    trozo('accLineasArticulo') + '\n' +
    trozo('accSkuNorm') + '\n' + trozo('accSkusDeLineas') + '\n' +
    trozo('accExtraer') + '\n' + trozo('accQueEs'), caja);
  const fn = (texto) => vm.runInContext('accQueEs(' + JSON.stringify(texto) + ')', caja);
  fn.extraer = (texto) => vm.runInContext('accExtraer(' + JSON.stringify(texto) + ')', caja);
  return fn;
}

/* Los DOS de la 1217, dichos por Angel el 24-ago-2026. Son dos y no uno, y esa
   es la razon de que la configuracion sea una lista: con uno solo configurado,
   las reparaciones cobradas con el OTRO se guardarian como accesorio y
   entrarian en el Excel de comisiones. */
const REP_A = '100175537', REP_B = '100175545';
const queEs = motor(REP_A + ',' + REP_B);
const soloUno = motor(REP_A);            // como si se hubiera configurado a medias
const sinConfigurar = motor('');
const conCeros = motor('000' + REP_B);   // mismo sku, escrito con ceros delante

/* EL TEXTO QUE DE VERDAD SALE DEL OCR, guardado tal cual en
   `pruebas/ocr_ticket_real.txt` (24-ago-2026).

   No es el ticket transcrito a mano: es lo que Tesseract devuelve al leer la
   foto, con el borde del papel convertido en `N`, `NN`, `ON`, con rayas donde
   el papel solo tiene separacion, y con el IMEI leido `SRYUNZ4919600047`.

   Esta es la diferencia entre las tres versiones que fallaron y esta. Las tres
   se escribieron contra el ticket COMO SE VE, y las tres pasaban sus pruebas.
   Un ticket transcrito por quien escribe el codigo confirma lo que ese codigo
   ya supone; el crudo es el unico que puede desmentirlo. */
const T_REAL_REP = fs.readFileSync(
  path.join(__dirname, 'ocr_ticket_real.txt'), 'utf8');

const T_REAL_ACC = [
  'Articulo    Cantidad    Precio     Importe',
  'MICA HR',
  '000043739        1      149.000    $149.00  I',
  'IMEI / SERIE / SERVICIO: 43739-MICAHR',
  'Atendido por:PEREZ RAMIREZ,JUAN'
].join('\n');

const T_MIX = [
  'Articulo    Cantidad    Precio     Importe',
  'MICA HR',
  '000043739        1      149.000    $149.00  I',
  'REP FUERA DE GARANTIA HW 2',
  '100175545        1      1124.390   $1,124.39  I'
].join('\n');

const T_NADA = 'ATENDIDO POR ARTURO\nTOTAL 149.00';

const CASOS = [
  ['ticket REAL de reparacion',     queEs,         T_REAL_REP, 'rep', true ],
  ['ticket REAL de accesorio',      queEs,         T_REAL_ACC, 'acc', false],
  ['ticket con las DOS cosas',      queEs,         T_MIX,      null,  true ],
  ['sin lineas de articulo',        queEs,         T_NADA,     null,  false],
  ['codigos sin configurar',        sinConfigurar, T_REAL_REP, null,  false],
  /* Configurado a medias: el sku que falta se lee como ACCESORIO y esa
     reparacion acabaria en el Excel de comisiones. No es un fallo del codigo
     —hace lo que le dijeron— pero deja escrito, y comprobado, por que la lista
     lleva los dos y por que quitar uno no es inofensivo. */
  /* El catalogo guarda `000043739` y el ticket imprime `43739`; si alguien
     configura el sku de reparacion con ceros delante tiene que dar igual. Sin
     el recorte de ceros esto se leeria como accesorio y acabaria en el Excel. */
  ['sku configurado con ceros',     conCeros,      T_REAL_REP, 'rep', true ],
  ['solo un sku configurado',       soloUno,       T_REAL_REP, 'acc', false],
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

/* ── Y los NUMEROS de la reparacion ──────────────────────────────────────
   `accExtraer` buscaba literalmente la linea del 43739, asi que en una
   reparacion no encontraba nada y devolvia cantidad, precio e importe VACIOS:
   el asesor tenia que teclear el importe a mano sin que nada dijera por que.
   Se vio capturando la primera reparacion de verdad, el 24-ago. */
const numeros = [
  ['reparacion', queEs.extraer(T_REAL_REP), 1124.39, '33671', '23/8/26'],
  ['accesorio',  queEs.extraer(T_REAL_ACC),  149,    '',      ''],
];
for(const [que, r, importe, ticket, fecha] of numeros){
  if(r.importe == null){
    fallos.push(que + ': no leyo el importe de la linea del articulo — el asesor ' +
                'tendria que teclearlo a mano sin saber por que');
  }else if(Math.abs(r.importe - importe) > 0.01){
    fallos.push(que + ': leyo un importe de ' + r.importe + ' y el ticket dice ' + importe);
  }
  if(!r.cuadra){
    fallos.push(que + ': precio x cantidad no cuadra con el importe (' +
                r.precio + ' x ' + r.cant + ' vs ' + r.importe + ')');
  }
  if(ticket && r.ticket !== ticket) fallos.push(que + ': leyo el ticket "' + r.ticket + '" y es ' + ticket);
  if(fecha && r.fecha !== fecha)   fallos.push(que + ': leyo la fecha "' + r.fecha + '" y es ' + fecha);
}

/* ── La fecha aguanta que el OCR estropee el ancla ──────────────────────
   `accExtraer` saca ticket y fecha de la linea del pie —`1217 2 23/8/26 11:44
   AM 33671`—, y basta que lea mal un digito del 1217 para perder la fecha
   entera. El ticket ya tenia respaldo; la fecha no, y se quedaba vacia: la
   venta se guardaba con la de HOY, que en un corte mensual mueve de mes un
   ticket de fin de mes. */
const T_ANCLA_ROTA = T_REAL_REP.replace('1217 2 23/8/26', 'T2I7 2 23/8/26');
const rota = queEs.extraer(T_ANCLA_ROTA);
if(rota.fecha !== '23/8/26'){
  fallos.push('ancla rota: perdio la fecha ("' + rota.fecha + '") porque el OCR ' +
              'estropeo el 1217 del pie. La venta se guardaria con la fecha de hoy');
}

/* ── Y QUIEN ATENDIO se lee tambien en una reparacion ───────────────────
   «Lo atendio» es del TICKET desde v207, pero el codigo que lo rellena se
   quedo en la parte del accesorio: en una reparacion se salia antes de llegar
   y el campo no se rellenaba nunca, con el nombre impreso en el papel. */
const vend = queEs.extraer(T_REAL_REP).vend;
if(!vend || vend.toUpperCase().indexOf('PEREZ') < 0){
  fallos.push('no leyo quien atendio del ticket de reparacion (leyo "' + vend + '")');
}
{
  const orden = html.indexOf("if(_accTipo === 'rep'){");
  const dondeVend = html.indexOf('_accVendCasado = r.vend ?');
  if(dondeVend < 0 || dondeVend > orden){
    fallos.push('el vendedor se rellena DESPUES del corte de reparacion: en una ' +
                'reparacion no llega a ejecutarse y el campo se queda vacio');
  }
}

if(fallos.length){
  console.log('mrfix-detecta: ' + fallos.length + ' fallo(s)');
  fallos.forEach(f => console.log('   · ' + f));
  process.exit(1);
}
console.log('mrfix-detecta: ' + CASOS.length + ' tickets, decide solo cuando el papel no deja dudas');
