# Cerrar el candado del Apps Script

Poner `GAS_ESTRICTO` en `true` para que el guardián **rechace** —y no solo
anote— las llamadas sin token.

Preparado el 2-ago-2026 para ejecutarse al día siguiente.

---

## Por qué no se cerró el mismo día

El registro de ejecuciones del 2-ago trae **10 llamadas sin token válido**:

| modo | veces | de dónde sale |
|---|---|---|
| `catalogo` | 3 | Captura de Series, al abrir |
| `promos` | 3 | Captura de Series, al abrir |
| `eol_venta` | 3 | Captura de Series, al abrir |
| `estado` | 1 | Admin o Actualizar datos |

Los tres primeros van juntos y en la misma cantidad: es el arranque de Captura
de Series, tres veces. O sea que **hay por lo menos un aparato con sesión de
antes del 1-ago**, cuando aún no existía el token.

Cerrar con eso vivo dejaba a esa persona sin catálogo, sin promos y sin precios
EOL a media jornada — y hasta hoy, sin enterarse de por qué.

## Lo que ya se hizo para poder cerrar sin romper nada

1. **Todas las llamadas mandan el token.** Revisadas una por una en las cinco
   apps. Las tres que parecían no llevarlo (`tablero.html:1476`,
   `comisiones.html:202`, `admin.html:770`) sí lo llevan.

2. **Las ocho subidas dejaron de ser ciegas.** Iban con `mode:'no-cors'` y
   decían "Enviado" pasara lo que pasara. Si el guardián rechazara a alguien,
   habría perdido un catálogo entero creyendo que subió. Ahora `gasEnviar()`
   lee la respuesta y distingue `no_autorizado` para decir "sal y vuelve a
   entrar" en vez de un número.

3. **Las cinco apps avisan si la sesión es vieja** (v108), desde que abren y no
   a media captura, con enlace al login.

## Antes de cerrar — la condición que falta

**Los cinco del equipo tienen que salir y volver a entrar.** El aviso de la v108
se los pide solo, pero hay que darles tiempo de abrir la app al menos una vez.

### El registro de ejecuciones no sirve para comprobarlo (3-ago-2026)

Este documento decía que se mirara en el editor →
`https://script.google.com/home/projects/<id>/executions`, expandiendo las filas
del día para buscar `SIN TOKEN VALIDO`. **Se intentó y no se puede.**

Las 50 ejecuciones del día, expandidas una por una y esperando a que cargaran,
dicen todas *"No hay ningún registro disponible de esta ejecución"*. El motivo
está en Configuración del proyecto: **GCP Predeterminado**. Con el proyecto de
Cloud por defecto los `Logger.log` de una aplicación web se retienen muy poco.
El dato del 2-ago se pudo ver porque se miró el mismo día.

Lo peligroso es cómo se ve el fallo: buscar en un registro vacío devuelve cero
coincidencias, **que es idéntico a que todo esté bien**. Siguiendo el
procedimiento al pie de la letra se habría cerrado el candado creyendo haberlo
comprobado. Es el mismo patrón del `catch` vacío, esta vez en el Apps Script.

### El procedimiento que sí sirve

`accesoPermitido_` ahora llama a `contarSinToken_` (en `GAS_guardian.gs`), que
lleva la cuenta en **Propiedades del script**: no caduca y se lee cuando sea.

1. Instalar `contarSinToken_` y la línea que la llama. Desplegar **editando la
   implementación que ya existe**, nunca creando una nueva.
2. Dejar pasar una jornada completa de tienda.
3. Configuración del proyecto → Propiedades de script → mirar `SINTOK_HOY`.

**Cómo se lee, que tiene trampa:** un día limpio no escribe nada, así que la
clave conserva la fecha del último día con llamadas malas. Mirar primero el
campo `dia`:

| Lo que se ve en `SINTOK_HOY` | Qué significa |
|---|---|
| el campo `dia` **no** es el de hoy | hoy, cero. **Se puede cerrar** |
| `dia` es hoy, con modos y números | alguien sigue entrando sin token. **Todavía no** |
| la clave no existe | nunca ha habido ninguna desde que se instaló |

`SINTOK_AYER` guarda la jornada anterior, para comparar.

## El cierre — hecho el 4-ago-2026, 00:30

Configuración del proyecto → Propiedades del script → `GAS_ESTRICTO` = `true`.

No hace falta volver a desplegar: `accesoPermitido_` lee la propiedad en cada
llamada, así que aplica al instante.

Hacerlo **fuera del horario de tienda**. Si algo se escapó, deja de funcionar
en el acto.

**Verificar recargando la página**, nunca por lo que se vea en el campo. Al
cerrarlo, el valor se quedó en `false` dos veces seguidas pareciendo guardado.

Comprobado tras cerrar, contra el `/exec` sin token: `?modo=estado` y
`?modo=zzz_inventado` devuelven los dos `{"error":"no_autorizado"}`. El segundo
importa tanto como el primero — era el que entregaba la hoja Ventas entera.

## Si algo sale mal

Volver a poner `GAS_ESTRICTO` en `false`. Surte efecto de inmediato, sin
desplegar. Es toda la reversión: no hay migración ni datos que deshacer.

Lo que se vería si algo quedó fuera: las apps mostrando *"la nube rechazó la
sesión — sal y vuelve a entrar desde el menú"*. Ese mensaje sale de `gasEnviar()`
y significa exactamente eso; se arregla volviendo a entrar, no revirtiendo.

## Después de cerrar, comprobar

- El tablero carga inventario y promos
- Captura de Series guarda una venta de prueba **y la borra**
- Admin abre la pestaña de bundles
- Comisiones muestra el periodo correcto

Si las cuatro pasan, quedó bien. El endpoint deja de ser público y las ~200
ventas con número de serie dejan de estar al alcance de cualquiera con la URL.

---

_Odemás · Grupo Gigante — uso interno HES 1217_
