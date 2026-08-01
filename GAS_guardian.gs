/* ============================================================
   GUARDIÁN DE ACCESO — pegar en el Apps Script "tablero 1217"
   ============================================================

   El problema que resuelve
   ------------------------
   La URL /exec está escrita en tablero.html, que es público en GitHub Pages.
   O sea que de secreta no tiene nada. Comprobado el 30-jul-2026, sin ninguna
   credencial:
     ?modo=inventario     → 215 SKUs con stock, vendido y precio
     ?modo=ventas_hoy     → ventas del día por vendedor, con nombre
     ?modo=loquesea       → 200 filas de Ventas: fecha, hora, SERIE, precio, vendedor

   Ese último es el peor: el `else` final devuelve la hoja completa ante
   cualquier modo desconocido (está anotado en GAS_MODOS.md).

   Cómo lo cierra
   --------------
   Cada llamada debe traer &t=<token>. El token NO va en el HTML: lo entrega
   login_asesor (Supabase) después de validar el PIN, y el cliente lo guarda
   junto con el resto de la config de tienda.

   Despliegue en dos tiempos — IMPORTANTE
   --------------------------------------
   Si activas el modo estricto antes de actualizar las apps, tu equipo se queda
   sin tablero en piso. Por eso:

     Paso 1. Pega esto, pon GAS_ESTRICTO = "false" y despliega.
             Nada cambia para nadie, pero el registro empieza a anotar
             qué llamadas llegan sin token.
     Paso 2. Actualiza tablero.html, captura_series.html, admin.html y
             actualizar_datos.html para que manden &t=.
     Paso 3. Revisa el registro (Ver → Registros de ejecución). Cuando ya no
             aparezcan llamadas sin token, pon GAS_ESTRICTO = "true".

   Propiedades a crear
   -------------------
   Configuración del proyecto → Propiedades del script:
     GAS_TOKEN     = una cadena larga y aleatoria (32+ caracteres)
     GAS_ESTRICTO  = "false"   (luego "true")

   El mismo valor de GAS_TOKEN va en la columna gas_token de la tabla
   `tiendas` en Supabase (ver GAS_guardian.sql).

   Al terminar: Implementar → Administrar implementaciones → ✏️ → Versión: Nueva.
   Editando la que ya existe, NUNCA creando una nueva: cambiaría la URL /exec y
   las tres apps dejarían de servir.
   ============================================================ */


/** Devuelve true si la petición puede continuar. */
function accesoPermitido_(e) {
  var props = PropertiesService.getScriptProperties();
  var esperado = props.getProperty('GAS_TOKEN') || '';
  var estricto = String(props.getProperty('GAS_ESTRICTO')).toLowerCase() === 'true';
  var recibido = (e && e.parameter && e.parameter.t) || '';

  if (esperado && recibido === esperado) return true;

  // Sin token válido. En permisivo dejamos pasar pero dejamos rastro, para
  // saber qué falta actualizar antes de cerrar la puerta.
  var modo = (e && e.parameter && e.parameter.modo) || '(sin modo)';
  Logger.log('SIN TOKEN VALIDO — modo=%s estricto=%s', modo, estricto);

  if (!esperado) {
    // Falta configurar GAS_TOKEN: no cerramos, porque cerraríamos a todos.
    Logger.log('GAS_TOKEN no está configurado en Propiedades del script.');
    return true;
  }
  return !estricto;
}


/** Respuesta de rechazo, en el mismo formato JSONP que espera el cliente. */
function rechazar_(e) {
  var cb = (e && e.parameter && e.parameter.callback) || '';
  var cuerpo = JSON.stringify({ error: 'no_autorizado' });
  if (cb) {
    return ContentService
      .createTextOutput(cb + '(' + cuerpo + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(cuerpo)
    .setMimeType(ContentService.MimeType.JSON);
}


/* ------------------------------------------------------------
   DÓNDE PEGAR LAS DOS LÍNEAS

   Al principio de doGet, antes de mirar el modo:

     function doGet(e) {
       if (!accesoPermitido_(e)) return rechazar_(e);      // ← agregar
       ...resto igual...
     }

   Y lo mismo en doPost:

     function doPost(e) {
       if (!accesoPermitido_(e)) return rechazar_(e);      // ← agregar
       ...resto igual...
     }

   Ojo con lo que ya anotaste en GAS_MODOS.md: doGet y doPost tienen ambos una
   rama que compara contra 'comisiones'. Al pegar por búsqueda de texto es fácil
   caer en la función equivocada. Verifica que quedó una línea en cada una.
   ------------------------------------------------------------ */


/* ------------------------------------------------------------
   ARREGLO APARTE, INDEPENDIENTE DEL TOKEN

   El `else` final de doGet devuelve la hoja Ventas completa cuando el modo no
   se reconoce. Eso convierte un error de dedo en una fuga de 200 filas con
   números de serie. Cambia ese else por:

     } else {
       return rechazar_(e);   // modo desconocido: no devolvemos nada
     }

   Si algún cliente viejo depende de ese comportamiento, se dará cuenta rápido
   y es preferible a dejarlo abierto.
   ------------------------------------------------------------ */


/** Pruébalo desde el editor antes de desplegar. */
function probarGuardian_() {
  var props = PropertiesService.getScriptProperties();
  var tok = props.getProperty('GAS_TOKEN');
  Logger.log('GAS_TOKEN configurado: %s', tok ? 'sí (' + tok.length + ' chars)' : 'NO');
  Logger.log('GAS_ESTRICTO: %s', props.getProperty('GAS_ESTRICTO'));
  Logger.log('con token bueno  → %s', accesoPermitido_({ parameter: { t: tok } }));
  Logger.log('con token malo   → %s', accesoPermitido_({ parameter: { t: 'xx' } }));
  Logger.log('sin token        → %s', accesoPermitido_({ parameter: {} }));
}
