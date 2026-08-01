/* ============================================================
   PARCHE DE FECHAS — pegar en el Apps Script "tablero 1217"
   1-ago-2026. Son dos cambios pequeños y una función nueva.
   ============================================================

   Por qué
   -------
   Buscando por qué seguían apareciendo promos terminadas el 31-jul salieron
   tres problemas. El primero ya quedó arreglado del lado del tablero (la regla
   "sin fecha = siempre vigente"); estos dos son del servidor y son preventivos:
   hoy no rompen nada, pero van a romper en cuanto alguien capture una fecha
   distinto de como se captura ahora.

   1. leerPromos_ devuelve la celda tal cual: d2:String(v[r][7]||'')
      Si la vigencia se captura como FECHA de Sheets (no texto), String(fecha)
      da "Fri Jul 31 2026 00:00:00 GMT-0600..." y el tablero compara
      "2026-08-01" <= "Fri Jul 31..." letra por letra: "2" < "F" es cierto, así
      que la promo queda vigente PARA SIEMPRE. Hoy las columnas Desde/Hasta son
      texto y por eso no ha pasado, pero basta que alguien escriba la fecha con
      el selector para que empiece.

      leerBundles_ ya hacía bien esta conversión; leerPromos_ nunca la tuvo.

   2. leerBundles_ compara contra UTC:
        const hoy = new Date().toISOString().slice(0,10);
      México es UTC-6, así que a partir de las 6 pm el UTC ya es "mañana" y los
      combos de su último día se caen seis horas antes. Es exactamente lo que la
      regla de fechas del repo dice que no se haga (ver GAS_MODOS.md y el
      comentario de hoyISO() en tablero.html).


   CAMBIO 1 — en leerPromos_, cambiar esta línea:

       est:String(v[r][4]||''), msi:String(v[r][5]||''), d1:String(v[r][6]||''), d2:String(v[r][7]||'') };

   por:

       est:String(v[r][4]||''), msi:String(v[r][5]||''), d1:isoFecha_(v[r][6]), d2:isoFecha_(v[r][7]) };


   CAMBIO 2 — en leerBundles_, cambiar:

       const hoy = new Date().toISOString().slice(0,10);

   por:

       const hoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');


   CAMBIO 3 — pegar esta función al final del archivo:
   ============================================================ */

/** Normaliza una celda de fecha a yyyy-MM-dd, venga como Date, dd/MM/yyyy o ya en ISO. */
function isoFecha_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  var s = String(v || '').trim();
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);   // dd/MM/yyyy
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return s.slice(0, 10);                                 // ya viene ISO, o vacío
}

/* Al terminar: Implementar → Administrar implementaciones → ✏️ → Versión: Nueva.
   Editando la que ya existe, nunca creando una nueva. */
