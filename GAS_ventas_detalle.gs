/* ============================================================
   MODO ventas_detalle — YA ESCRITO EN EL APPS SCRIPT
   Proyecto "tablero 1217" · 2-ago-2026
   ============================================================

   Estado
   ------
   El código de abajo YA está en el editor de Apps Script: se insertó
   directamente en el proyecto, no se pegó a mano. Quedó así:

     · la rama  `else if (modo === 'ventas_detalle')`  en la línea 799,
       dentro de doGet (que abre en la 726 y cierra en la 809)
     · la función leerVentasDetalle_() al final del archivo
     · el archivo pasó de 892 a 923 líneas

   Se verificó en el propio editor: la rama cayó en doGet y no en doPost
   —el error del 28-jul, cuando `comisiones` terminó en la función
   equivocada por insertar buscando texto—, las llaves quedaron
   balanceadas y Monaco no marcó ningún error.

   FALTA: guardar (Ctrl+S) y volver a desplegar.
   Implementar → Administrar implementaciones → ✏️ → Versión: Nueva.
   Editando la que ya existe, NUNCA creando una nueva: cambiar la URL
   /exec tumbaría el tablero, Captura de Series y Admin de un golpe.

   Mientras no se despliegue, el panel "Ventas del día" de Captura de
   Series avisa "actualiza el Apps Script" en vez de quedarse mudo.

   Para qué
   --------
   Laura sube a otra plataforma el número de serie de cada equipo, uno
   por uno, y necesita ver descripción y precio para cotejar. `ventas_hoy`
   no sirve: devuelve conteos por vendedor para el leaderboard, no las
   series.

   Devuelve:
     { fecha: "2/8/2026", ventas: [ {serie, sku, desc, precio, vend, seguro} ] }

   Sin parámetro `fecha` devuelve las de hoy. Con `?fecha=1/8/2026`, las de
   ese día — mismo formato que guarda la hoja: d/M/yyyy, sin ceros a la
   izquierda.

   ------------------------------------------------------------
   Lo que quedó escrito, textual:
   ------------------------------------------------------------ */

// dentro de doGet, justo antes del `} else {` final:
//
//   } else if (modo === 'ventas_detalle') {
//     payload = leerVentasDetalle_(e.parameter.fecha || '');

/* ===================== VENTAS DEL DIA — DETALLE ===================== */
// 2-ago-2026. Laura sube a otra plataforma la serie de cada equipo, una por una.
// leerVentasHoy_ no sirve: devuelve conteos por vendedor para el leaderboard,
// no las series. De ahi este modo, que usa Captura de Series.
function leerVentasDetalle_(fecha) {
  var sh = sheet_();
  if (!sh || sh.getLastRow() < 2) return { fecha: fecha || '', ventas: [] };
  var v = sh.getDataRange().getValues();
  // fmtFecha_ normaliza texto y Date: la hoja guarda "2/8/2026" sin ceros a la
  // izquierda, asi que comparar contra dd/MM/yyyy nunca coincidiria.
  var objetivo = fecha ? String(fecha).trim() : fmtFecha_(new Date());
  var out = [];
  for (var r = 1; r < v.length; r++) {
    if (fmtFecha_(v[r][0]) !== objetivo) continue;
    var serie = String(v[r][2] || '').trim();
    if (!serie) continue;                       // filas sin serie no le sirven
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
   Comprobarlo sin tocar datos: en el editor, con la hoja abierta,

     function probarVentasDetalle() {
       var r = leerVentasDetalle_('');            // hoy
       Logger.log('%s ventas hoy', r.ventas.length);
       if (r.ventas.length) Logger.log(r.ventas[0]);
     }

   ------------------------------------------------------------ */
