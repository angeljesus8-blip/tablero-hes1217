/* ============================================================
   Un producto, varios códigos del POS
   ============================================================
   6-sep-2026. Corre en cada commit desde `verificar.py`.

   El caso que lo trae, con tickets reales de la tienda (`ocr_ticket_real*.txt`):

     · ticket 4 y 5 → `IMEI / SERIE / SERVICIO: CARGATOONTS`   (OCR de CARGA100WTS)
     · ticket 7     → `IMEI / SERIE / SERVICIO: CARGADOR100`   importe $999.00

   Los dos son el MISMO producto: el cargador de 100W, $999. El POS lo imprime
   de dos formas y el catálogo solo admitía una (`43739-CARGA-100W`).

   Lo grave no era fallar, era CON QUÉ fallaba. Normalizado, `CARGADOR100`
   comparte OCHO letras con `43739 CARGADOR KIDS` y solo CINCO con
   `43739-CARGA-100W`, así que la adivinanza proponía **CARGADOR KIDS, $330**,
   para una venta de $999 — con toda confianza y sin ningún error. Y en un
   reporte de comisiones que se pega en el Excel de la región.

   ⚠️ NINGUNA REGLA DE PREFIJO PODÍA SALVAR ESTO. Se midió: el caso bueno
   (`CARGATOONTS p`, con la basura que el OCR le pega detrás) explica el 75 % de
   lo leído y el caso malo el 73 %. Afinar el umbral para separarlos habría sido
   decidir a ciegas por dos puntos, y el siguiente producto lo rompe otra vez.
   Lo que arregla el problema es que el catálogo pueda decir la verdad: que un
   producto tiene varios códigos.

   ⚠️ **Esto no se arregla solo con código.** Mientras el catálogo no lleve los
   dos códigos del cargador, la app sigue proponiendo KIDS. La capacidad está
   aquí; el dato se pone en Admin → Catálogo.
   ============================================================ */
'use strict';
const fs = require('fs'), path = require('path');
const raiz = path.join(__dirname, '..');
const { accChoca, accCodigosDe, accPrefijoMax, accClave } = require(path.join(raiz, 'acc_codigos.js'));
const { crearEntorno } = require('./dom.js');

const STORE = { store_id:'1217', nombre:'Angelopolis', gas_token:'t', vendedores:[] };
const EMP   = { empno:'1000001', nombre:'Quien sea', puesto:'Gerente de Tienda' };

/* El catálogo real de la tienda, en lo que toca a este caso. Los códigos son
   los que están dados de alta hoy; el del 100W lleva ya sus dos formas. */
const CAT = [
  { id:1, articulo:'43739-MICAHR',                      nombre:'MICA HR',       precio_ref:149,  sku:'43739', activo:true },
  { id:2, articulo:'43739-MICAMATTE',                   nombre:'MICA MATTE',    precio_ref:149,  sku:'43739', activo:true },
  { id:3, articulo:'43739-CARGA-66W',                   nombre:'CARGADOR 66W',  precio_ref:499,  sku:'43739', activo:true },
  { id:4, articulo:'43739-CARGA-100W, CARGADOR100',     nombre:'CARGADOR 100W', precio_ref:999,  sku:'43739', activo:true },
  { id:5, articulo:'43739 CARGADOR KIDS',               nombre:'CARGADOR KIDS', precio_ref:330,  sku:'43739', activo:true }
];

/* El mismo catálogo como estaba ANTES del alias, para poder enseñar el fallo. */
const CAT_VIEJO = CAT.map(c => c.id === 4 ? Object.assign({}, c, { articulo:'43739-CARGA-100W' }) : c);

/* Lo que el OCR sacó de verdad de cada ticket, tal cual, con su basura. */
const LEIDO_100W_A = 'SERVICIO: CARGA TOONTS';    // ticket 4
const LEIDO_100W_B = 'SERVICIO: CARGATOONTS p';   // ticket 5, con la `p` de más
const LEIDO_100W_C = 'SERVICIO: CARGADOR100';     // ticket 7, $999
const LEIDO_MICA   = 'SERVICIO: 43739-MICAMATTE';

const fallos = [];
const ok = (t, c, extra) => { if(!c) fallos.push(t + (extra ? ' -> ' + extra : '')); };

/* Captura, con el catálogo que se le pase. */
function conCatalogo(cat){
  const html = fs.readFileSync(path.join(raiz, 'captura_series.html'), 'utf8');
  const ent = crearEntorno({
    html, ruta:'/t/captura_series.html',
    ls: { hes1217_store: JSON.stringify(STORE), hes1217_empleado: JSON.stringify(EMP) }
  });
  if(ent.err){ fallos.push('Captura no arranca: ' + ent.err); return null; }
  // `acc_codigos.js` es un <script src> que el entorno no baja: se inyecta.
  ent.correr(fs.readFileSync(path.join(raiz, 'acc_codigos.js'), 'utf8'));
  ent.correr('_accCat = ' + JSON.stringify(cat) + ';');
  return ent;
}

/* ── 1 · Los tres tickets del cargador dan el MISMO producto ────────────── */
{
  const ent = conCatalogo(CAT);
  if(ent){
    for(const [txt, etiqueta] of [[LEIDO_100W_A, 'ticket 4'], [LEIDO_100W_B, 'ticket 5'],
                                  [LEIDO_100W_C, 'ticket 7']]){
      const r = ent.caja.accAdivinar(txt);
      ok(etiqueta + ' propone el cargador de 100W', r === 'CARGADOR 100W', 'propuso: ' + r);
      /* La que de verdad importa: proponer el KIDS es cambiar $999 por $330 en
         un reporte de comisiones, y nadie lo mira dos veces porque «ya venía
         puesto». */
      ok(etiqueta + ' NO propone el cargador kids', r !== 'CARGADOR KIDS', 'propuso el kids');
    }
    /* Y lo que ya funcionaba sigue igual: el alias no puede costar propuestas. */
    ok('la mica sigue proponiéndose', ent.caja.accAdivinar(LEIDO_MICA) === 'MICA MATTE',
       'propuso: ' + ent.caja.accAdivinar(LEIDO_MICA));
  }
}

/* ── 2 · Sin el alias, el fallo está ahí — y la prueba lo enseña ────────── */
{
  const ent = conCatalogo(CAT_VIEJO);
  if(ent){
    /* No es una prueba de lo que queremos, es la MEDIDA de por qué el alias
       hace falta: con un solo código, el ticket de $999 proponía el de $330.
       Si algún día esto dejara de proponer el kids por otro motivo, hay que
       venir aquí y entender qué cambió antes de borrar la prueba. */
    ok('con un solo código, el ticket de $999 proponía el kids (por eso el alias)',
       ent.caja.accAdivinar(LEIDO_100W_C) === 'CARGADOR KIDS',
       'propuso: ' + ent.caja.accAdivinar(LEIDO_100W_C));
  }
}

/* ── 3 · Un producto con dos alias no compite consigo mismo ─────────────── */
{
  /* La trampa de este cambio, y hay que buscarla con cuidado. `accAdivinar`
     exige ganarle al SEGUNDO; si cada alias entrara por separado, dos códigos
     del mismo producto se estorbarían entre ellos y el producto MEJOR dado de
     alta sería justo el único que no se propone nunca. No da error: se lee como
     «el OCR ya no acierta».

     ⚠️ El caso hay que elegirlo bien. Con los dos códigos del cargador esto NO
     se nota —uno puntúa 11 y el otro 5, así que gana igual— y la primera
     versión de esta prueba pasaba con el fallo puesto. Se ve solo cuando los
     dos alias EMPATAN, que es lo que pasa cuando el POS imprime el mismo
     tronco con dos sufijos y el ticket trae el tronco. */
  const dosSufijos = [{ id:9, articulo:'CARGA100WTS, CARGA100WPZ', nombre:'CARGADOR 100W',
                        precio_ref:999, sku:'43739', activo:true }];
  const ent = conCatalogo(dosSufijos);
  if(ent){
    const r = ent.caja.accAdivinar('SERVICIO: CARGA100W');
    ok('dos alias que empatan no se anulan entre sí', r === 'CARGADOR 100W', 'propuso: ' + r);
  }
}

/* ── 4 · El aviso de Admin mira TODOS los códigos ───────────────────────── */
{
  ok('un código nuevo que choca con un ALIAS se detecta',
     (accChoca('CARGADOR1000', CAT, null) || {}).nombre === 'CARGADOR 100W',
     'no lo detectó');
  /* Y al revés: el producto que ya tiene el alias no se acusa a sí mismo. */
  ok('el producto con alias no choca consigo mismo al editarlo',
     accChoca('43739-CARGA-100W, CARGADOR100', CAT, 4) === null, 'se acusó a sí mismo');
  ok('y uno distinto no da falsa alarma',
     accChoca('43739-USB256', CAT, null) === null, 'avisó de más');
}

/* ── 5 · Partir el campo ────────────────────────────────────────────────── */
{
  ok('se parte por coma y se limpian los espacios',
     JSON.stringify(accCodigosDe(' A1 , B2 ,, C3 ')) === JSON.stringify(['A1','B2','C3']),
     JSON.stringify(accCodigosDe(' A1 , B2 ,, C3 ')));
  ok('un campo sin comas sigue siendo un solo código',
     JSON.stringify(accCodigosDe('43739-MICAHR')) === JSON.stringify(['43739-MICAHR']));
  ok('un campo vacío no da ningún código',
     accCodigosDe('').length === 0 && accCodigosDe(null).length === 0);
  /* El separador se aplica ANTES de normalizar: `accClave` convierte `|` en `1`,
     así que un separador que ella toque desaparecería a veces. La coma no
     sobrevive a `accClave`, y por eso se parte antes. */
  ok('la coma no llega a la clave normalizada', accClave('A,B') === 'A8');
  ok('el mejor prefijo de un producto es el de su mejor código',
     accPrefijoMax('43739-CARGA-100W, CARGADOR100', accClave('CARGADOR100')) === 11,
     String(accPrefijoMax('43739-CARGA-100W, CARGADOR100', accClave('CARGADOR100'))));
}

if(fallos.length){
  console.log('códigos de accesorio: ' + fallos.length + ' fallo(s)');
  fallos.forEach(f => console.log('   · ' + f));
  process.exit(1);
}
console.log('códigos de accesorio: un producto admite las varias formas en que el POS lo imprime');
