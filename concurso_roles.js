/* ============================================================
   Concurso ORO y PLATA — qué papel puede jugar cada producto
   ============================================================
   15-sep-2026.

   Éste es el único archivo que decide si algo es Core, Accesorio Huawei o
   TechSmart/Servicio. `concurso_nivel.js` sólo reparte papeles; de dónde sale
   el papel se contesta aquí.

   ------------------------------------------------------------
   TODO EL 43739 ES TECHSMART. LO DICE EL SKU, NO EL NOMBRE
   ------------------------------------------------------------
   Dicho por Ángel el 15-sep-2026: «todo lo que va con el SKU 43739 PRODUCTOS
   VARIOS es de TechSmart». Antes de eso la mica se había clasificado como
   accesorio Huawei, y con esa lectura el ticket 34140 daba PLATA en vez de ORO.

   Que la regla sea por SKU y no por nombre es lo que la hace fiable, y de tres
   maneras:

   1. El 43739 se imprime SIEMPRE como «PRODUCTOS VARIOS». El nombre de verdad
      sólo aparece en el campo de serie (`MICAHIDROGEL`, `CARGADOR100`), que es
      justo donde el OCR más falla: `CARGA100WTS` se leyó `CARGATOONTS`.
      El SKU son nueve dígitos en su propia columna.
   2. Un accesorio nuevo del 43739 se clasifica solo el día que entre. Con
      patrones de texto habría quedado `sin_rol` hasta que alguien lo añadiera.
   3. Se acabaron las dudas de marca. El cargador de 100 W parecía Huawei; se
      cobra con el 43739, así que es TechSmart.

   La división completa:

     · Core              → SÓLO MatePad, teléfono y MateBook. Tres cosas.
     · Accesorio Huawei  → todo lo demás de marca Huawei: watch, band, router,
                           mouse, M-Pencil, audífonos, teclados, fundas.
     · TechSmart         → TODO el 43739, sin mirar qué es.
     · Servicio          → Office (63602 y 57518), licencias, reparación Mr Fix.

   TechSmart y Servicio llenan LA MISMA casilla —la circular dice «Accesorio
   TechSmart **y/o** Servicio»—, así que distinguirlos no cambia ningún nivel.
   Se guardan separados de todos modos, porque la pantalla de validación tiene
   que poder decir cuál de los dos fue.

   ------------------------------------------------------------
   LO QUE NO SE RECONOCE **NO** SE DA POR NADA
   ------------------------------------------------------------
   Un producto nuevo que no empate con nada sale marcado `sin_rol`, la pantalla
   lo enseña en ámbar y el asesor le pone el papel a mano antes de guardar.

   Es la regla más importante del archivo. Si lo desconocido se tratara como
   «no cuenta», el primer accesorio que entre al catálogo empezaría a bajar
   tickets de ORO a PLATA sin dar un solo error: el asesor vería un nivel más
   bajo, no tendría a qué atribuirlo, y para cuando alguien lo notara el
   concurso ya habría terminado. Es exactamente el fallo del cargador de 100W
   del MAPA, que proponía CARGADOR KIDS con toda confianza.

   ------------------------------------------------------------
   LA TABLA MANDA; LOS PATRONES SON EL ARRANQUE
   ------------------------------------------------------------
   `aplicarRoles(lineas, tabla)` mira PRIMERO la tabla que viene de Supabase
   (`concurso_roles`, editable en Admin) y sólo cae en los patrones de abajo
   para lo que la tabla no cubre.

   Así la lista se corrige el día que la circular cambie, sin deploy y sin
   esperar a nadie — que es como ya funcionan el catálogo de accesorios y los
   códigos de artículo.
   ============================================================ */

(function (raiz) {
'use strict';

function norm(s) {
  return String(s == null ? '' : s)
    .toUpperCase()
    .replace(/[ÁÀÂÄ]/g, 'A').replace(/[ÉÈÊË]/g, 'E').replace(/[ÍÌÎÏ]/g, 'I')
    .replace(/[ÓÒÔÖ]/g, 'O').replace(/[ÚÙÛÜ]/g, 'U').replace(/Ñ/g, 'N')
    .replace(/\s+/g, ' ').trim();
}

/* ── Los patrones de arranque ────────────────────────────────
   Sólo para lo que tiene SKU propio: todo el 43739 lo resuelve `SKU_FIJO` de
   más abajo sin llegar aquí.

   Se prueban EN ORDEN y gana el primero que empate, así que lo específico va
   antes que lo general: `MOUSE HUAWEI` tiene que ir antes que cualquier patrón
   de `MOUSE`.

   El origen de cada uno está anotado: ticket real, catálogo o suposición
   pendiente de confirmar. Lo que no se midió se dice que no se midió. */
/* ── POR QUÉ FALTAN FRONTERAS A LA IZQUIERDA ────────────────
   21-sep-2026, ticket 34330, probado en el navegador con la foto real. El
   margen de la foto le pegó una letra a la descripción:

     UU CMATEPAD 12X 12/256GB BN + TECLD

   Con `\bMATEPAD\b`, esa `C` pegada basta: el patrón no empata, el MatePad se
   queda `sin_rol` y el ticket pasa de PLATA a «no califica» — porque sin core
   no hay nivel. Un ticket perfectamente leído (las tres líneas, los importes
   al centavo, la cuenta cerrada contra el Total) tirado por una letra que no
   está en el papel.

   Es el mismo error que ya se corrigió en `concurso_ticket.js` con las anclas
   `^` (19-sep-2026): comparar contra CÓMO está escrito en vez de contra lo que
   dice. Y no se caza con la suma, porque la suma cierra: el fallo no está en
   el dinero, está en el papel que juega el artículo.

   Así que la frontera izquierda se quita donde la palabra es inconfundible
   —MATEPAD, MATEBOOK, FREEBUDS, M-PENCIL, KEYBOARD— y la DERECHA se conserva
   donde distingue dos cosas distintas: `BAND\b` no puede empatar con BANDA ni
   `FIT ?\d` con OUTFIT. Quitar las dos fronteras a las palabras cortas sería
   cambiar un fallo silencioso por otro. */
var PATRONES = [
  // ── Servicio ──
  { re: /\bOFFICE\b|LICENCIA WINDOWS|\bLICENCIA\b/,
    roles: ['ts_serv'], clase: 'servicio', nota: 'catálogo de accesorios' },
  { re: /REP(ARACION)? FUERA DE GARANTIA|\bMR ?FIX\b/,
    roles: ['ts_serv'], clase: 'servicio', nota: 'tickets de reparación' },

  /* ── Core: SÓLO estos tres ──
     «La band no funcionaría como core. Core sólo sería MatePad, teléfono y
     MateBook» (Ángel, 15-sep-2026, corrigiendo lo que había dicho antes).

     La lista es corta a propósito y no se amplía por parecido: todo lo demás
     que fabrica Huawei —watch, band, router, audífonos— es accesorio. */
  { re: /MATEPAD\b|MATEBOOK\b|MATE ?BOOK\b/,
    roles: ['core'], clase: 'core', nota: 'core' },
  { re: /PURA ?\d|NOVA ?\d|\bMATE ?\d{2}|HUAWEI Y\d/,
    roles: ['core'], clase: 'core', nota: 'core · teléfono' },

  /* ── Accesorio Huawei: todo lo demás de marca Huawei ──
     Watch y band entran AQUÍ, no en core. Es lo que decide que un ticket de
     band + seguro + mica no califique: sin core no hay nivel. */
  { re: /WATCH\b|\bBAND\b|\bFIT ?\d/,
    roles: ['acc_hw'], clase: 'acc_hw', nota: 'wearable · no es core' },
  { re: /M-?PENCIL/,        roles: ['acc_hw'], clase: 'acc_hw', nota: 'ticket 34140' },
  { re: /MOUSE HUAWEI|\bCD26\b/, roles: ['acc_hw'], clase: 'acc_hw', nota: 'ticket 34140' },
  { re: /FREEBUDS|FREEARC|FREELACE|AUDIF.*HWEI|AUDIF.*HUAWEI/,
    roles: ['acc_hw'], clase: 'acc_hw', nota: 'ticket 34140' },
  { re: /ROUTER\b|\bBE3\b|\bCPE\b/,
    roles: ['acc_hw'], clase: 'acc_hw', nota: 'no es de los tres core' },
  { re: /TECLADO HUAWEI|FUNDA|SMART ?CASE|KEYBOARD/,
    roles: ['acc_hw'], clase: 'acc_hw', nota: 'suposición · confirmar' }
];

/* ── Los SKUs de caja que deciden solos ──────────────────────
   Van ANTES que cualquier patrón de texto: son exactos, y el texto es una foto.

   El 43739 es el genérico con el que se cobra todo lo de TechSmart, y el POS lo
   imprime siempre como «PRODUCTOS VARIOS». Office lleva caja propia —63602 el
   personal y 57518 el familiar— porque cada uno va a su columna del Excel
   regional; para el concurso los tres llenan la misma casilla. */
var SKU_FIJO = {
  '43739': { roles: ['ts_serv'], clase: 'techsmart',
             nota: 'TechSmart · todo el SKU 43739' },
  '63602': { roles: ['ts_serv'], clase: 'servicio', nota: 'Office Personal' },
  '57518': { roles: ['ts_serv'], clase: 'servicio', nota: 'Office Familia' }
};

/* ── Clasificar una línea ────────────────────────────────────
   `tabla` es un objeto { '<sku>': {roles, clase}, ... } que viene de Supabase.
   El SKU manda sobre el texto: es exacto y el texto es una foto. */
function rolesDe(linea, tabla) {
  if (linea && linea.es_garantia) {
    return { roles: [], clase: 'garantia', nota: 'garantía · línea propia del ticket' };
  }

  var sku = String((linea && linea.sku) || '');

  /* La tabla de Supabase manda sobre todo: es la que el gerente edita. */
  if (tabla && tabla[sku]) {
    var t = tabla[sku];
    return { roles: (t.roles || []).slice(), clase: t.clase || '',
             nota: t.nota || 'tabla de roles' };
  }

  /* Y el SKU de caja manda sobre el texto. Ver la cabecera: el 43739 se imprime
     siempre como «PRODUCTOS VARIOS», así que el nombre no sirve para nada y el
     SKU lo dice todo. */
  if (SKU_FIJO[sku]) {
    var f = SKU_FIJO[sku];
    return { roles: f.roles.slice(), clase: f.clase, nota: f.nota };
  }

  /* Para el resto, el texto. Se mira también la serie porque algunos productos
     llevan ahí su código de artículo. */
  var texto = norm((linea && linea.desc) || '') + ' ' + norm((linea && linea.serie) || '');

  for (var i = 0; i < PATRONES.length; i++) {
    if (PATRONES[i].re.test(texto)) {
      return { roles: PATRONES[i].roles.slice(), clase: PATRONES[i].clase,
               nota: PATRONES[i].nota };
    }
  }

  /* Sin rol. NO es «no cuenta»: es «hay que decirlo». Ver la cabecera. */
  return { roles: [], clase: 'sin_rol',
           nota: 'No se reconoce este producto. Ponle el papel a mano.' };
}

/* Deja cada línea con `roles`, `clase` y `nota`. Devuelve las líneas nuevas,
   sin tocar las de entrada. */
function aplicarRoles(lineas, tabla) {
  return (lineas || []).map(function (l) {
    var r = rolesDe(l, tabla);
    var copia = {};
    for (var k in l) if (l.hasOwnProperty(k)) copia[k] = l[k];
    copia.roles = r.roles;
    copia.clase = r.clase;
    copia.nota  = r.nota;
    return copia;
  });
}

/* Las que el asesor tiene que resolver antes de guardar. */
function sinClasificar(lineas) {
  return (lineas || []).filter(function (l) { return l.clase === 'sin_rol'; });
}

raiz.concursoRolesDe      = rolesDe;
raiz.concursoAplicarRoles = aplicarRoles;
raiz.concursoSinClasificar = sinClasificar;
raiz.CONCURSO_PATRONES    = PATRONES;
raiz.CONCURSO_SKU_FIJO    = SKU_FIJO;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { rolesDe: rolesDe, aplicarRoles: aplicarRoles,
                     sinClasificar: sinClasificar, PATRONES: PATRONES,
                     SKU_FIJO: SKU_FIJO };
}

})(typeof window !== 'undefined' ? window : globalThis);
