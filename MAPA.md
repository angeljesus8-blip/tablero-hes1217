# Mapa del tablero — qué está ligado a qué

Antes de tocar cualquier cosa de esta carpeta, busca aquí qué depende de ella.
Cada cadena de abajo se rompió de verdad al menos una vez; la fecha lo dice.

**Regla:** un cambio no está terminado hasta que se probó la cadena completa,
no solo el archivo que tocaste.

---

## Las piezas

| Pieza | Qué hace | Quién la consume |
|---|---|---|
| `index.html` | Login por PIN o por sesión de Supabase. **Arma `hes_store`** | Todas las demás |
| `tablero.html` | Promos y precios, preventa, EOL, resurtir, Assurant | El equipo en piso |
| `captura_series.html` | Captura de ventas con serie y foto | El equipo en piso |
| `admin.html` | Sube comisiones, EOL, combos, avisos; gestiona equipo | Gerente y subgerente |
| `actualizar_datos.html` | Sube el Excel de Sonar y el CEA | Gerente y subgerente |
| `comisiones.html` | Muestra comisiones y attach | Todos |
| `sw.js` | Service worker. **Aquí vive la versión de la app** | Los 6 html |
| `datos.js` | Vacío a propósito. Solo estructura | `tablero.html` |
| Apps Script | 14 modos por `doGet` + guardar ventas por `doPost` | Todas |
| Supabase | `tiendas`, `empleados` + 10 tablas nuevas sin usar aún | `index`, `admin` |

---

## Cadena 1 · Sesión y token

```
login_asesor / login_empleado (Supabase)
      ↓ devuelve store_id, nombre, gas_url, vendedores, gas_token,
        hoja_auth, sheet_url   ← si el SQL no lo da, no existe para nadie
index.html arma cfg CAMPO POR CAMPO  ← si no lo nombras, se pierde
      ↓ localStorage.hes_store
tablero · captura · admin · actualizar_datos · comisiones
      ↓ &t=<gas_token> en cada llamada
Apps Script → accesoPermitido_()
```

**Si tocas la forma de `login_asesor` o `login_empleado`:** hay que agregar el
campo nuevo en los **dos** `cfg` de `index.html` y en `COLS` del select de
gerente. Se arma campo por campo, así que lo que no nombres se tira en silencio.
*(1-ago-2026: pasó con `gas_token`; el tablero quedó en "Sin conexión".)*

**Esta cadena tiene dos puntas, y la de arriba se nos olvidó.** Que
`index.html` nombre el campo no sirve de nada si `login_asesor` no lo devuelve:
llega `undefined`, se guarda como `''`, y cualquier comparación contra él es
falsa para siempre. Nada truena, simplemente nadie ve la función.
*(2-ago-2026: `hoja_auth` decide quién ve las ventas del día en Captura de
Series. El 1-ago se corrigió el nombre del campo en el cliente y se dio por
cerrado, pero el SQL nunca lo entregó — el botón llevaba un día oculto para
todos, incluida Laura, que es la única que lo usa. Lo cierra
`supabase_hoja_auth.sql`.)*

`verificar.py` ahora compara las dos listas: cada `data.X` que lee `index.html`
tiene que aparecer en algún `RETURNS TABLE` de `login_asesor`.

**Si cambias el token:** todos deben cerrar sesión y volver a entrar. Lo
guardado en `hes_store` no se actualiza solo. Lo mismo al correr el SQL de
arriba: la sesión vieja no trae los campos nuevos.

---

## Cadena 2 · Escrituras al Apps Script

```
tablero.html      → apartado_add, eol_add      (mandan pin=TIENDA_ID)
captura_series    → guardar y eliminar venta   (POST)
admin.html        → comisiones, bundles, avisos, notificar
actualizar_datos  → catalogo, catalogo_ref, exhibicion, promos
```

**`ADMIN_PIN` ya no tiene que valer `1217`** *(desde el 4-ago-2026)*. Antes sí:
`tablero.html` manda el número de tienda como PIN en `apartado_add` (l. 1030) y
`eol_add` (l. 1269), así que cambiarlo tumbaba **guardar en preventa** y marcar
EOL. *(1-ago-2026: se cambió y se cayó la preventa.)*

Lo que lo soltó fue el arreglo de `checkPin_`: **mira el token antes que el
PIN**, y el token lo manda toda llamada del tablero. Las dos rutas de arriba
siguen enviando `pin=1217`, que ya no coincide con nada — pasan por el token.
El 4-ago se cambió el PIN por uno que no está publicado, y se comprobó en piso
que **las dos** rutas siguen escribiendo: apartar una pieza y borrarla, y marcar
un SKU como EOL. Probar solo la primera habría dejado sin verificar justo la
otra que se cayó el 1-ago. Durante las pruebas no se registró ningún rechazo en
`SINTOK_HOY`, así que pasaron por el token y no de rebote.

Si alguna vez la preventa o el EOL vuelven a fallar, **restaurar `ADMIN_PIN` a
`1217` no es el arreglo**: sería volver a atar el permiso de escribir a un
número que está en el nombre del repo, en el título de la app y en el QR. Mirar
primero si la sesión trae token.

**`GAS_ESTRICTO` solo se pone en `true` cuando:** todos volvieron a entrar (para
tener token) **y** las apps saben avisar si las rechazan. *(1-ago-2026: se activó
antes de tiempo y se perdió un día de ventas sin que nadie se enterara.
4-ago-2026: se cerró bien, ver el bloque B más abajo.)*

---

## Cadena 3 · Del Excel al precio que se cobra

```
Informe Artículos Totales (Sonar) → actualizar_datos → Catalogo (UPC→SKU, precio)
CEA de promociones               → actualizar_datos → Promos (vigencias)
Comunicados EOL                  → admin           → EOL_cloud
                                          ↓
                    captura_series: promoActiva() decide el PRECIO QUE SE COBRA
                    tablero: cardPromo / cardPrecioReg lo muestran
```

**Prioridad de precio, igual en los dos lados:** EOL al 50% manda sobre
promoción, y promoción sobre regular. Si cambias uno, cambia el otro.

**Una promo sin fecha de fin NO es vigente.** Antes "sin fecha" era "vigente
para siempre" y 132 de 141 estaban así: se cobraban promociones terminadas.
*(1-ago-2026.)*

**Google Sheets convierte a fecha lo que parece fecha.** `leerPromos_` normaliza
con `isoFecha_`; si lo quitas, ninguna promo pasa el filtro. *(1-ago-2026.)*

---

## Cadena 4 · Autollenado en captura

**Los codigos de barras se leen del valor CRUDO del Excel, no del formateado.**
SheetJS con `raw:false` devuelve lo que se VE en la celda: una con formato
cientifico da `"6.94E+12"` aunque el numero de abajo este perfecto. Eso llega al
Apps Script, que lo escribe sin comilla simple, y Sheets lo convierte a
`6942100000000`. Seis productos acabaron con el mismo codigo.

La tuberia entera tiene que respetarlo: `valorCrudo()` en admin.html al leer, y
la comilla simple en `actualizarCatalogoRef_` al escribir. `actualizarCatalogo_`
ya protegia; la de referencia no.

*(2-ago-2026. El parser del catalogo principal ya habia topado con esto y lo
"resolvia" con `if(/e\+/i.test(upc)) continue`, o sea descartando el producto en
vez de leerlo bien. Ese continue se quito.)*

**Hay codigos de barras comodin compartidos por varios productos.** `6942100000000` lo usan 6 (un MatePad y cinco FreeBuds). Como `leerCatalogo_` indexaba SOLO por UPC, se pisaban entre si y sobrevivia uno: los demas desaparecian del catalogo y al teclear su SKU no salia ni descripcion ni precio, sin ningun aviso.

Ahora cada SKU lleva SIEMPRE su entrada `sku:XXXX`, ademas de la del codigo. El escaneo de un codigo compartido sigue siendo ambiguo —lo es en el dato de origen— pero ninguno desaparece y el tecleo nunca falla.

*(2-ago-2026. Lo destapo la migracion al comparar 215 SKUs contra 215 y encontrar uno de diferencia. El primer intento de arreglo dio por hecho que el producto no tenia codigo; si lo tenia, y por eso no sirvio: hay que mirar el dato antes de arreglar.)*

```
Catalogo (indexado por UPC) → CATALOGO
                            → reindexarPorSku() → CAT_POR_SKU
escanear código  → routeCode  → aplicarProducto()
teclear SKU      → listener   → aplicarProducto()   ← misma función a propósito
```

**Si tocas `aplicarProducto`, cambian los dos caminos.** Es deliberado: antes
divergían y teclear no llenaba nada.

---

## Cadena 5 · Inventario

**El error de conteo no se acumula entre días.** El On Hand no se ajusta: se
*reemplaza* completo cada mañana con el número del sistema, y el baseline se
vuelve a tomar ahí mismo. Una venta que no descuente bien desajusta el stock
solo hasta la siguiente subida. Es diseño deliberado — por eso el tablero puede
calcular en vivo sin miedo a la deriva.

*(2-ago-2026: al cotejar los datos para migrar se reportaron cinco ventas sin SKU
como "inventario inflado desde julio". Falso: llevaba casi treinta subidas de On
Hand encima. Antes de llamar histórico a un descuadre, contar cuántas subidas han
pasado.)*

```
Artículos Totales      → onhand   (equipo cerrado; NO incluye exhibición)
Inventario No Disponible → exhibe (piezas en aparador)
ventas capturadas      → vendido  (desde ventaBaseline)

stock para vender = onhand − vendido
```

**Verificado en piso el 1-ago-2026:** On Hand **no** incluye la exhibición.
Tres conteos físicos lo confirmaron. No "corrijas" esta fórmula restando
`exhibe`: mostraría menos stock del real.

**Dos baselines a propósito:** `ventaBaseline` se reinicia con el On Hand diario;
`exhibBaseline` solo al subir exhibición. Si los unes, una pieza de exhibición
vendida reaparece al día siguiente.

**Si el On Hand está viejo, el número miente** aunque el código esté bien: una
caja que se abre para el aparador sigue contando como cerrada hasta la
siguiente subida.

---

## Cadena 6 · Service worker

```
cualquier .html o datos.js  →  sube VERSION en sw.js  →  el celular actualiza
```

**Sin subir `VERSION`, nada llega.** GitHub Pages sirve lo nuevo pero el
service worker devuelve la copia cacheada. *(1-ago-2026: se cambiaron seis
archivos sin subirla y se depuró horas sobre una versión que nadie tenía.)*

`verificar.py` bloquea el commit si se te pasa. También avisa si el precache
apunta a un archivo que ya no existe.

---

## Antes de dar algo por terminado

1. `python verificar.py` — corre solo en el commit, pero córrelo antes
2. **Prueba la cadena, no el archivo.** Si tocaste el login, entra; si tocaste
   captura, captura una venta y **búscala en la hoja**
3. **Sube `VERSION` en `sw.js`** y espera a que Pages reconstruya
4. **Cierra y abre la app** — sin eso estás viendo la versión vieja
5. Si es horario de tienda y el cambio toca guardar datos, avisa antes

---

## Antes de mover algo grande

No se empieza a escribir hasta tener esto contestado y acordado:

1. **El problema real**, no el síntoma que se ve.
2. **Inventario completo de lo afectado** — sacado con `grep`, no de memoria.
3. **Qué se rompe si falla, y si avisaría.** Lo que falla callando cuesta horas.
4. **El orden de los pasos**, incluyendo lo que va después y de qué depende cada
   uno. Si un paso necesita que la gente vuelva a entrar, eso *es* un paso.
5. **Cuándo.** Si toca guardar datos, no en horario de tienda.

### Ejemplo de lo que NO se hizo así (1-ago-2026)

Cerrar el Apps Script se ejecutó pieza por pieza. El inventario correcto era:

| Ruta | Tipo | ¿Avisa si falla? |
|---|---|---|
| `tablero` · 10 modos | lee y escribe | No |
| `captura_series` · guardar venta | escribe | **No** — `mode:'no-cors'` |
| `admin` · 5 modos | escribe | No |
| `actualizar_datos` · estado | lee | No |
| `comisiones` · modo=comisiones | lee | No |

Con esa tabla enfrente el orden salta solo: **primero** que todas puedan avisar,
**luego** el token, **al final** cerrar. Se hizo al revés y se perdió un día de
ventas.

---

## Cerrar el candado del Apps Script

Listo para el 3-ago-2026, con una condición que hay que comprobar y no suponer:
el registro del 2-ago traía **10 llamadas sin token** (`catalogo`, `promos` y
`eol_venta`, tres de cada uno — el arranque de Captura de Series). Hay al menos
un aparato con sesión de antes del 1-ago.

No se cierra hasta que ese contador esté en cero. Procedimiento y reversión en
`GAS_cerrar_candado.md`.

## Lo que sigue, en orden

Esto es el panorama completo, no una lista de pendientes sueltos.

**A · Que nada falle callando** — ✅ **hecho** *(3-ago-2026)*
Los 31 `catch` vacíos que quedan están todos explicados: 24 con el motivo al
lado y 7 con el comentario en la línea de arriba (todos lecturas de caché de
`localStorage`, donde callar es correcto). Ninguno tapa una falla.

Lo que sí estaba roto era el vigilante. `verificar.py` decía "todo en orden"
con dos puntos ciegos: solo miraba `catch(e){}` con las llaves en la misma
línea, y aceptaba cualquier `//` de las cuatro líneas de arriba como
explicación. Además numeraba sobre el JS extraído, así que mandaba a una línea
que no era. Los tres quedaron arreglados y **probados con casos falsos**: un
`catch` vacío nuevo, en una línea o en varias, ahora sí detiene el commit.

**B · Cerrar el Apps Script, bien esta vez** ← *lo siguiente*
Ya no depende de A. Estado comprobado el 3-ago: `GAS_ESTRICTO=false`,
`GAS_TOKEN` puesto (64 caracteres), `ADMIN_PIN=1217`, y el guardián llamado
desde `doGet` **y** `doPost`. Falta la condición de cero llamadas sin token —
y ahí está el problema, ver abajo. Después: `GAS_ESTRICTO=true` fuera de
horario → aplicar `GAS_arreglo_apartados.gs` para que el token valga por sí
solo y el PIN quede de respaldo.

### El registro no se puede leer (3-ago-2026)

`GAS_cerrar_candado.md` manda comprobar la condición expandiendo las filas de
Ejecuciones y buscando `SIN TOKEN VALIDO`. **Ese procedimiento no es
ejecutable.** Todas las filas del día, expandidas una por una y con espera,
dicen *"No hay ningún registro disponible de esta ejecución"*.

El motivo está en Configuración del proyecto: **GCP Predeterminado**. Con el
proyecto de Cloud por defecto, los `Logger.log` de una aplicación web se
retienen muy poco y el panel se queda vacío a las pocas horas. El dato del
2-ago se pudo ver porque se miró el mismo día, casi enseguida.

Buscar en un registro vacío devuelve cero coincidencias, que es exactamente lo
que se vería si todo estuviera bien. **Un cero de esos no es evidencia de
nada** — es el mismo caso que un `catch` vacío, un fallo que se ve como éxito.

Para cerrar hace falta un contador que no dependa de Cloud Logging:
`accesoPermitido_` tiene que dejar el rastro en Propiedades del script, que se
leen cuando sea desde Configuración del proyecto.

### ✅ CERRADO el 4-ago-2026, 00:30

`GAS_ESTRICTO = true`, comprobado recargando la página (no por lo que se veía
en el campo: aquí un guardado que no se guarda tiene el mismo aspecto que uno
que sí — pasó dos veces antes de conseguirlo).

**El endpoint ya no es público.** Contra el `/exec`, sin token:

| Petición | Antes | Ahora |
|---|---|---|
| `?modo=estado` | devolvía el estado | `{"error":"no_autorizado"}` |
| `?modo=zzz_inventado` | **200 filas de Ventas con número de serie** | `{"error":"no_autorizado"}` |

**El contador quedó probado de punta a punta**, y con él la rotación por día:
`SINTOK_AYER` se archivó solo al pasar la medianoche, y `SINTOK_HOY` registró
los rechazos ya con el candado cerrado —incluido `zzz_inventado`, que no existe
como modo y es el que demuestra que el `else` final ya no devuelve la hoja—.

`SINTOK_HOY` se borró después de probar, así que **la medición arranca limpia**:
si aparece con la fecha de hoy, es tráfico real, no restos de las pruebas.
`SINTOK_AYER` todavía guarda dos llamadas del 3-ago que fueron de prueba; se
pisa solo en cuanto haya un día con llamadas de verdad.

### Las cuatro apps, comprobadas

Tablero, Captura de Series, Admin y Comisiones funcionan con el candado
cerrado. Y no solo por lo que se ve en pantalla: **`SINTOK_HOY` no llegó a
existir** durante las pruebas, o sea que ninguna de las cuatro hizo una sola
llamada sin token. La revisión a mano de las cinco apps era correcta.

`comisAt` quedó en `2026-08-04`: comisiones **escribió**, no solo leyó. Una
escritura entera pasó el guardián.

Nadie se quedó fuera, así que no había ninguna sesión anterior al 1-ago viva.

### El arreglo de apartados — ✅ desplegado y probado el 4-ago-2026

`checkPin_` acepta ahora el token y deja el `ADMIN_PIN` de respaldo. Es
**aditivo**: el camino del PIN devuelve exactamente lo mismo que antes —se
comparó caso por caso contra la versión anterior—, así que nada de lo que hoy
funciona puede dejar de hacerlo. De ahí cuelgan **12 rutas de escritura**:
bundles, EOL, apartados, avisos y notificar.

Es **más** estricto que antes, no menos: antes bastaba con mandar `pin=1217`, y
el número de tienda está en el nombre del repo, en el título de la app y en el
QR. El token solo lo tiene quien pasó por el login.

Lo que desbloquea: **ya se puede cambiar `ADMIN_PIN`** por algo que no esté
publicado. Hasta ahora estaba clavado en `1217` porque el tablero lo manda como
PIN, y tocarlo tumbaba la preventa y marcar EOL.

Lo que **no** hace: distinguir gerente de asesor. Con el candado cerrado,
cualquiera con sesión pasa `checkPin_`, igual que antes cualquiera con la URL
pasaba con `pin=1217`. Si algún día hace falta esa distinción, es otro trabajo.

Comprobado en la **versión 39**, y por la cadena entera, no por el archivo:

- Apartar una pieza de prueba en el tablero y borrarla → **guarda**. Ahí se
  demuestra lo único que importaba: `checkPin_` acepta el token en la ruta real.
- `?modo=apartado_add&pin=1217` **sin** token → `no_autorizado`. La vía que
  antes estaba abierta a cualquiera con la URL ya no escribe nada; el guardián
  la corta antes de llegar a `checkPin_`.
- Durante la prueba del apartado no se registró **ni un rechazo** en
  `SINTOK_HOY`, así que esas llamadas iban bien autenticadas.

Siguiente paso natural, ya sin riesgo: **cambiar `ADMIN_PIN`** por algo que no
esté publicado. Al hacerlo, volver a apartar una pieza y borrarla — el PIN
dejaría de ser el camino, y hay que ver que el token sí lo es.

Reversión, si hiciera falta: `GAS_ESTRICTO` a `false`. Inmediato, sin desplegar
y sin datos que deshacer.

### El respaldo del Apps Script ya no coincide

`GAS_Codigo.gs` tiene 970 líneas y el script vivo tenía 1009 **antes** de tocar
nada. O sea que el respaldo del 2-ago se quedó atrás y hay ~39 líneas en
producción que no están versionadas en ningún lado.

No se puede arreglar desde aquí: la extensión de Chrome no deja que el código
salga del editor hacia Claude (solo escribir). Lo tiene que pegar Ángel en el
chat para volver a dejarlos iguales. Mientras tanto, **el respaldo no sirve
para restaurar**.

**C · Migración a Supabase** ← *en marcha*

**El esquema NO está vacío**, aunque este mapa lo dijera hasta el 4-ago. Las
diez tablas están creadas **y cargadas**: 215 SKUs, 117 promos y las ventas
históricas responden desde Supabase. Se comprobó preguntándole a la base, no
leyendo documentos —los tres que había se contradecían entre sí—.

Ojo al comprobarlo: consultar las tablas por REST devuelve **0 filas aunque
haya datos**, porque RLS las tapa. `tiendas` y `empleados` también dan 0 y
obviamente tienen datos, si no nadie entraría. Hay que llamar a las funciones
`SECURITY DEFINER`, que sí ven.

Estado por fases, en `MIGRACION_PLAN.md`:

| Fase | Estado |
|---|---|
| 1 · datos y paridad | 13 funciones aplicadas y comparadas; **falta resincronizar** |
| 2 · lecturas | lista, en cuanto la 1 cierre con datos del mismo día |
| 3 · ventas, doble escritura | desbloqueada: la regla de la serie ya está aplicada |
| 4 · fotos, autollenado, edición | — |
| 5 · retirar el Apps Script | — |

**La comparación de paridad caduca.** Se comparó el 4-ago contra datos cargados
el 2-ago: ocho lecturas dieron igual y cinco distinto, y las cinco eran el mismo
desfase —un catálogo nuevo, un On Hand reemplazado, dos días de ventas y un
cambio de mes en comisiones—, no un error de traducción. Estuvo a punto de
parecerlo en la parte más delicada, el inventario.

Mientras la carga sea manual y única, la fase 1 caduca en cuanto se sube el
Excel del día. Hay que hacerla repetible y comparar el mismo día.

**Medido de paso, con datos reales:** `modo=todo` en el Apps Script tarda
**8.255 ms**; `tablero_todo` en Supabase, **373 ms**.

Lo que se gana: montar una tienda pasa de cuatro pasos manuales a un `INSERT`.

**D · Limpieza pendiente** *(independiente, se puede hacer cuando sea)*
Historial de git del tablero (todavía guarda `comisiones_datos.js` con nombres,
ventas y comisiones) · ticket a GitHub por los commits huérfanos del planeador ·
`exhibAt` para detectar cuándo el On Hand quedó viejo.

## Lo que todavía puede fallar callando

En el cliente, nada conocido: los 31 `catch` vacíos que quedan están revisados
uno por uno y explicados, y `verificar.py` ya detiene cualquiera nuevo (A).

Queda uno, y es del lado de la nube: **el guardián avisa por un canal que no se
puede leer**. `accesoPermitido_` deja el rastro con `Logger.log` y ese registro
se borra solo a las pocas horas, así que la única señal de que alguien está
entrando sin token desaparece antes de que nadie la mire. Es el mismo patrón de
siempre —falla que se ve igual que un éxito— movido al Apps Script.

Se cierra con el contador en Propiedades del script descrito en B.
