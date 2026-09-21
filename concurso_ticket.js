/* ============================================================
   Concurso de tickets ORO y PLATA — leer el ticket y calificarlo
   ============================================================
   15-sep-2026.

   Una sola regla, en un solo sitio, porque la van a preguntar TRES pantallas y
   tienen que contestar lo mismo:

     · captura_series.html — lee la foto del ticket y propone el nivel.
     · tablero.html        — el marcador por asesor.
     · admin.html          — el detalle, para validar si de verdad calificaba.

   Si el marcador contara distinto que la pantalla que lo valida, el concurso se
   discute en el piso y se acabó: el asesor ve un oro que el tablero no le suma
   y nadie puede decir cuál de los dos miente.

   ------------------------------------------------------------
   LO QUE ESTE ARCHIVO **NO** TOCA
   ------------------------------------------------------------
   Ni `ventas`, ni `inventario_vivo`, ni `ventas_hoy`. El concurso se alimenta
   SOLO de la foto del ticket y vive en su propia tabla.

   No es purismo: `ventas_hoy` es el Assurant que se reporta con meta del 25 %.
   Si el concurso escribiera ahí, el KPI se movería solo y nadie lo ataría meses
   después a un concurso que ya terminó. Es la misma razón por la que
   `accesorios_ventas` es tabla aparte (MAPA, 18-ago-2026).

   ------------------------------------------------------------
   LA JERARQUÍA (circular HES, 11-sep-2026)
   ------------------------------------------------------------
     ORO   = 1 Core + 1 Accesorio Huawei + 1 Garantía + 1 TechSmart/Servicio
     PLATA = 1 Core + 1 Accesorio Huawei + (1 Garantía o 1 TechSmart/Servicio)

   ------------------------------------------------------------
   EL ROL NO ESTÁ PEGADO AL PRODUCTO
   ------------------------------------------------------------
   Dicho por Ángel el 15-sep-2026: «un core de ley es una MatePad, un celular,
   una MateBook, pero también podría ser un reloj o una band, ya que band +
   garantía + mica ya es plata».

   O sea que una Band es Core cuando es lo principal del ticket y Accesorio
   Huawei cuando el ticket ya trae un celular. Un mismo artículo, dos papeles.

   Por eso NO se clasifica artículo por artículo contando etiquetas: se buscan
   todas las asignaciones posibles y gana la que alcance el nivel más alto.
   Clasificar a la primera degradaría tickets buenos sin dar ningún error — el
   asesor vería PLATA donde le tocaba ORO y no habría forma de explicárselo.
   ============================================================ */

(function (raiz) {
'use strict';

/* ── Normalizar ──────────────────────────────────────────────
   El ticket sale de una foto: acentos comidos, mayúsculas irregulares y dobles
   espacios. Todo se compara ya aplanado. */
function norm(s) {
  return String(s == null ? '' : s)
    .toUpperCase()
    .replace(/[ÁÀÂÄ]/g, 'A').replace(/[ÉÈÊË]/g, 'E').replace(/[ÍÌÎÏ]/g, 'I')
    .replace(/[ÓÒÔÖ]/g, 'O').replace(/[ÚÙÛÜ]/g, 'U').replace(/Ñ/g, 'N')
    .replace(/\s+/g, ' ')
    .trim();
}

/* Un número del ticket. OJO con los dos formatos, que NO son el mismo:
     precio  → 1249.000  (TRES decimales; son 1,249 pesos)
     importe → $1,249.00  (DOS decimales y coma de miles)

   Leer el precio como separador de miles da $1,249,000 y la comprobación
   `precio × cantidad = importe` no cierra jamás. Ya pasó con los accesorios
   (MAPA, 18-ago-2026), y ahí la consecuencia fue mandar a revisar el 100 % de
   las líneas hasta que alguien se cansara y las diera por buenas.

   El OCR además confunde la coma con el punto, así que no se puede decidir por
   el separador: se decide por CUÁNTOS dígitos van detrás del último. */
function aNumero(txt) {
  var s = String(txt == null ? '' : txt).replace(/[$\s]/g, '');
  if (!s || !/^-?[\d.,]+$/.test(s)) return null;
  var neg = s.charAt(0) === '-';
  if (neg) s = s.slice(1);
  var ult = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  var v;
  if (ult < 0) {
    v = parseFloat(s);
    if (isNaN(v)) return null;
  } else {
    var dec = s.length - ult - 1;
    var enteros = s.slice(0, ult).replace(/[.,]/g, '');
    // 1 a 3 decimales = decimales de verdad (3 es el formato «precio»).
    // 4 o más = un separador de miles que el OCR leyó como punto.
    v = (dec >= 1 && dec <= 3)
      ? parseFloat(enteros + '.' + s.slice(ult + 1))
      : parseFloat(enteros + s.slice(ult + 1));
    /* CERO NO, `null`. Un importe que no se pudo leer valía cero, y cero es un
       número que miente: la pantalla enseñaba «$0.00» como si el ticket dijera
       eso, la línea entraba en la suma restando su propio importe, y el asesor
       no tenía forma de distinguir «no lo leí» de «no cuesta nada». Con `null`
       la línea queda marcada como dudosa y se repara desde el precio. */
    if (isNaN(v)) return null;
  }
  return neg ? -v : v;
}

/* ── Líneas que NUNCA son la descripción de un artículo ───────
   Van entre el nombre y el renglón de cifras, o debajo de él. Si alguna se
   colara como descripción, el artículo se quedaría llamándose «Autorizador:
   ROSA MARTINEZ» y no empataría con ningún rol: el ticket bajaría de nivel sin
   que nada fallara. */
var RUIDO = [
  /^AUTORIZADOR\s*:/,
  /^IMEI\s*\/\s*SERIE/,
  /^CODIGO (DESCUENTO|CAMBIO DE PRECIO)\s*:/,
  /^DESCUENTO\s*\$?/,
  /^PROMOCION\b/,
  /^#\s*:/,
  /^CLIENTE\s*:/,
  /^REIMPRIMIR/,
  /^VENTA NORMAL/,
  /^ARTICULO\s+CANTIDAD/,
  /^TOTAL\b/,
  /^TIPO\s+IMPORTE/,
  /^I-IVA/,
  /^(EFECTIVO|CAMBIO|DEBITO|CREDITO|VISA|MASTERCARD)\b/,
  /^NO\.?\s*CUENTA/,
  /DE AUTORIZACION/,
  /^AHORRASTE/,
  /^RECUENTO DE ARTICULOS/,
  /^ATENDIDO POR/,
  /^AUN ESTAS A TIEMPO/,
  /^[^A-Z0-9]*$/            // separadores, renglones vacíos y basura del OCR
];

function esRuido(linea) {
  var n = norm(linea);
  for (var i = 0; i < RUIDO.length; i++) if (RUIDO[i].test(n)) return true;
  return false;
}

/* El renglón de cifras de un artículo:  SKU  cantidad  precio  importe
     100259554   1   3498.000   $3,498.00  I
     000043739   1    149.000     $149.00  I
   El SKU lleva de 5 a 10 dígitos (el genérico va con ceros a la izquierda). */
var RE_CIFRAS = /(?:^|\s)(\d{5,10})\s+(\d{1,3})\s+([\d.,]+)\s+\$?\s*(-?[\d.,]+)/;

/* ── El «1» de la cantidad es el carácter más frágil del ticket ──
   21-sep-2026, ticket 34330. Medido sobre ocho tratamientos de imagen y dos
   fotos reales: los tratamientos que MEJOR leen el renglón —los que sacan el
   SKU de nueve dígitos y el importe al centavo— son justamente los que pierden
   la cantidad, porque un `1` solo, entre dos columnas de espacios, no tiene
   con qué sostenerse:

     000043739   169.000  $169.00  1     ← la cantidad se evaporó
     000043739 | 149.000  $149.00  1     ← salió como una barra

   Con la cantidad exigida, esas dos líneas no casaban y el artículo
   desaparecía ENTERO del ticket. Y desaparecer es el peor de los fallos aquí:
   el ticket baja de nivel con toda naturalidad, sin un solo error en pantalla.

   Por eso la cantidad deja de ser obligatoria, pero NO se inventa: se deduce
   de los otros dos números del propio renglón (`importe ÷ precio`), que es
   cómo se lee bien cada dato —el mismo criterio de los accesorios (MAPA,
   18-ago-2026)—. Si la división no da un entero limpio, no se deduce nada: se
   toma 1 y se avisa.

   Lo que esta expresión NO relaja es la forma de los dos números que quedan:
   ambos tienen que traer su separador decimal (`149.000`, `$149.00`). Sin esa
   exigencia, «100276717 1 14999.000» se leería como SKU + precio 1 + importe
   14999, y el MatePad costaría un peso. Por eso se prueba SIEMPRE después de
   `RE_CIFRAS`, nunca antes. */
var RE_CIFRAS_SIN_CANT =
  /(?:^|\s)(\d{5,10})\s+(?:[|lI!ij¡tí\[\]]{1,2}\s+)?(\d[\d.,]*[.,]\d{2,3})\s+\$?\s*(-?\d[\d.,]*[.,]\d{2})(?:\s|$)/;

/* La cantidad que el OCR no leyó, deducida de los dos números que sí leyó.
   Devuelve `null` cuando la división no cierra: entonces no se sabe, y eso se
   dice en vez de suponer. */
function cantidadDeducida(precio, importe) {
  if (!precio || importe == null) return null;
  var n = importe / precio;
  var r = Math.round(n);
  return (r >= 1 && r <= 99 && Math.abs(n - r) < 0.02) ? r : null;
}

/* ── El SKU del genérico con un dígito cambiado ──────────────
   21-sep-2026, 34330: `000043739` se leyó `000043733`. Un dígito, y el efecto
   es entero: sin el 43739 la línea no es TechSmart, se queda `sin_rol`, y el
   ticket pasa de PLATA a «no califica».

   Se repara porque el propio renglón trae un segundo testigo que el OCR lee
   mucho mejor que nueve dígitos seguidos: el POS imprime «PRODUCTOS VARIOS»
   SÓLO para el genérico (`concurso_roles.js`, 15-sep-2026). Así que un SKU a
   un dígito del 43739 en una línea que se llama VARIOS no es otro producto:
   es el 43739 mal leído.

   Las dos condiciones van juntas a propósito. Sólo por parecido se corregiría
   cualquier SKU de caja que acabe pareciéndose; sólo por el nombre se
   machacaría el SKU de un producto nuevo que el POS imprimiera igual. Y como
   toca un dato que se guarda, se dice: queda el leído en `sku_ocr` y un aviso
   con los dos números. */
var SKU_GENERICO = '43739';

function pareceGenerico(art) {
  var s = String(art.sku || '');
  if (s === SKU_GENERICO) return false;
  if (s.length !== SKU_GENERICO.length) return false;
  if (!/VARIOS/.test(norm(art.desc))) return false;
  var d = 0;
  for (var i = 0; i < s.length; i++) if (s.charAt(i) !== SKU_GENERICO.charAt(i)) d++;
  return d === 1;
}

/* El pie:  1217 2 14/9/26 6:03 PM 34140 900001
   El TICKET es el penúltimo número. El último es el cajero que cobró, y ese es
   justamente el que NO sirve: el vendedor es «Atendido por». Confundirlos le da
   el oro al gerente en vez de a quien vendió (MAPA, 18-ago-2026). */
var RE_PIE = /(?:^|\s)(\d{4})\s+(\d{1,2})\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}:\d{2}\s*[AP]\.?M\.?)\s+(\d{3,10})\s+(\w{3,10})(?:\s|$)/i;

/* ── Por qué ninguna de estas expresiones empieza en `^` ─────
   19-sep-2026, ticket 34273. El papel se fotografió sobre el teclado y con
   otro ticket al lado, así que el OCR metió lo de los márgenes DENTRO de los
   renglones: la tecla `Intro` al final de «PRODUCTOS VARIOS», un `8 Y` delante
   de «GARANTÍA Y SEGURO», un `( ))` delante de «Promoción» y un `4` suelto
   delante del pie.

   Con las anclas pegadas al principio del renglón, cada una de esas motas
   tiraba un dato entero y CALLANDO:

     · el `4` del pie      → sin número de ticket, y sin él no se registra;
     · el `8 Y`            → la garantía dejaba de ser garantía, y la pantalla
                             decía «no hay Garantía» con la garantía impresa;
     · el `( ))`           → la promoción de −$1,000 no se descontaba, y la
                             suma de líneas no cerraba contra el Total;
     · el `Intro`          → la mica se quedaba llamándose «PRODUCTOS VARIOS».

   Es el mismo error que `verificar.py` ya tuvo con los apellidos (MAPA,
   15-sep-2026): comparar contra CÓMO está escrito en vez de contra lo que
   dice. Un asesor no va a fotografiar el ticket sobre un fondo limpio, y
   pedírselo es pedirle que haga de escáner.

   Lo que NO se relaja es la forma del dato: el pie sigue exigiendo tienda,
   caja, fecha, hora y dos campos; el renglón de cifras sigue exigiendo SKU,
   cantidad, precio e importe en ese orden. Lo que se admite es basura ANTES,
   separada por un espacio — nunca en medio.

   ── Y DESPUÉS, que es la mitad que se me pasó (19-sep, 5:39 PM) ──
   La segunda foto del mismo 34273 volvió a quedarse sin número de ticket y sin
   fecha. El pie terminaba en `\s*$`: relajé la cabeza del renglón y dejé la
   cola clavada al final. Contado sobre el volcado real, el margen DERECHO
   ensucia 18 renglones y el izquierdo 9 — o sea que atendí el lado limpio.
   Cualquier mota bastaba: ` I`, ` z`, ` |`, ` MN`, ` Ctrl`, ` ————`.

   El último campo pasó de `(\d{3,10})` a `(\w{3,10})` por la misma razón: el
   número de cajero se lee tan mal como el resto (`900001` → `9O000l`) y al no
   casar se llevaba por delante al TICKET, que es el que sí importa.

   Lo que se conserva a propósito: el ticket sigue siendo el PENÚLTIMO campo,
   no «el último número que aparezca». Por eso el cajero es opcional en su
   FORMA pero no en su PRESENCIA: si el pie sólo trae un número no se sabe cuál
   de los dos sobrevivió, y guardar el número de empleado del cajero como folio
   es peor que no leerlo — es constante entre tickets, así que el siguiente se
   rechazaría por duplicado. Sin folio la pantalla avisa; con el folio
   equivocado, no. */

/* ── Qué es una garantía ─────────────────────────────────────
   Se lee del ticket, no se deduce. Tiene línea propia, SKU propio y precio
   propio, y va SIEMPRE justo debajo del artículo que protege:

     HUAWEI WATCH FIT 4 1.82" AL NG
     100259554  1  3498.000  $3,498.00
     #: WA1217002000742
     GARANTIA Y SEGURO 2 ANOS MAS      ← ésta
     100272290  1  1249.000  $1,249.00

   Se reconoce por el TEXTO y no por una lista de SKUs: hay uno distinto por
   plazo y por rango de precio (cinco SKUs sólo en este ticket), y la lista se
   quedaría corta el día que Assurant meta un plazo nuevo — callando, y
   convirtiendo oros en platas. */
function esGarantia(desc) {
  // Sin `^`: el OCR le pega lo del margen delante («8 Y GARANTIA Y SEGURO
  // 1 ANO MAS» en el ticket 34273). Ver la nota de RE_PIE.
  return /\bGARANTIA Y SEGURO\b/.test(norm(desc));
}

/* ── Cómo se llama la línea en pantalla ──────────────────────
   Los accesorios del genérico se imprimen todos como «PRODUCTOS VARIOS», que
   no le dice nada a nadie: en el ticket 34140 así sale la mica de $149. Lo que
   sí lo dice es el código que el cajero teclea en el campo de serie
   (`MICAHIDROGEL`).

   Importa porque esta pantalla existe para VALIDAR. Siete micas y un cargador
   listados como «PRODUCTOS VARIOS» convierten la validación en un trámite:
   nadie puede comprobar lo que no puede leer. */
function nombreDe(linea) {
  var d = norm(linea && linea.desc);
  var s = String((linea && linea.serie) || '').trim();
  // Una serie de verdad son 15+ caracteres de máquina; un código de artículo es
  // corto y legible. Sólo el segundo sirve como nombre.
  if (/\bPRODUCTOS VARIOS\b/.test(d) && s && s.length <= 20 && /[A-Z]/i.test(s)) {
    return s.toUpperCase();
  }
  return d;
}

/* ------------------------------------------------------------
   LEER EL TICKET
   ------------------------------------------------------------ */
function leerTicket(texto) {
  var lineas = String(texto == null ? '' : texto).split(/\r?\n/);
  var res = {
    ticket: '', fecha: '', hora: '', caja: '', tienda: '',
    vendedor: '', total: null, recuento: null,
    lineas: [], avisos: []
  };

  var desc = '';        // la última línea útil: candidata a descripción
  var ultima = null;    // el último artículo leído, para colgarle su garantía
  var dudosas = [];     // líneas donde precio × cantidad no da el importe

  for (var i = 0; i < lineas.length; i++) {
    var cruda = lineas[i];
    var n = norm(cruda);
    if (!n) continue;

    var mPie = cruda.match(RE_PIE);
    if (mPie) {
      res.tienda = mPie[1]; res.caja = mPie[2];
      res.fecha  = mPie[3]; res.hora = mPie[4].replace(/\s+/g, ' ').toUpperCase();
      res.ticket = mPie[5];
      continue;
    }

    /* El nombre llega hasta el final del renglón, así que se lleva lo que el
       margen haya dejado ahí: la pantalla del 19-sep decía «APELLIDO, NOMBRE
       EA». Se recortan los pedazos sueltos del final —uno o dos caracteres, que
       nunca son parte de un nombre— pero NO se toca lo demás: el segundo
       apellido y las iniciales tienen que llegar enteros al servidor, que es
       quien decide de quién es el ticket. */
    var mVend = n.match(/(?:^|\s)ATENDIDO POR\s*:?\s*(.+)$/);
    if (mVend) {
      res.vendedor = mVend[1].replace(/\s*,\s*/, ', ')
        .replace(/[^A-ZÁÉÍÓÚÑ]+$/i, '')   // los símbolos que deja el margen
        .replace(/\s+\S{1,2}$/, '')       // y un pedazo suelto de una o dos letras
        .trim();
      continue;
    }

    var mRec = n.match(/^RECUENTO DE ARTICULOS VENDIDOS\s*=\s*(\d+)/);
    if (mRec) { res.recuento = parseInt(mRec[1], 10); continue; }

    var mTot = n.match(/(?:^|\s)TOTAL\s+\$?([\d.,]+)(?:\s|$)/);
    if (mTot && res.total == null) { res.total = aNumero(mTot[1]); continue; }

    var mCif = cruda.match(RE_CIFRAS);
    var cantLeida = true;
    if (!mCif) {
      // La cantidad no se leyó. Ver RE_CIFRAS_SIN_CANT: se deduce, no se supone.
      var mSin = cruda.match(RE_CIFRAS_SIN_CANT);
      if (mSin) { mCif = [mSin[0], mSin[1], '', mSin[2], mSin[3]]; cantLeida = false; }
    }
    if (mCif) {
      var precio  = aNumero(mCif[3]);
      var importe = aNumero(mCif[4]);
      var cant    = cantLeida ? parseInt(mCif[2], 10)
                              : cantidadDeducida(precio, importe);
      var art = {
        sku:       mCif[1].replace(/^0+(?=\d)/, ''),   // 000043739 → 43739
        sku_pos:   mCif[1],                            // tal como lo imprimió
        desc:      desc,
        cantidad:  (cant == null ? 1 : cant),
        precio:    precio,
        importe:   importe,
        serie:     '',
        descuento: 0,
        es_garantia: esGarantia(desc)
      };
      if (!cantLeida) {
        art.cantidad_deducida = true;
        if (cant == null) {
          res.avisos.push('Línea «' + (desc || art.sku) + '»: no se leyó la ' +
            'cantidad y el importe entre el precio no da un número entero. Se ' +
            'tomó 1: compruébala contra el papel.');
        }
      }
      if (pareceGenerico(art)) {
        art.sku_ocr = art.sku;
        art.sku = SKU_GENERICO;
        art.sku_pos = SKU_GENERICO;
        res.avisos.push('Línea «' + (desc || 'PRODUCTOS VARIOS') + '»: el SKU se ' +
          'leyó ' + art.sku_ocr + ' y el genérico es ' + SKU_GENERICO + ' — un ' +
          'dígito. Se tomó ' + SKU_GENERICO + ', que es el único que el POS ' +
          'imprime como PRODUCTOS VARIOS.');
      }
      art.nombre = nombreDe(art);

      /* La red que la verificación por subtotales nunca pudo dar: dice EN QUÉ
         LÍNEA falla, no que «algo no cuadra». Un peso de tolerancia por el
         redondeo del OCR. */
      // Un importe que no se leyó es tan dudoso como uno que no cuadra, y se
      // arregla igual: desde el precio, si el Total lo confirma.
      if (art.precio != null &&
          (art.importe == null ||
           Math.abs(art.precio * art.cantidad - art.importe) > 1)) {
        // El aviso no se da aquí: primero hay que ver si el Total lo resuelve.
        art.importe_dudoso = true;
        dudosas.push({ linea: art, etiqueta: desc || art.sku });
      }

      if (art.es_garantia && ultima) art.protege_a = ultima.sku;
      res.lineas.push(art);
      if (!art.es_garantia) ultima = art;
      desc = '';
      continue;
    }

    /* El descuento y la promoción son del artículo de ARRIBA, no del de abajo.
       Van después del renglón de cifras, así que el importe leído es el de
       lista: el MatePad de $29,990 se cobró en $14,995. */
    // Y el menos puede venir separado de la cifra («- 1,000.00»): `aNumero`
    // ya quita los espacios, pero la expresión tenía que dejarlo pasar.
    /* El `.*` es GOLOSO a propósito, y antes era perezoso. La promoción trae
       números que no son el descuento —«Promoción 117935 - 2146243 - 1,000.00»—
       y el que vale es el ÚLTIMO. Mientras la expresión terminaba en `$` daba
       igual; al admitir basura detrás, con `.*?` se habría quedado con el
       `- 2146243` y el ticket habría salido con un descuento de dos millones. */
    var mDesc = n.match(/(?:^|\s)(?:DESCUENTO\s*\$?|PROMOCION\b.*)\s+(-\s*[\d.,]+)(?:\s|$)/);
    if (mDesc && res.lineas.length) {
      res.lineas[res.lineas.length - 1].descuento += Math.abs(aNumero(mDesc[1]) || 0);
      continue;
    }

    var mSerie = n.match(/^IMEI\s*\/\s*SERIE\s*\/\s*SERVICIO\s*:\s*(.+)$/);
    if (mSerie && res.lineas.length) {
      var ln = res.lineas[res.lineas.length - 1];
      /* Mismo margen, mismo destrozo: la pantalla del 19-sep llamó a la mica
         «MICATRANSP =». Y el nombre de la línea SALE de aquí cuando el POS
         imprime «PRODUCTOS VARIOS», así que un símbolo pegado no es cosmética:
         es el nombre con el que hay que validar el ticket. */
      ln.serie = mSerie[1].replace(/[^A-Z0-9]+$/i, '').trim();
      ln.nombre = nombreDe(ln);
      continue;
    }

    if (!esRuido(cruda)) desc = n;
  }

  /* ── Un importe mal leído, cuando el propio ticket dice cuál era ──
     19-sep-2026, segunda foto del 34273: la garantía impresa en $1,679.00 se
     leyó `1673`, y la pantalla soltaba DOS avisos sobre el mismo dígito — la
     línea no cuadra, y la suma no cierra por $6. Ninguno de los dos se puede
     atender: el asesor no tiene otra cosa que hacer que repetir la foto y
     rezar, porque el `9` seguirá pareciéndose a un `3`.

     Pero el número no está perdido: el ticket lo dice DOS VECES más. El precio
     unitario está impreso aparte del importe (`1 1679.000 $1,673.00`), y el
     Total del POS cierra al centavo con el precio y no con el importe. Dos
     testigos independientes que coinciden entre sí y desmienten al tercero.

     Por eso la reparación no es «confiar en el precio»: es confiar en que la
     SUMA CIERRE. Se repara sólo si, cambiando el importe por precio × cantidad,
     el ticket cuadra exacto contra el Total Y antes no cuadraba. Si repararlo
     no hace cerrar la cuenta, no se toca nada y el aviso queda como estaba:
     entonces lo que falta puede ser una línea entera, que es otro problema.

     Y aunque cuadre, se DICE. El dinero no se corrige en silencio: queda el
     importe original en `importe_ocr` y un aviso que nombra la línea. */
  if (dudosas.length) {
    var sumarCon = function (usarPrecio) {
      var s = 0;
      for (var q = 0; q < res.lineas.length; q++) {
        var l = res.lineas[q];
        s += ((usarPrecio && l.importe_dudoso) ? l.precio * l.cantidad
                                               : (l.importe || 0))
             - (l.descuento || 0);
      }
      return s;
    };
    var reparar = res.total != null &&
                  Math.abs(sumarCon(false) - res.total) > 0.5 &&
                  Math.abs(sumarCon(true)  - res.total) < 0.5;

    for (var d = 0; d < dudosas.length; d++) {
      var ld = dudosas[d].linea;
      var etq = dudosas[d].etiqueta;
      var esperado = ld.precio * ld.cantidad;
      if (reparar) {
        ld.importe_ocr = ld.importe;
        ld.importe = esperado;
        ld.importe_corregido = true;
        res.avisos.push('Línea «' + etq + '»: el importe ' +
          (ld.importe_ocr == null ? 'no se pudo leer'
                                  : 'se leyó $' + ld.importe_ocr.toFixed(2)) +
          ', pero con el precio ($' + ld.precio + ' × ' + ld.cantidad + ') el ' +
          'ticket cuadra exacto contra el Total. Se tomó $' +
          esperado.toFixed(2) + '.');
      } else if (ld.importe == null) {
        res.avisos.push('Línea «' + etq + '»: no se pudo leer el importe. Por ' +
          'el precio debería ser $' + esperado.toFixed(2) + ', pero así el ' +
          'ticket no cuadra contra el Total, así que puede faltar otra línea. ' +
          'Revísala.');
      } else {
        res.avisos.push('Línea «' + etq + '»: ' + ld.cantidad + ' × ' +
          ld.precio + ' debería dar ' + esperado + ' y el ticket dice ' +
          ld.importe + '. Revísala.');
      }
    }
  }

  /* ── Lo que decide si el ticket se puede registrar ── */
  if (!res.ticket) {
    res.avisos.push('No se leyó el número de ticket. Sin él no se puede ' +
      'registrar: es lo único que impide contar la misma venta dos veces.');
  }
  if (!res.vendedor) {
    res.avisos.push('No se leyó «Atendido por». Hay que elegir al asesor a mano.');
  }

  /* ── LA RED: la suma de las líneas tiene que dar el Total ──
     Ésta es la comprobación que de verdad protege el concurso, y hay que
     entender POR QUÉ antes de tocarla.

     Una línea que el OCR se saltó no rompe nada visible: el ticket baja de ORO
     a PLATA con toda naturalidad, el asesor lo ve normal, el marcador suma uno
     de menos y nadie puede atarlo a nada. Es el fallo silencioso perfecto.

     Medido sobre el ticket 34140 (7 artículos, 5 garantías, 3 descuentos):
     las doce líneas menos sus descuentos dan 26,302.00 al peso. O sea que la
     suma cierra sólo si se leyeron TODAS las líneas y TODOS sus importes.

     Caza más que el recuento y hace falta más: este ticket NO trae «Recuento de
     artículos vendidos». Los de un artículo sí. Así que el recuento sirve
     cuando está, pero no se puede depender de él. */
  if (res.total != null && res.lineas.length) {
    var suma = 0;
    for (var k = 0; k < res.lineas.length; k++) {
      suma += (res.lineas[k].importe || 0) - (res.lineas[k].descuento || 0);
    }
    /* Cincuenta centavos, y el margen es estrecho a propósito.

       Esta cuenta la hace el POS y cierra al centavo: en el ticket 34140 las
       doce líneas menos sus tres descuentos dan 26,302.00 exacto. No hay
       redondeo que perdonar aquí — el redondeo está en `precio × cantidad`,
       que es otra comprobación y tiene su propio margen.

       Un margen ancho aquí sería peor que no tener la comprobación: dejaría
       pasar justo los errores pequeños de OCR, que son los más frecuentes (un
       `149` leído `148`), y daría la sensación de estar cubierto. */
    if (Math.abs(suma - res.total) > 0.5) {
      res.avisos.push('Las líneas suman $' + suma.toFixed(2) + ' y el ticket ' +
        'dice $' + res.total.toFixed(2) + '. Falta alguna línea o algún importe ' +
        'se leyó mal: revisa la foto antes de guardar.');
    }
  } else if (res.total == null) {
    res.avisos.push('No se leyó el Total. Sin él no hay forma de comprobar que ' +
      'se leyeron todas las líneas: revisa el ticket completo.');
  }

  /* El recuento no siempre viene, pero cuando viene es gratis comprobarlo.
     Las garantías NO entran en el recuento del POS. */
  if (res.recuento != null) {
    var arts = res.lineas.filter(function (l) { return !l.es_garantia; }).length;
    if (arts !== res.recuento) {
      res.avisos.push('El ticket dice ' + res.recuento + ' artículos y se ' +
        'leyeron ' + arts + '. Falta alguna línea: revisa la foto antes de guardar.');
    }
  }

  return res;
}

/* ── La fecha del ticket, a ISO ──────────────────────────────
   El POS imprime `14/09/26`: DÍA primero. Leerlo como mes/día es el fallo
   perfecto para este concurso — `09/10/26` sería el 9 de octubre en vez del 10
   de septiembre, el ticket caería fuera de fechas, y el asesor vería
   «ese ticket es del 09/10/2026, fuera del concurso» mirando un papel que dice
   septiembre. Ningún error, sólo un rechazo imposible de discutir.

   Los años de dos cifras se completan a 20xx: el POS no imprime el siglo y el
   concurso es de este.

   Devuelve null si no se puede interpretar, y quien llama manda NULL para que
   el servidor ponga la de hoy. Es preferible a rechazar el ticket por una
   fecha que el OCR leyó torcida. */
function fechaISO(txt) {
  var m = String(txt == null ? '' : txt).match(/^\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*$/);
  if (!m) return null;
  var a = parseInt(m[3], 10);
  if (a < 100) a += 2000;
  var mes = parseInt(m[2], 10), dia = parseInt(m[1], 10);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  /* Un 31 de febrero se cuela por la comprobación de arriba. Se caza con la
     fecha de verdad: `new Date(2026,1,31)` se desborda a marzo, y si el día
     que sale no es el que entró, la fecha no existía. */
  var d = new Date(a, mes - 1, dia);
  if (d.getFullYear() !== a || d.getMonth() !== mes - 1 || d.getDate() !== dia) {
    return null;
  }
  return a + '-' + ('0' + mes).slice(-2) + '-' + ('0' + dia).slice(-2);
}

raiz.concursoFechaISO   = fechaISO;
raiz.concursoLeerTicket = leerTicket;
raiz.concursoNorm       = norm;
raiz.concursoNumero     = aNumero;
raiz.concursoEsGarantia = esGarantia;
raiz.concursoNombreDe   = nombreDe;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { leerTicket: leerTicket, fechaISO: fechaISO, norm: norm, aNumero: aNumero,
                     esGarantia: esGarantia, nombreDe: nombreDe };
}

})(typeof window !== 'undefined' ? window : globalThis);
