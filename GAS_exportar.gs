/* ============================================================
   MODO exportar — YA ESCRITO Y GUARDADO EN EL APPS SCRIPT
   Proyecto "tablero 1217" · 2-ago-2026
   ============================================================

   Estado
   ------
   Escrito directamente en el editor, no pegado a mano. Quedó así:

     · la rama `else if (modo === 'exportar')` en la línea 801, dentro de
       doGet (que abre en la 726)
     · exportarHoja_() e isoVenta_() al final del archivo
     · el archivo pasó de 923 a 984 líneas
     · GUARDADO (confirmado en el editor)

   Verificado en el propio editor: la rama cayó en doGet y no en doPost, el
   `else` final quedó intacto detrás de ella, las llaves balanceadas y Monaco
   sin marcar un solo error.

   FALTA: volver a desplegar.
   Implementar → Administrar implementaciones → ✏️ → Versión: Nueva.
   Editando la que ya existe, NUNCA creando una nueva: cambiar la URL /exec
   tumbaría el tablero, Captura de Series y Admin de un golpe.

   Para qué
   --------
   Volcar las hojas a Supabase (fase 1 de la migración). No hay ningún modo
   que devuelva las ventas completas: `ventas_detalle` da un día por llamada, y
   serían ~60 llamadas seguidas contra un script que descarta las encimadas.

   Se consume desde Postgres, que llama al Apps Script por su cuenta con la
   extensión `http` (ver supabase_carga.sql):

     ?modo=exportar&hoja=Ventas
     ?modo=exportar&hoja=Apartados
     ?modo=exportar&hoja=Comisiones

   Devuelve { hoja, filas: [ {Columna: valor, ...} ] } usando la primera fila
   como nombres de columna, así que agregar una columna a la hoja no obliga a
   tocar este código.

   ES TEMPORAL
   -----------
   Entrega TODO el histórico, incluidos los números de serie. Aunque el guardián
   ya exige token, hay lista blanca de hojas a propósito. **Quitar este modo
   cuando termine la migración** — está en la fase 5 del plan.

   ------------------------------------------------------------
   Lo que quedó escrito, textual:
   ------------------------------------------------------------ */

// dentro de doGet, justo antes del `} else {` final:
//
//   } else if (modo === 'exportar') {
//     payload = exportarHoja_(e.parameter.hoja || '');

/* ===================== EXPORTACION PARA MIGRAR ===================== */
// 2-ago-2026. TEMPORAL: existe solo para volcar las hojas a Supabase y se
// quita cuando termine la migracion.
//
// Devuelve filas como objetos usando la primera fila como nombres de columna,
// asi que si se agrega una columna a la hoja no hay que tocar esto.
//
// Lista blanca a proposito: este modo entrega TODO el historico, incluidos
// numeros de serie. Aunque el guardian ya exige token, no se deja abierto a
// cualquier hoja.
function exportarHoja_(nombre) {
  var PERMITIDAS = ['Ventas', 'Apartados', 'Comisiones'];
  if (PERMITIDAS.indexOf(nombre) < 0) {
    return { error: 'hoja no permitida', permitidas: PERMITIDAS };
  }
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombre);
  if (!sh || sh.getLastRow() < 2) return { hoja: nombre, filas: [] };

  var v   = sh.getDataRange().getValues();
  var cab = v[0].map(function (c) { return String(c || '').trim(); });
  var out = [];
  for (var r = 1; r < v.length; r++) {
    var o = {}, vacia = true;
    for (var c = 0; c < cab.length; c++) {
      if (!cab[c]) continue;
      var val = v[r][c];
      // Sheets convierte a Date lo que le parece fecha; fmtFecha_ lo devuelve
      // al texto d/M/yyyy que es como lo guarda la app.
      o[cab[c]] = (val instanceof Date) ? fmtFecha_(val)
                : String(val === null || val === undefined ? '' : val);
      if (o[cab[c]] !== '') vacia = false;
    }
    if (vacia) continue;                      // filas en blanco al final
    // Fecha y hora van en columnas distintas y como texto. Se juntan aqui, del
    // lado que SI sabe la zona horaria: si esto se armara en la base, una venta
    // de las 8 pm se guardaria con la fecha del dia siguiente.
    if (nombre === 'Ventas') o._iso = isoVenta_(o['Fecha'], o['Hora']);
    out.push(o);
  }
  return { hoja: nombre, filas: out };
}

// '2/8/2026' + '03:16 p.m.'  ->  '2026-08-02T15:16:00-06:00'
// Sin hora reconocible cae a mediodia, que no se pasa de dia en ninguna zona.
function isoVenta_(fecha, hora) {
  var f = String(fecha || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!f) return '';
  var h = 12, mi = 0;
  var mh = String(hora || '').match(/(\d{1,2}):(\d{2})\s*([ap])/i);
  if (mh) {
    h  = parseInt(mh[1], 10) % 12;
    if (/p/i.test(mh[3])) h += 12;
    mi = parseInt(mh[2], 10);
  }
  var d = new Date(Number(f[3]), Number(f[2]) - 1, Number(f[1]), h, mi);
  return Utilities.formatDate(d, 'America/Mexico_City', "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/* ------------------------------------------------------------
   Comprobarlo sin tocar datos, desde el editor:

     function probarExportar() {
       var r = exportarHoja_('Ventas');
       Logger.log('%s filas', r.filas.length);
       if (r.filas.length) Logger.log(r.filas[0]);
     }

   Deben salir 219 filas, y la primera con su campo _iso.
   ------------------------------------------------------------ */
