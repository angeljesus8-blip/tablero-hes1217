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
| `horarios.html` | Planeador semanal. **Copia — no se edita aquí** (ver Cadena 7) | Gerente y equipo |
| `sw.js` | Service worker. **Aquí vive la versión de la app** | Los 7 html |
| `datos.js` | Vacío a propósito. Solo estructura | `tablero.html` |
| Apps Script | 14 modos por `doGet` + guardar ventas por `doPost`. **Ya no la preventa** (cadena 6-ter) | Todas |
| Supabase | Las 11 tablas. **Fuente única de apartados** desde el 7-ago | Todas |

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

### Cadena 1-bis · Quién ve qué *(9-ago-2026, v167)*

La sección **🔄 Resurtir** es de gerente y subgerente. Pedirle mercancía al CD
es trabajo de quien lleva la tienda; el asesor sigue viendo el producto entero
en Precios y en el buscador, bajo *«se traen de otra tienda»*.

```
empleados.puesto (Supabase)
      ↓ login_empleado → emp_puesto        ← puerta 1: número de empleado ✅
      ↓ vincular_mi_cuenta → puesto        ← puerta 2: correo y contraseña
index.html guarda hes_empleado.puesto      ← se arma campo por campo
      ↓
tablero.html · PUEDE_GESTIONAR
      ↓ seccionVisible_() lo consultan LOS CUATRO:
tarjeta de Inicio · render · buscador global · el hash de la URL
```

**El criterio es el PUESTO, no `admin`.** Son dos preguntas distintas —«qué
haces en la tienda» y «puedes tocar la configuración»— que hoy coinciden por
casualidad, con las mismas dos personas. Atarlas habría dado el permiso
equivocado el día que se separen, sin que nadie lo notara.

**Las dos puertas tienen que entregar el puesto, y la segunda no lo hacía.**
`vincular_mi_cuenta` devolvía store_id, nombre, admin y empno — no el puesto — y
`index.html` guardaba `puesto:''`. O sea que Miguel veía una cosa entrando con
su número y otra con su correo: la misma persona, el mismo puesto, distinta
puerta. Es exactamente el fallo de `hoja_auth` de arriba, repetido. Lo cierra
`supabase_puesto_en_sesion.sql`.

**Sin puesto se cae en el rol, y eso NO es un agujero:** es el gerente dueño de
la tienda, que entra con el correo de la tienda y por eso no tiene ficha de
empleado que mirar. Un asesor nunca llega ahí con rol de gerente.

**Cuatro sitios preguntan, uno solo decide.** `seccionVisible_()` existe porque
esconder una sección son cuatro sitios, no uno, y basta olvidar el del hash para
que `#resurtir` pegado a mano la siga abriendo. El portero vive al principio de
`render()` —la única puerta por la que se pinta algo— y no dentro de la rama de
la sección: ahí habría dejado la cabecera con su título y la pantalla vacía
debajo.

**El permiso no se congela en el teléfono.** `hes_empleado` se escribe UNA vez,
al entrar, y nadie cierra sesión nunca. `confirmarPuesto()` se lo vuelve a
preguntar a `login_empleado` en cada arranque y **corrige en las dos
direcciones**: quitar sería más "seguro" y estaría mal, porque ascender a
alguien y que no vea lo suyo no da ningún error y nadie ataría el síntoma a un
puesto viejo guardado en un celular.

⚠️ **Esto se le esconde al asesor, no se le oculta el dato.** El inventario
completo baja igual al teléfono: es el mismo `D.inventario` que alimenta
Precios. Quien edite el `localStorage` a mano vería la sección hasta que
Supabase lo desmienta. Para que el dato no llegue habría que partir la lectura
del tablero, y eso rompe Precios.

Lo cubren cuatro pruebas de `casos_tablero.js` (bloque 7), **las cuatro
comprobadas rompiendo su guardia a propósito**. La que más importa no es la que
esconde: es la que exige que el producto **siga apareciendo** en el buscador del
asesor y no acabe en «ya no se maneja en la tienda» — pasar de *«se consigue»* a
*«no lo pidas»* es peor que enseñarle la lista de pedidos.

---

## Cadena 2 · Escrituras al Apps Script

```
tablero.html      → eol_add                    (manda pin=TIENDA_ID)
captura_series    → guardar y eliminar venta   (POST)
admin.html        → comisiones, bundles, avisos, notificar
actualizar_datos  → catalogo, catalogo_ref, exhibicion, promos
```

⚠️ **`apartado_add` salió de esta lista el 7-ago-2026.** La preventa ya no pasa
por aquí: ver la cadena 6-ter. Los tres modos de apartados siguen existiendo en
el Apps Script pero **responden un error a propósito**, para que una app vieja
en caché diga "no se guardó" en vez de escribir en una hoja que ya nadie lee.

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

## Cadena 2-bis · El tablero lee de Supabase *(desde el 4-ago-2026, v110)*

```
refrescarNube()
   1º cargarTodoSupabase()  → tablero_todo (Supabase)   ~0,25 s
   2º cargarTodoNube()      → modo=todo   (Apps Script) ~7 s
   3º las siete sueltas, espaciadas
         ↓  las tres pasan por
   aplicarTodo()  →  aplicarInventario · aplicarPromos · aplicarEol · …
```

**Supabase devuelve filas; las funciones `aplicar*` esperan los objetos
indexados del GAS.** Entre medias está `_deSupabase`, que traduce. Si se toca
una de las dos formas hay que tocar el traductor, y **volver a comparar contra
`modo=todo`** — es lo que se hizo antes de escribirlo: 215 SKUs sin diferencia
en onhand, vendido, exhibición ni exh_vendida.

**Las tres rutas comparten `aplicarTodo` a propósito.** Si alguien duplica ese
código "para el caso de Supabase", una de las ramas se quedará atrás y el
tablero mostrará cosas distintas según qué nube contestó — y eso no da error.

**Los campos que el tablero usa de cada estructura no son los obvios.** De los
apartados usa `color`, `precio`, `transaccion`, `vend` y `seguro`.
`apartados_lista` no devolvía los tres primeros y se amplió: `transaccion` es el
ticket del POS, el enlace entre el apartado y la venta. Antes de dar por buena
cualquier lectura nueva, sacar con `grep` qué campos consume de verdad.

**En `color` de los apartados va el producto entero** desde el 4-ago-2026:
`Pura 90S Pro Max 12/512GB · Graphite Black`. Antes solo el color, y al abrir la
hoja no se sabía si era Pro o Pro Max — se deducía por el precio, que no es
forma de entregar un equipo. Los 9 apartados que ya existían se completaron a
mano en la hoja.

El campo Color ya **no** contiene solo el color: para contar o filtrar por
color hay que partir por el `·`. Se eligió así para tenerlo el mismo día; el
sitio natural de darle campo propio es la fase 4, cuando toque rehacer las
escrituras.

⚠️ *Pendiente menor:* Supabase todavía tiene los 9 viejos con el color a secas
—el dashboard no respondía para resincronizar—. No se ve en el tablero, porque
`cardApartado` saca el modelo del catálogo por SKU, no del texto guardado. Se
arregla solo en la próxima `resincronizar('1217')`.

**Si Supabase cae, no pasa nada:** `sbRpc` corta a los 8 s y devuelve `null`, y
se sigue por el Apps Script. Probado rompiendo Supabase a propósito — el
tablero quedó igual, solo más lento.

### Lo que sostiene que el inventario cuadre *(léase antes de tocar nada de esto)*

`inventario_vivo` descuenta lo vendido de la tabla `ventas` **de Supabase**. Así
que el stock del tablero solo es correcto si TODAS las ventas llegan ahí.

    captura → Sheet (confirma) → guardarEnSupabase() → tabla ventas
                                        ↓ si falla
                                  cola en localStorage
                                  (se reintenta al abrir la app y al volver la red)

El 4-ago esto estuvo mal montado durante unas horas: las lecturas se movieron a
Supabase **antes** de que existiera la doble escritura, y el tablero mostraba una
pieza de más por cada venta del día. No lo trae Supabase — lo trae leer de un
lado lo que se escribe en el otro.

**Si el inventario no cuadra, mirar en este orden:**
1. `window._sbFallos` en la consola de Captura de Series
2. `localStorage.hes1217_sb_pend` — si tiene cosas, esas ventas no llegaron
3. `resincronizar('1217')`, que lo deja todo al día

Reintentar es seguro: `venta_guardar` responde `ok+duplicada` ante una serie
repetida el mismo día, así que nunca duplica una venta.

### El Assurant del día también lleva candado *(17-ago-2026, v168)*

Tercer candado `__sb`, junto al del stock y el de los apartados, y por el mismo
motivo. `aplicarTodo` aplicaba `d.ventas_hoy` **viniera de donde viniera**, y
`cargarVentasNube()` se lo pedía directamente al Apps Script.

Mientras la doble escritura viva no se nota: los dos lados traen las mismas
ventas. **El día que se apague, la hoja se queda congelada** y el leaderboard
enseñaría el Assurant del último día que la recibió — además pisando el bueno,
porque el `modo=todo` llega ~7 s después que Supabase.

Y no daría ningún error: daría un porcentaje. Un attach del 40 % de anteayer se
ve igual de creíble que el de hoy, y es el KPI que se reporta con meta del 25 %.

Se cerró **antes** de tocar la escritura, a propósito: con los dos lados
diciendo lo mismo, el cambio se comprueba en piso sin nada en juego.

- `CARGAS.ventas` es nuevo. Era la única carga que podía quedarse vieja sin que
  el banner dijera nada; ahora sale como **«Assurant del día»**.
- `_vendDeSupabase` traduce las filas en **un solo sitio**, para el viaje único
  y para la carga suelta. Duplicarla es la trampa de siempre: la copia que se
  queda atrás hace que el tablero enseñe cosas distintas según qué llamada
  contestó.
- Lo cubre el caso 8 de `casos_tablero.js`, **comprobado rompiendo la guardia**.
  Prueba las dos mitades: que el dato de Supabase sí entre y que el del GAS no
  pise. Una guardia pasada de frenada dejaría el leaderboard vacío para
  siempre, que es cambiar un fallo callado por otro.

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

**El catálogo de la nube se descartó entero durante dos días** *(2 al 4-ago-2026)*.
`esCatalogoValido` miraba **solo la primera clave** del objeto y exigía un código
de barras. Al empezar a guardar una entrada `sku:XXXX` por producto —insertada
antes que la del código, y como ningún UPC de 13 dígitos es índice de array
manda el orden de inserción— la primera clave pasó a ser siempre `sku:...`, la
validación dio `false` y se tiró todo.

No lo notó nadie porque la app tira del caché y de `datos.js`: lo ya conocido se
seguía autollenando. **Lo que dejó de llegar fueron los productos nuevos**, que
es justo para lo que sirve pedirle el catálogo a la nube.

Dos lecciones, y la segunda es la que importa:
- No validar por «la clave que caiga primera»: el orden de enumeración de un
  objeto depende de si las claves parecen enteros. Ahora se mira si existe
  **alguna** clave con forma de catálogo.
- **Un caché que tapa el fallo lo vuelve invisible.** Cuando algo se refresca
  desde la nube pero también tiene copia local, hay que comprobar que el
  refresco entra de verdad — no que la pantalla se vea bien.

Salió al probar el respaldo de la fase 2 rompiendo Supabase a propósito. Con la
migración funcionando no se veía, porque el adaptador nuevo mete los UPC
primero y por eso sí validaba: estaba tapado por partida doble.

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

### El informe NO trae los agotados, y está bien *(8-ago-2026)*

El *Informe de Artículos Totales en Tienda* que se sube en Admin **solo lista los
SKU que tienen piezas**. Un producto agotado simplemente no viene en el archivo.

Y `carga_catalogo` solo actualiza el ON HAND de lo que viene. Visto así parece
un fallo —un SKU que se agota conservaría sus piezas para siempre— pero **no lo
es**, porque son dos fuentes que se complementan:

```
el reporte pone el punto de partida  →  onhand
las capturas descuentan en vivo      →  stock = onhand − vendido
```

Un SKU no se agota solo: se agota vendiéndose, y esas ventas se capturan. Para
cuando el archivo deja de traerlo, el tablero ya lo bajó a cero por su cuenta. Y
como tampoco se toca su corte, la resta sigue dando cero indefinidamente.

**Comprobado el 8-ago-2026** contra un archivo de 69 renglones:

```
227 en catálogo · 69 vigentes (= los 69 del Excel) · 70 con onhand > 0
el 1 de diferencia:  Band 11 Pro AZ, onhand 1 − 1 venta = stock 0  ✓
de los 69 vigentes, 0 vienen con cero  → el archivo solo trae lo que hay
```

**Lo que sí rompería esto** son las salidas que no son venta capturada:

- una venta que no se metió en la app
- **un traspaso de SALIDA** — mandarle una pieza a otra tienda no es venta y no
  pasa por Captura de Series

Si era la última pieza, el SKU desaparece del archivo y el tablero se queda con
ella. Nadie lo corrige, porque ya no vuelve a venir hasta que llegue mercancía.

Hoy no hay ni un caso. Si empiezan a ser frecuentes, el arreglo es poner en cero
lo que no venga en el archivo —la misma señal que ya usa el `vigente = false` de
la línea 111— pero **con candado**: un Excel subido a medias dejaría el tablero
diciendo que no hay nada que vender.

*(Anotado porque estuve a punto de "arreglar" esto sin entenderlo. La ausencia en
el archivo no es falta de dato: es el dato.)*

### Tener una pieza y poder venderla no es lo mismo *(8-ago-2026, v150)*

La pieza de exhibición de un producto **activo no se vende**. Se queda en el
aparador hasta que llegue caja del CD. Solo se vende la de piso cuando el
producto está **EOL**, y entonces va al 50 %.

De los cinco estados de `estadoSku`, **solo dos son vendibles hoy**:

| estado | qué hay | ¿se vende hoy? | ¿botón de apartar? |
|---|---|---|---|
| `hay` | piezas en bodega | sí | no |
| `50` | EOL, solo la de piso | sí, al 50 % | no |
| `piso` | activo, solo la de piso | **no** | **sí** |
| `traer` | nada por ningún lado | no | sí |
| `no` | EOL y agotado | no | no — no llega nunca |

Toda la app pregunta esto por **un solo sitio**: `tieneExistencia_(sku)`, y
`conPiezas_(x)` es la misma función con el objeto en vez del SKU. Si mañana hace
falta otra lectura de "¿hay para vender?", sale de ahí y no de `stock || exhibe`.

**Por qué se escribió esto:** hasta v149 `tieneExistencia_` devolvía `true` con
solo tener exhibición. 17 SKU sin una sola pieza vendible se contaban como "con
existencia", salían arriba en Precios y eran los únicos a los que el tablero
**negaba** el botón de apartar. El asesor leía «1 de piso», creía que tenía qué
entregar, y el cliente se iba con las manos vacías. Ahora la pastilla dice
**«0 para vender · 1 en piso, no se vende»** y ofrece traerlo de otra tienda.

*(La sección Resurtir sigue separándolos: «🪟 Queda piso — pedir caja» es la
acción del gerente, distinta de la del asesor con el cliente enfrente.)*

### El Assurant del día era distinto en cada celular *(8-ago-2026, v151)*

`attTotal()` sumaba dos cosas que no se pueden sumar:

```
attCapturado()  → ventas de TODA la tienda, desde Supabase
attManual()     → botones ✓/✗, en el localStorage de UN celular
```

Consecuencias, ninguna de las cuales daba error:

- El KPI que se le reporta a Demetrio **salía distinto en cada teléfono**, y no
  había forma de saber cuál era el bueno.
- Una venta ajustada a mano y capturada después contaba **dos veces** en ese
  aparato: la nube la traía una vez y el manual otra.
- El % grande **no cuadraba con las filas del equipo** de abajo. Las filas salían
  de la nube limpias; el porcentaje llevaba los manuales encima. Cualquiera que
  sumara las filas obtenía otro número.

Los botones y todo el mecanismo manual se retiraron. El Assurant es ahora
exactamente lo que dice Supabase — **la suma de las filas es igual al total, y se
puede comprobar de un vistazo**. Si falta una venta, se captura en la app, que es
donde vive la serie.

*(Esto sobrevivió a la migración porque el manual se escribió cuando el tablero
solo veía las capturas de su propio celular. Ahí sí tenía sentido. Al empezar a
leer de toda la tienda, dejó de tenerlo y nadie volvió a mirarlo.)*

### Un SKU en promoción puede no tener fila de inventario *(8-ago-2026)*

`AGOTADOS` y `RESURTIR` se arman desde `D.inventario`. Un producto que nunca ha
entrado a la tienda no tiene fila ahí, así que **no aparecía en la lista de
pedidos** aunque estuviera anunciado en el folleto — detectado con el MatePad
P-Max 13.2" (SKU 100305952). Nadie lo iba a pedir jamás.

`calcDerivados()` los añade a `AGOTADOS` desde `PROMOS`, marcados con
`nuncaLlego` para que salgan con badge **🆕 nunca ha llegado** en la lista y en
el WhatsApp al CD.

---

## Cadena 5-bis · Volver donde estabas *(8-ago-2026, v152)*

```
sales de la app  →  Android la descarta  →  vuelves
                                              ↓
                          el sistema relanza start_url = index.html
                                              ↓
                          continuidad.js te devuelve a tu pantalla
```

**El síntoma:** el asesor busca un producto, toca «📲 Compartir», manda el precio
por WhatsApp y al volver está en el menú. Tiene que buscar el producto otra vez.
Cada vez que manda un precio — y el tablero manda a WhatsApp desde cuatro
botones, así que rompe el flujo de venta normal.

No es un fallo del tablero: Android descarta la PWA en segundo plano y la
relanza desde `start_url`. Nadie guardaba en qué pantalla estabas.

**Las cuatro piezas, y por qué hacen falta las cuatro:**

| pieza | sin ella |
|---|---|
| `continuidad.js` apunta la pantalla y el menú te devuelve | vuelves al menú |
| el tablero escribe sección y búsqueda en el hash (`#promo/matepad`) | vuelves al tablero, pero a Inicio y sin la búsqueda |
| borrador del apartado y de la captura | vuelves a la pantalla correcta, con los campos vacíos |
| el service worker deja de esperar a la red sin tope | vuelves, pero tras segundos de pantalla en blanco |

**Lo que NO debe reanudar** — las tres son igual de importantes que reanudar:

- Tocar «‹ Menú» borra la marca. Salir por tu cuenta es haber terminado.
- El botón **atrás** del teléfono no reabre lo que se acaba de cerrar
  (`performance.navigation.type === 'back_forward'`). Sin esto el «atrás» queda
  inservible: te devuelve a la pantalla de la que intentas salir.
- **Sin `hes_store` no se reanuda.** Las apps sin sesión enseñan un «vuelve a
  entrar»; mandar ahí a alguien cuya sesión se cayó le cambia el login por un
  callejón sin salida.

**Al tocar esto, el orden importa:** `continuidad.js` lee la marca ANTES de
volver a guardarla. Al revés, el `guardar()` de arranque escribe el scroll
actual —que siempre es 0, porque la página acaba de cargar— y pisa la altura que
venía a restaurar. La marca quedaba bien y el asesor volvía arriba del todo.

*`horarios.html` queda fuera a propósito: es una copia que también vive en el
repo planeador-odemas, donde `continuidad.js` no existe. Mismo motivo por el que
su fuente sigue viniendo del CDN.*

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

## Cadena 6-bis · El cupo de preventa *(5-ago-2026)*

```
tablero.html · const PREVENTA   → lo que ve el asesor
        │  preventa_cupo_gen.py
        ▼
supabase_preventa_cupo.sql      → el tope que frena dos apartados a la vez
```

El cupo tiene que vivir en dos sitios: el número del navegador y el de la base.
**Se escribe una sola vez, en `tablero.html`**; el SQL se genera con
`python preventa_cupo_gen.py` y se pega en el SQL Editor. La regla `cupo` de
`verificar.py` bloquea el commit si los dos dejan de coincidir.

**Lo que se midió el 5-ago-2026:** `preventa_cupo` estaba VACÍA. El trigger
`apartado_cabe` existía desde la migración, pero con el tope en NULL deja pasar
todo ("sin cupo definido, sin límite"), así que el único freno era el número del
navegador: **dos asesores apartando la última pieza a la vez podían guardarla los
dos.** Al correr el SQL, el tope aplica de verdad y un apartado que se pase se
rechaza con "Cupo agotado".

De paso, el trigger sumaba `NEW.piezas` incluso al marcar un apartado como
**Cancelado** —la pieza que se libera contaba como ocupada—, así que con el cupo
lleno habría impedido cancelar. Corregido en el mismo archivo.

---

## Cadena 6-ter · La preventa dejó la hoja *(7-ago-2026, v124)*

```
tablero.html  ── apartado_guardar ──┐
              ── apartado_estatus ──┤
                                    ├──►  Supabase · tabla `apartados`
captura_series.html                 │      (la ÚNICA verdad)
  ?apartado=<id>&accion=asignar  ───┤
  ?apartado=<id>&accion=entregar ───┘  apartado_entregar ─► tabla `ventas`
```

**Lo que se midió antes de tocar nada:** el Apps Script NUNCA escribió en
Supabase. `agregarApartado_` hace `appendRow` en la hoja y ya. Los 9 apartados
que había en la tabla eran el volcado manual del 2-ago, congelados ahí.

Eso destapó algo que llevaba dos días pareciendo resuelto: **el trigger
`apartado_cabe` —el que se corrigió el 5-ago para frenar el doble apartado—
nunca se había disparado**, porque vigila una tabla en la que nadie insertaba.
El único freno real contra dos asesores apartando la última pieza seguía siendo
el número del navegador, que es lo que la cadena 6-bis creía haber arreglado.
Una corrección puede quedar perfecta y no servir de nada si el dato entra por
otra puerta.

**Tres estados, y la diferencia importa:**

| | Qué significa | Dónde está el equipo |
|---|---|---|
| `Apartado` | el cliente pagó, no hay pieza física ligada | no ha llegado |
| `Asignado` | tiene serie: esa caja es suya | en bodega |
| `Entregado` | salió con el cliente + venta registrada | con el cliente |

Separar `Asignado` de `Entregado` es lo que permite saber, el día que llega el
embarque, cuánta mercancía está comprometida pero todavía en la tienda. Con un
solo paso ese número no existe.

**El escáner vive en `captura_series.html`, no en el tablero.** Cámara,
BarcodeDetector, el respaldo de html5-qrcode y el OCR para códigos rayados ya
están ahí. El tablero solo enlaza con `?apartado=&accion=&volver=`. Si algún día
alguien copia el lector al tablero, serán dos lectores que mantener y una mala
lectura se arreglará en uno solo.

**La venta la crea la base, no la app** (`apartado_entregar`): registra en
`ventas` y cierra el apartado en la misma transacción. Separarlo dejaría equipos
entregados sin venta si la red se cae entre las dos llamadas — y eso no da
error, da inventario que no baja.

**A quién se le acredita:** al asesor que hizo la preventa (`vendedor`), con
fecha de HOY. Quién entregó físicamente se guarda aparte, en `entregado_por`.
Ojo al comparar con el POS: ahí el ticket se cobró semanas antes, así que estas
piezas caen en meses distintos en un reporte y en el otro. Es esperado, no un
descuadre.

### Las tres cosas que, si se deshacen, no dan error

1. **El candado `__sb` en `aplicarTodo`.** El Apps Script también devuelve
   apartados en `modo=todo`, sacados de la hoja muerta, y llega ~7 s DESPUÉS que
   Supabase. Sin el candado, la respuesta lenta borra de la pantalla el apartado
   que el asesor acaba de guardar, o le devuelve la serie a un equipo entregado.
2. **`cargar_apartados_comisiones` ya no carga apartados.** Hacía
   `DELETE FROM apartados` y reinsertaba desde la hoja. Correr `resincronizar()`
   después del corte habría borrado todas las series y entregas, y habría
   reportado "los seis pasos en verde".
3. **`p_token` en toda escritura.** Es el mismo secreto de tienda que ya
   protegía al Apps Script, movido de puerta. La anon key es pública y por sí
   sola no debe poder escribir.

Las tres las vigila `verificar.py` (regla `preventa`), y las tres reglas se
probaron rompiéndolas a propósito antes de darlas por buenas.

**Índice `apartados_serie_unica`:** una serie no puede estar en dos apartados
vivos. Es el error que se descubre con los dos clientes enfrente.

### Las entregas de preventa NO descuentan stock *(7-ago-2026)*

**Una preventa se cobra en el POS el día que el cliente aparta, no el día que se
lleva el equipo.** Todo lo de abajo sale de ahí, y es la regla que hay que tener
en la cabeza antes de tocar nada de este cruce.

Consecuencia: cuando llega el embarque, el *Informe de Artículos Totales* ya
trae esas piezas **fuera** del On Hand. Se vio así el 7-ago, al subir el informe
con los diez apartados ya ligados:

    100307499 Orange Ocean    On Hand 1  ·  apartados 6
    100307448 Graphite Black  On Hand 1  ·  apartados 2

Seis piezas apartadas de una sola en existencia es imposible: esa es la prueba
de que el On Hand ya venía sin ellas.

Con `apartado_entregar` registrando una venta, `inventario_vivo` las restaba
otra vez. **No daba negativos —hay `greatest(0,…)`— y por eso no se habría visto
como un error: daba CERO.** El tablero habría marcado agotados dos SKU de los
que sí queda una pieza libre.

Por eso `inventario_vivo` excluye las ventas ligadas a un apartado
(`a.venta_id = v.id`). La venta sigue existiendo con su serie, su vendedor y su
fecha: cuenta para comisiones y para el detalle del día. Lo único que no hace es
mover el stock.

**Y `cargar_cortes` tiene que excluir LO MISMO.** Esto es lo que casi se queda
fuera. El corte no se guarda: se despeja como *(total en Supabase − lo que
reporta el GAS)*. Las entregas de preventa **solo existen en Supabase**
—`apartado_entregar` no escribe en la hoja—, así que el corte se inflaría con
ellas y, a partir del informe siguiente, **cada entrega restaría una venta
normal del conteo**: con 3 ventas del día y 6 entregas, `vendido` daría 0 en vez
de 3 y el tablero enseñaría 3 piezas de más.

Eso es peor que el problema original. Enseñar stock que no existe manda a un
asesor a buscar una caja que no está, con el cliente delante.

### Cuatro sitios excluyen las entregas de preventa, y por el mismo motivo

Una entrega **no es una venta de hoy**: el cliente pagó semanas antes y esa
operación ya contó entonces. Todo lo que mida "lo de hoy" tiene que dejarla
fuera, y cada vez que se olvidó uno, apareció un número falso:

| Dónde | Qué pasaba sin el filtro |
|---|---|
| `inventario_vivo` | descontaba una pieza que el POS ya había descontado |
| `cargar_cortes` | el corte se inflaba y restaba ventas normales del conteo |
| `comparar_ventas` | marcaba "no cuadra" cada día, por algo correcto |
| `ventas_hoy` | **hundía el Assurant del día** *(visto en piso el 8-ago)* |

El último se descubrió el mismo día de la primera entrega: sin haber vendido
nada, el tablero marcaba «1 venta sin seguro» y el attach caía a 0 %. Con nueve
apartados pendientes eran nueve golpes gratis a un KPI que se reporta con meta
del 25 %. Y en el otro sentido igual: una entrega con seguro lo habría inflado.

**Si mañana se añade otra lectura que mida el día, este filtro va con ella.**

`verificar.py` (regla `preventa-stock`) cuenta que el filtro esté en los tres
sitios de inventario: `inventario_vivo` y las dos mitades de `cargar_cortes`.
Se probó quitando uno.

**Cómo se comprobó que no rompió nada:** el día del cambio no había ninguna
venta ligada a un apartado, así que el cambio **no podía** alterar un solo
número. Se comparó SKU por SKU antes y después: 227 filas, cero diferencias. Y
luego se confirmó aparte que las dos funciones traían el filtro — porque "cero
diferencias" también es lo que sale si el cambio no se aplicó.

---

## Cadena 6-quater · Las cargas dejan la hoja *(7-ago-2026, v127)*

```
actualizar_datos.html ─ carga_catalogo ──┐
                      ─ carga_promos ────┤
admin.html ─ carga_exhibicion ───────────┼──► Supabase
           ─ carga_catalogo_ref ─────────┤
           ─ carga_comisiones ───────────┘
```

**Esto arregla algo que se sufrió el 7-ago:** subir el Excel escribía en la hoja,
y el tablero lee de Supabase desde la fase 2. Los dos lados solo se juntaban al
correr `resincronizar()` **a mano**, y nadie lo corría. El inventario del tablero
podía llevar días viejo sin que nada lo dijera. Se descubrió porque los 12 SKU de
la Pura 90S no aparecían por ningún lado después de subir el informe.

**Subir el catálogo no es guardar una tabla: es tomar el corte.**
`actualizarCatalogo_` cuenta las ventas por SKU en ese instante y las guarda como
`ventaBaseline`; de ahí sale todo el stock:

    stock = On Hand del informe − (ventas de ahora − ventas al subirlo)

Por eso el corte se toma **dentro de `carga_catalogo`**, en la misma transacción
que escribe el On Hand. En dos llamadas, una venta que entre en medio se contaría
dos veces. La exhibición lleva su **propio** corte, a propósito: es ocasional, no
diaria, y con uno compartido una pieza de piso ya vendida reaparecería con el
informe del día siguiente.

### Lo que se cerró en el mismo movimiento

**`resincronizar()` quedó desactivada.** Traía de la hoja el catálogo, el
inventario, las promos y las comisiones. Con la hoja ya sin recibir cargas,
correrla habría reemplazado los datos buenos por una foto vieja de 227 filas —y
habría dicho "los seis pasos en verde". Es el tercer sitio donde aparece el mismo
patrón, después de los apartados: **una función de sincronización sobrevive al
motivo por el que existía, y entonces destruye en vez de reparar.**

**El stock solo se acepta de Supabase** (`d.__sb` en `aplicarTodo`). El
`modo=todo` del Apps Script también trae inventario, pero de la hoja congelada. Y
un stock viejo no es un dato incompleto: es uno falso, que dice que hay piezas ya
vendidas. Sin stock el tablero avisa; con stock inventado no avisa nadie.

**Los precios SÍ siguen cayendo al Apps Script.** Una promo de hace unos días casi
siempre sigue vigente, y quedarse sin precios deja al asesor sin poder vender. El
dato viejo hace daño en el stock, no en el precio.

**`comisiones.html` pasó a leer de Supabase.** Se habría quedado enseñando el
último reporte subido a la hoja —un mes viejo con aspecto de actual— justo en la
pantalla que el equipo mira para saber cuánto lleva ganado.

### Lo que la base rechaza y la hoja aceptaba

La hoja se tragaba cualquier fila; las tablas tienen candados. Si se les manda
una fila que no cumplen, revientan la carga **entera**:

- `inventario.onhand` no admite negativos → se meten como cero
- `promos.vigente_hasta` es obligatorio, y `precio_pro < precio_reg` es un CHECK
  → esas filas se **apartan y se cuentan**, y la pantalla dice cuántas quedaron
  fuera. Descartarlas en silencio sería peor: una promo que falta es un precio
  que el asesor no le cobra al cliente.

Un archivo que se parseó mal llega como lista vacía. `carga_catalogo` la
**rechaza**: aceptarla borraría el catálogo entero y el gerente vería
"actualizado ✓".

`verificar.py` (regla `cargas`) bloquea que una pantalla vuelva a mandar una
carga al Apps Script, y que el inventario se aplique sin comprobar el origen.

---

## Cadena 7 · Horarios *(desde el 4-ago-2026, v119)*

```
02_Equipo/horario_semanal.html   ← AQUÍ se edita (fuente única)
        │
        ├── push a planeador-odemas  → la copia multi-tienda, para las tiendas
        │                              que aún no tienen tablero propio
        └── copia a 09_Tablero/horarios.html → abre DENTRO de la app del 1217
```

Antes la tarjeta de Horarios salía del tablero a Chrome (`ext:true` + otro repo,
o sea fuera del `scope` de la PWA). Ahora el tablero sirve su propia copia, así
que se abre igual que Tablero o Comisiones.

**El archivo se edita en `02_Equipo`, nunca en `09_Tablero`.** Para publicar los
dos lados de una vez: `02_Equipo\deploy.ps1 "qué cambió"` — hace el push del
planeador, copia al tablero, sube `VERSION` y corre el verificador.

Lo que sostiene esto:
- La regla `copia` de `verificar.py` avisa si las dos dejan de ser idénticas.
  Solo avisa: en GitHub Actions no existe `02_Equipo` con qué comparar, así que
  **el aviso solo aparece cuando corres el verificador en tu máquina.**
- El botón `← Menú` se pinta solo si el archivo se llama `horarios.html`
  (`mostrarVolverAlMenu()`). En `planeador-odemas` no aparece, porque ahí el
  `index.html` es un redirect a este mismo archivo y sería un círculo.
- `logo_huawei.jpg` va precacheado: es el logo del Excel que exporta el gerente.

### Un solo login *(4-ago-2026)*

El planeador tenía su PROPIO proyecto de Supabase (`lgnyqfstmcqpkbekspte`), con
su padrón de cuentas y un PIN aparte: el equipo entraba dos veces. Ya no.
`horarios_config` vive en el proyecto de HES Red, por `store_id`, y el acceso es
el mismo del tablero (`supabase_horarios.sql`).

```
arrancar()
 ├─ ¿sesión de Supabase?           -> gerente/subgerente: edita. RLS = admin_de(store_id)
 ├─ ¿hes_empleado en localStorage? -> horario_equipo(store_id, empno): solo lectura
 └─ nada que heredar               -> login (correo, o número de empleado)
```

- **El PIN del planeador ya no existe.** Para quitarle el acceso a alguien:
  Admin → Equipo → darlo de baja. Antes había que cambiarle el PIN a todos.
- **Quien no esté en `empleados` no ve el horario.** Es la misma puerta del
  tablero; si alguien se queda fuera, hay que darlo de alta.
- **El subgerente ya puede editar** (antes la tabla colgaba de `user_id`, así que
  el horario solo existía para la cuenta que lo creó).
- Se cayó el rodeo de `excepciones.__publicadas` — la foto duplicada que existía
  porque el RPC viejo no devolvía `semanas_guardadas`. Se sigue *leyendo* como
  respaldo, porque los respaldos viejos la traen.
- `guardarConfig` ahora **avisa si la RLS rechaza**. Antes un guardado sin
  permiso se veía exitoso y al recargar no había nada.
- Respaldo: botones **🗄️ Respaldo / ↥ Restaurar** en la barra del gerente. Hasta
  hoy el horario existía solo dentro de Supabase, sin copia en ningún lado.
- La migración desde el proyecto viejo se hizo con
  `HES-ANGELOPOLIS-1217/migrar_horarios.html`, **fuera de los repos** a propósito:
  es lo único que sigue hablando con el proyecto viejo. Se puede borrar después.

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
| 1 · datos y paridad | ✅ cerrada el 4-ago con datos del mismo momento |
| 2 · lecturas | ✅ tablero y captura (v115) · falta admin/comisiones |
| 3 · ventas, doble escritura | ✅ **cada venta va a los dos lados (v115)** |
| 4 · fotos, autollenado, edición | 🔨 en curso · **preventa cerrada (v124)**, ver cadena 6-ter |
| 5 · retirar el Apps Script | — |

**La fase 4 se está haciendo por bloques, no de un salto** *(decidido el
7-ago-2026)*. El primero fue la preventa, porque el embarque de la Pura 90S
llegó y había que ligar series. Lo que falta para que la hoja no haga falta:

| Bloque | Modos que hay que reponer | Estado |
|---|---|---|
| Preventa | `apartado_add/estatus/del` | ✅ v124 |
| EOL | `eol_add`, `eol_del` | ✅ v125 |
| Avisos y combos | `aviso_add/del`, `bundle_add/del/clear` | ✅ v125 |
| Borrar una venta | `tipo:'eliminar'` | ✅ v125 |
| Cargas de Admin | catálogo+inventario, `catalogo_ref`, exhibición, comisiones, promos | ✅ v127 |
| Fotos de venta | Drive → tabla `venta_fotos`, con visor en Ventas del día | ✅ v129 |
| Notificaciones | `notificar_` → OneSignal | ✅ v134 · **probado, llegan** |
| Traspasos | vender con promesa de entrega, sobre la misma tabla | ✅ 8-ago |
| Editar una venta | pantalla en Admin | ❌ **no existe** — es lo que sigue haciendo falta la hoja |

*(Esta tabla dijo «SQL sin aplicar» durante diez días sobre bloques que llevaban
funcionando en piso desde el 7-ago. Se corrigió el 17-ago comprobando el código,
no releyendo el documento. Una tabla de estado que no se actualiza es peor que
no tenerla: manda a rehacer lo hecho y esconde lo que falta de verdad — aquí,
la edición de ventas.)*

La fila de Storage se cayó: las fotos acabaron en la tabla `venta_fotos`, no en
Storage. Se había quedado como pendiente algo que ya se había resuelto por otro
camino.

### El "nudo" de las notificaciones no lo era *(7-ago-2026)*

La REST API key de OneSignal es secreta y no puede ir en el HTML, así que la
respuesta obvia era una Edge Function. Pero **la extensión `http` de Postgres ya
estaba habilitada** —`cargar_catalogo` la usa con `extensions.http_get`—, así que
la llamada se hace desde una función SQL `SECURITY DEFINER`: la llave vive en
`notif_config`, una tabla con RLS y sin políticas (nadie llega por REST), y solo
la lee la función, que corre como dueña. Sin CLI, sin despliegue y sin una pieza
más que mantener.

**Antes de inventar infraestructura, mirar qué hay instalado.**

### Las notificaciones NUNCA habían funcionado — cinco motivos apilados

El 7-ago se descubrió que no había ni un suscriptor. Al tirar del hilo salieron
**cinco fallos encadenados**, y ninguno daba señal por separado:

1. **La plataforma Web nunca se configuró en OneSignal.** La app existía y su
   llave era válida —por eso la API contestaba— pero sin web push activado.
2. **El scope del service worker.** El código pedía `scope: '/'` y el tablero
   vive en `/tablero-hes1217/`. Un SW servido desde un subdirectorio no puede
   reclamar la raíz: el navegador lo rechaza e `init()` falla entero. **Nadie
   pudo suscribirse jamás.**
3. **La campana miraba el dato equivocado:** `Notification.permission` (permiso
   del navegador) en vez de `PushSubscription.optedIn` (suscripción real). Se
   puede tener lo primero sin lo segundo, y entonces decía "ya están activadas".
4. **Pedir permiso no suscribe.** Faltaba el `optIn()` explícito.
5. **`Notification.requestPermission()` en vez del wrapper del SDK.** Con
   `OneSignal.Notifications.requestPermission()` el diálogo no aparecía nunca:
   el permiso se quedaba en `default` y Chrome ni listaba el sitio en sus
   ajustes. Va como primera instrucción del `try`, sin un solo `await` delante:
   los navegadores descartan la petición si el gesto del clic ya se consumió.

Y dos más en el payload, que **también le faltaban al Apps Script** —o sea que
sus notificaciones habrían fallado igual aunque hubiera habido suscriptores—:

- `target_channel: 'push'`, obligatorio con el modelo de usuarios nuevo
- el idioma `en` en `headings`/`contents`, que OneSignal exige como respaldo

**Nada de esto se veía porque `notificarEquipo` descartaba la respuesta con un
`console.warn`.** Siete fallos tapados por un log que nadie lee en un celular.
Lo que destrabó el diagnóstico fue hacer que el mensaje de error dijera el
estado real —permiso, id de suscripción, scopes registrados— en vez de "no se
pudo activar".

**Para diagnosticar sin tocar el teléfono**, se le pregunta a OneSignal:

```sql
-- ¿cuántos dispositivos hay suscritos de verdad?
select (extensions.http(('GET',
  'https://onesignal.com/api/v1/players?app_id=' || c.app_id || '&limit=1',
  array[extensions.http_header('Authorization','Basic ' || c.api_key)],
  null, null)::extensions.http_request)).content::jsonb -> 'total_count'
from public.notif_config c where c.store_id = '1217';
```

Cambiando la URL por `/notifications/<id>?app_id=…` se ve qué pasó con un envío
concreto. **`successful` significa que Google lo aceptó, no que el teléfono lo
mostró** — eso es `received`. Si `successful` es 1 y `received` 0, el problema
está en el dispositivo, no en el sistema.

**Configuración correcta en OneSignal** (verificada contra su API):

    serviceWorker.path              = /tablero-hes1217/
    serviceWorker.workerName        = sw.js
    serviceWorker.registrationScope = /tablero-hes1217/

No hay que subir el `OneSignalSDKWorker.js` que ofrece el asistente: `sw.js` ya
lo carga con `importScripts` en su primera línea. Dos service workers peleando
por el mismo scope es peor que ninguno.

### Y el fallo que destapó cerrar esto

Las escrituras de EOL, avisos, combos y comisiones se movieron a Supabase en
v125 — y **las cuatro listas de Admin siguieron leyendo del Apps Script**, o sea
de la hoja que ya no recibe nada. El gerente agregaba un EOL y la lista seguía
enseñando la de antes; lo borraba y seguía ahí.

Es el mismo error que costó las dos fugas de la fase 2, repetido: **migrar una
escritura sin migrar la lectura que le corresponde.** Estuvo activo desde v125
hasta v130. Ahora lo vigila `verificar.py` (regla `lectura`) en vez de la memoria
de nadie: si Admin escribe algo en Supabase y sigue leyéndolo del GAS, el commit
se detiene.

### Dos fugas que destapó el bloque 2 *(las dos llevaban abiertas desde la fase 2)*

**1 · Borrar una captura no borraba la venta en Supabase.** `eliminarDeNube`
avisaba al Apps Script y a nadie más. Como `inventario_vivo` descuenta de la
tabla `ventas` **de Supabase**, esa pieza seguía descontada para siempre: **el
tablero mostraba menos stock del que había en bodega**, en ese SKU, sin dar
ningún error — solo un producto agotado que sí estaba.

Es el reverso exacto del incidente del 4-ago —una pieza de MÁS por cada venta—
y por la misma causa: leer de un lado lo que se escribe en el otro. La doble
escritura de la fase 3 cerró el alta y **el borrado se quedó fuera**. Al cerrar
media puerta conviene preguntar cuál es la otra media.

Para poder borrar hacía falta saber qué fila borrar, y no se podía: la app
identifica cada captura con su `id` y la tabla no lo guardaba. De ahí la
columna `captura_id`.

**2 · Los avisos de corporativo perdieron su etiqueta.** El tablero pinta un
distintivo azul CEA/LEA (`cardAviso`, l. 1354) leyendo `tipo`. La tabla de
Supabase nunca tuvo esa columna, así que `_deSupabase` ponía `'manual'` fijo y
todos los avisos se veían iguales. Nadie lo reportó porque el aviso se sigue
leyendo — solo pierde la señal de que viene de arriba. Es el tipo de fallo que
no se nota: no rompe nada, solo borra información.

Las dos aparecieron por lo mismo: al migrar una lectura se comprobó que
devolviera **filas**, no que devolviera **los mismos campos**.

El de notificaciones no es traducir código: la API key de OneSignal vive en
Propiedades del script porque es secreta, y la anon key es pública. Pide una
Edge Function. Va al final por eso, no por tamaño.

**Medido en producción, en el mismo aparato y sesión: 257 ms contra 7.011 ms.**
Y con Supabase roto a propósito, el tablero sigue funcionando por el Apps
Script. Ver la cadena 2-bis.

Las trece lecturas dan igual, **incluido `inventario`** (215/215, cero
diferencias) que es la que se verificó contando cajas en piso. La única que
difiere es `estado`, y ahí el que se equivoca es el Apps Script: reporta 141
promos y su propio `modo=promos` devuelve 117 — el contador vive en Propiedades
y se quedó viejo.

**La comparación de paridad caduca.** Se comparó el 4-ago contra datos cargados
el 2-ago: ocho lecturas dieron igual y cinco distinto, y las cinco eran el mismo
desfase —un catálogo nuevo, un On Hand reemplazado, dos días de ventas y un
cambio de mes en comisiones—, no un error de traducción. Estuvo a punto de
parecerlo en la parte más delicada, el inventario.

Por eso existe `resincronizar()`: trae todo de la hoja **en el orden correcto**
y **se detiene si un paso falla**. El orden no es un detalle — `cargar_cortes`
después de `cargar_ventas`, porque el corte se despeja como (total de ventas −
vendido desde el corte) y sin ventas cargadas sale cero, o sea un tablero
enseñando stock cero sobre mercancía que está en bodega.

La primera resincronización paró en el paso 4 y **la parada valió la pena**: al
cambiar la regla de la serie se había roto el `ON CONFLICT` de `cargar_ventas`
(se revisó qué *lee* la restricción y no qué *escribe* contra ella). Sin
detenerse, `cargar_cortes` habría corrido con las ventas a medias y eso no da
error: da cortes en cero, o sea stock cero sobre mercancía que está en bodega.
Arreglado y resincronizado: los seis pasos en verde.

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

Del lado de la nube también quedó cerrado *(4-ago-2026)*. El guardián avisaba por
un canal que no se podía leer —`Logger.log`, que se borra solo a las pocas horas,
así que la única señal de que alguien entraba sin token desaparecía antes de que
nadie la mirara—. Ahora `accesoPermitido_` llama a `contarSinToken_`
(`GAS_Codigo.gs`, l. 922-953), que deja el rastro en **Propiedades del script**:
`SINTOK_HOY`, y `SINTOK_AYER` al pasar la medianoche. Se leen desde Configuración
del proyecto, sin depender de Cloud Logging, y la rotación por día quedó probada.

⚠️ Ojo al leerlo: `SINTOK_HOY` **solo se escribe cuando hay rechazos**, así que
conserva la fecha del último día que sí los tuvo. Si la fecha no es la de hoy, no
hubo llamadas sin token hoy — no es que el contador se haya parado.
