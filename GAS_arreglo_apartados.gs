/* ============================================================
   ARREGLO URGENTE — no se puede guardar en Preventa
   1-ago-2026. Reemplazar la función checkPin_ del Apps Script.
   ============================================================

   Qué pasó
   --------
   El tablero manda el número de tienda como PIN:

       modo=apartado_add&pin=1217        (tablero.html, línea 1007)
       modo=eol_add&sku=…&pin=1217       (tablero.html, línea 1246)

   Mientras ADMIN_PIN valía '1217' en el código, eso coincidía y pasaba. Al
   sacar el PIN a Propiedades del script con un valor nuevo, dejó de coincidir
   y toda escritura por doGet empezó a devolver {ok:false, error:'PIN
   incorrecto'} — sin mensaje visible en la app.

   El asesor no tiene el PIN de admin, ni debe tenerlo. Lo que sí manda en cada
   llamada es el token (gasJsonp agrega &t=), y ese token solo lo recibe quien
   pasó por el login. Así que el token es la autenticación correcta aquí.

   Ojo: esto es MÁS estricto que antes, no menos. Antes bastaba con enviar
   pin=1217, y el número de tienda está en el nombre del repo, en el título de
   la app y en el QR.

   De paso arregla bundle_add, bundle_del, notificar, aviso_add y aviso_del,
   que llamaban con la variable PIN_OK —inexistente— y llevaban tiempo
   reventando con ReferenceError.

   ------------------------------------------------------------
   BUSCA esta función (está cerca de la línea 436):

       function checkPin_(e) {
         var esperado = adminPin_();
         return !!esperado && e && e.parameter && String(e.parameter.pin||'') === esperado;
       }

   Y REEMPLÁZALA COMPLETA por la de abajo.
   Luego: Guardar (Ctrl+S) e Implementar → Administrar implementaciones → ✏️ →
   Versión: Nueva. Editando la que ya existe, nunca creando una nueva.
   ============================================================ */

function checkPin_(e) {
  // El token ya autentica la llamada (ver accesoPermitido_), y es lo único que
  // el tablero puede mandar: el asesor no tiene —ni debe tener— el PIN de admin.
  var tok = PropertiesService.getScriptProperties().getProperty('GAS_TOKEN') || '';
  var recibido = (e && e.parameter && e.parameter.t) || '';
  if (tok && recibido === tok) return true;

  // Se conserva el PIN para llamadas hechas fuera del tablero.
  var esperado = adminPin_();
  return !!esperado && e && e.parameter && String(e.parameter.pin || '') === esperado;
}

/* ------------------------------------------------------------
   Cómo comprobar que quedó, sin tocar datos reales: en el tablero, aparta una
   pieza de prueba y bórrala. Si guarda, quedó.

   Si prefieres verificarlo desde el editor, corre esto — no escribe nada:

     function probarCheckPin() {
       var tok = PropertiesService.getScriptProperties().getProperty('GAS_TOKEN');
       Logger.log('con token bueno -> %s', checkPin_({parameter:{t:tok}}));   // true
       Logger.log('con pin 1217    -> %s', checkPin_({parameter:{pin:'1217'}})); // false
       Logger.log('sin nada        -> %s', checkPin_({parameter:{}}));        // false
     }
   ------------------------------------------------------------ */
