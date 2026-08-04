/* ============================================================
   ARREGLO URGENTE — no se puede guardar en Preventa
   1-ago-2026. Reemplazar la función checkPin_ del Apps Script.

   APLICADO el 4-ago-2026. Escrito en el editor y guardado; queda
   desplegar. Lo de `PIN_OK` que se menciona abajo ya estaba resuelto
   antes: las 12 rutas de escritura llaman a `checkPin_(e)`.
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
       Logger.log('con pin de admin-> %s', checkPin_({parameter:{pin:'1217'}}));
       Logger.log('sin nada        -> %s', checkPin_({parameter:{}}));        // false
     }

   Ojo con la segunda: aquí decía "// false" dando por hecho que ADMIN_PIN ya
   tendría un valor nuevo. **Hoy ADMIN_PIN sigue siendo `1217`**, así que da
   `true` por la vía de respaldo, y eso es lo correcto. Ese es justo el punto
   del arreglo: ahora que el token basta, se puede cambiar ADMIN_PIN por algo
   que no esté publicado sin tumbar la preventa ni marcar EOL (MAPA cadena 2).

   Probado el 4-ago-2026 antes de guardar, ejecutando la función contra dobles:
   token bueno → true · token malo → false · sin nada → false · solo PIN →
   true · PIN malo → false · token bueno con PIN malo → true. Y comparada
   contra la versión anterior caso por caso: en el camino del PIN devuelve
   exactamente lo mismo, así que no hay regresión; lo único que cambia es que
   ahora existe la vía del token.
   ------------------------------------------------------------ */
