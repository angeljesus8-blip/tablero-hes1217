/* ============================================================
   MODO NUEVO — ventas_detalle
   Pegar en el Apps Script "tablero 1217". 2-ago-2026.
   ============================================================

   Para qué
   --------
   Laura sube a otra plataforma el número de serie, la descripción y el precio
   al que se cobró cada equipo. Hoy tiene que abrir Google Sheets, buscar el
   día, seleccionar las celdas y copiar — desde el celular es un suplicio.

   `ventas_hoy` no sirve: devuelve conteos por vendedor para el leaderboard,
   no las series. De ahí este modo.

   Devuelve:
     { fecha: "2/8/2026", ventas: [ {serie, sku, desc, precio, vend, seguro} ] }

   Sin parámetro `fecha` devuelve las de hoy. Con `?fecha=1/8/2026` las de ese
   día (mismo formato que guarda la hoja: d/M/yyyy, sin ceros a la izquierda).

   ------------------------------------------------------------
   PASO 1 — pegar esta función al final del archivo
   ------------------------------------------------------------ */

function leerVentasDetalle_(fecha) {
  var sh = sheet_();
  if (!sh || sh.getLastRow() < 2) return { fecha: fecha || '', ventas: [] };
  var v = sh.getDataRange().getValues();
  // fmtFecha_ ya normaliza texto y Date: la hoja guarda la fecha como texto
  // "2/8/2026" sin ceros a la izquierda, así que comparar contra dd/MM/yyyy
  // nunca coincidiría (ver GAS_MODOS.md).
  var objetivo = fecha ? String(fecha).trim() : fmtFecha_(new Date());
  var out = [];
  for (var r = 1; r < v.length; r++) {
    if (fmtFecha_(v[r][0]) !== objetivo) continue;
    var serie = String(v[r][2] || '').trim();
    if (!serie) continue;                       // filas sin serie no sirven
    out.push({
      serie:  serie,
      sku:    String(v[r][3] || '').trim(),
      desc:   String(v[r][4] || '').trim(),
      precio: String(v[r][5] || '').trim(),
      vend:   String(v[r][6] || '').trim(),
      seguro: String(v[r][9] || '').trim()
    });
  }
  return { fecha: objetivo, ventas: out };
}

/* ------------------------------------------------------------
   PASO 2 — en doGet, junto a los otros `else if` de modo, agregar:

     } else if (modo === 'ventas_detalle') {
       payload = leerVentasDetalle_(e.parameter.fecha || '');

   Va ANTES del `else` final (el que ahora responde rechazar_). Da igual en qué
   posición entre los demás; lo importante es que quede dentro de la cadena.

   PASO 3 — Guardar e Implementar → Administrar implementaciones → ✏️ →
   Versión: Nueva. Editando la que ya existe, nunca creando una nueva: cambiar
   la URL /exec tumbaría las tres apps.
   ------------------------------------------------------------

   Cómo comprobarlo sin tocar datos: en el editor, con la hoja abierta,

     function probarVentasDetalle() {
       var r = leerVentasDetalle_('');            // hoy
       Logger.log('%s ventas hoy', r.ventas.length);
       if (r.ventas.length) Logger.log(r.ventas[0]);
     }

   Mientras no esté desplegado, el botón de Captura de Series avisa
   "actualiza el Apps Script" en vez de fallar callando.
   ------------------------------------------------------------ */
