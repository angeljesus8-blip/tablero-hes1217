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
| Apps Script | **Solo LECTURAS de respaldo** (catálogo, promos, eol_venta). Ya no recibe ni una escritura desde el 17-ago | Captura y tablero, como último recurso |
| Supabase | Las 11 tablas. **Fuente única de todo** desde el 17-ago | Todas |

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

## Cadena 2 · Escrituras al Apps Script — **ya no queda ninguna** *(17-ago-2026, v170)*

```
tablero.html      → eol_add                    ✗ migrado (v125)
captura_series    → guardar y eliminar venta   ✗ migrado (v170)  ← el último
admin.html        → comisiones, bundles, avisos, notificar   ✗ migrado (v125/v134)
actualizar_datos  → catalogo, catalogo_ref, exhibicion, promos ✗ migrado (v127)
```

**La hoja quedó de solo lectura, con su histórico hasta el 17-ago-2026.** Nada
depende de ella. Lo que sigue viviendo del Apps Script son lecturas de respaldo
—catálogo, promos, `eol_venta`— y se quedan a propósito: una promo de hace unos
días casi siempre sigue vigente, y quedarse sin precios deja al asesor sin poder
vender. El dato viejo hace daño en el stock, no en el precio.

Lo que sigue vale como historia de cómo se llegó aquí, y porque el candado del
token sigue protegiendo esas lecturas.

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

### Vender la pieza de exhibición de un EOL *(17-ago-2026, v174)*

Hasta aquí, `eol_precio_venta` exigía `stock = 0`: el 50 % solo aparecía cuando
**ya no quedaba nada en bodega**. Un EOL con dos cajas nuevas más la de aparador
se cobraba entero, incluida la de aparador.

Y había una segunda mitad que no se veía. `inventario_vivo` imputaba **toda**
venta a bodega y solo el excedente a exhibición, así que vender la de aparador
teniendo cajas nuevas dejaba esto:

```
bodega       2 cajas intactas   →  el tablero decía 1
exhibición   vacía, ya se fue   →  el tablero decía 1
```

Se equivocaba en los dos sentidos a la vez, sin dar error. Lo de bodega se
corrige solo con el informe del día siguiente; **lo de exhibición no** —la
exhibición se sube de vez en cuando— y es justo el lado que hace que el tablero
ofrezca al 50 % una pieza que ya no está.

**Ahora la venta dice de dónde salió** (`ventas.de_exhibicion`). Las de bodega
descuentan del On Hand; las de aparador, de la exhibición.

⚠️ **Tres cosas que, si se deshacen, no dan error:**

1. **Los cortes se separan.** El de On Hand cuenta solo ventas de bodega y el de
   exhibición solo las del aparador (`corte_tomar_`, usado por las dos cargas de
   `supabase_cargas_admin.sql`). Si el de exhibición contara todas, `exh_marcada`
   quedaría clavado en cero por el `greatest(0,…)` y **el aparador no bajaría
   nunca**: la marca no serviría de nada. Y el de On Hand al revés: contaría de
   más y la siguiente venta de bodega no descontaría stock.
2. **`exh_vendida` suma las marcadas MÁS el excedente sobre el On Hand.** Lo
   segundo es lo que ya hacía el modelo viejo, y se conserva a propósito: sin
   ello, las ventas que se comieron una pieza de piso **antes** de que existiera
   la marca volverían a aparecer como disponibles.
3. **Dos listas separadas en la app.** `EOL_VENTA` (sin bodega → 50 %
   automático) y `EOL_EXHIB` (con bodega → solo si el asesor lo marca). Meterlas
   juntas pondría al 50 % todos los EOL con bodega: regalar producto nuevo, en
   cada venta y en silencio.

#### El aparador seguía marcando la pieza vendida *(v175, el mismo día)*

Visto en piso a la primera prueba: las piezas cerradas no se movieron —lo
delicado funcionó— pero la tarjeta seguía diciendo «1 en exhibición».

`finalizarStock` (l. 1235) hacía `e − max(0, ev − onhand)`: el cliente calculaba
por su cuenta cuántas ventas habían excedido el almacén, porque el servidor solo
mandaba el total. Desde v174 `exh_vendida` YA trae esa cuenta hecha, así que
restarla otra vez la anulaba — con 5 en bodega, `max(0, 1−5)` es 0.

**Cambiar lo que SIGNIFICA un campo obliga a buscar quién lo consume.** El campo
llegaba perfecto; la cuenta que se hacía con él era la vieja. Es el reverso de la
regla del MAPA sobre migrar lecturas: ahí faltaba un campo, aquí sobraba una
resta, y las dos veces el dato se veía bien.

No era cosmético: `estadoSku` decide con `exhibe` si ofrece la última pieza al
50 %, así que un aparador que no baja manda al asesor a buscar una caja que ya
se llevó otro cliente. Lo cubre el caso 9 de `casos_tablero.js`, con los números
reales del WATCH FIT 4 y comprobado devolviendo la resta vieja.

**El interruptor se apaga solo** al guardar y al teclear un SKU sin
coincidencia. Dejarlo encendido cobraría la mitad en la venta siguiente, y eso
no lo caza nadie hasta el corte — para entonces ya se fue el cliente.

**`venta_editar` NO puede cambiar la procedencia**, a propósito: moverla de
bodega a aparador exige mover la unidad en los dos cortes, igual que con el SKU.
Sin ese ajuste descuadraría el stock en silencio. Para corregir una marcada mal:
borrar la captura y rehacerla, que la app deshace las dos cosas bien.

Lo cubren los bloques 5 y 6 de `pruebas/cola_ventas.js` —que la marca llegue al
cuerpo que va a Supabase, y que una venta normal salga explícitamente como **no**
de exhibición—, comprobados rompiendo el paso del dato.

### Los apartados cobrados hoy salen en «Ventas del día» *(17-ago-2026, v182)*

**Esto cerró un descuadre que ya existía.** `ventas_hoy` —el Assurant del día—
cuenta los apartados pagados hoy desde el 8-ago: un apartado es una venta
cobrada aunque el equipo no exista todavía. Pero `ventas_detalle` no los
enseñaba, así que el día que se cobraba uno, **el porcentaje subía y las filas
de abajo no lo explicaban**. Es lo mismo que se arregló con el attach manual: la
suma de las filas tiene que dar el total y poder comprobarse de un vistazo.

`ventas_detalle` devuelve ahora `clase`, y son tres cosas distintas:

| clase | qué es | ¿cuenta hoy? | serie |
|---|---|---|---|
| `venta` | capturada en la app | sí | sí |
| `entrega` | equipo que sale de un apartado viejo | **no** | sí |
| `cobro` | apartado pagado hoy | **sí** | todavía no |

Los cancelados no salen — mismo criterio que `ventas_hoy`, para que las dos
cuenten lo mismo. Si una se toca, se toca la otra.

**Un cobro no tiene equipo, y eso se dice en tres sitios**: la fila pone «sin
equipo todavía» en vez de dejar el hueco, tocarla avisa en lugar de copiar una
cadena vacía al portapapeles, y el contador de arriba los separa —«3 equipos ·
1 cobro»—, porque sumarlos daría un número que no es ni lo entregado ni lo
cobrado.

Tampoco traen `captura_id`, así que la app no les ofrece el ✏️ ni el borrado. Es
lo correcto: un apartado se corrige desde Preventa.

Para comprobar que la lista y el KPI siguen cuadrando está el punto 1-bis de
`supabase_ventas_detalle_entrega.sql`.

### Accesorios · el SKU genérico 43739 *(18-ago-2026, v183)*

Cargadores, micas y kits se venden con el SKU `000043739` y **no pasan por
Captura de Series**, que es para equipos con número de serie. Su reporte mensual
de comisiones se llenaba desde fotos del POS: en julio, **24 de ~85 tickets
(28 %) no se pudieron resolver desde la foto** y acabaron en una lista para
abrirlos uno por uno.

⚠️ **`accesorios_ventas` es tabla propia, y no es un capricho.** En `ventas`
rompería dos cosas sin dar error: `inventario_vivo` descuenta stock POR SKU —y
el 43739 no existe en el catálogo— y `ventas_hoy` calcula el Assurant contando
ventas, así que cada cargador hundiría el KPI que se reporta con meta del 25 %.

**De dónde sale cada dato, medido sobre tickets reales:**

| dato | fuente | por qué |
|---|---|---|
| ticket · fecha · vendedor | OCR | se leyeron exactos |
| precio y cantidad | OCR de **la línea del 43739** | el total no sirve: un ticket de $16,962.50 llevaba un kit de $169 |
| **producto** | **lista que toca el asesor** | el OCR devolvió `CARGATOOWTS`, y en un ticket de 8 artículos agarró el IMEI del MatePad |

**El vendedor es «Atendido por», NO el número del final del ticket** — ese es
quien cobró en caja. En el 33480 el número decía <empno> (Ángel) y había
atendido Maria. La comisión es de quien vendió, y el campo fácil de leer es el
equivocado.

**Tres cosas que, si se deshacen, no dan error:**

1. **El precio unitario lleva TRES decimales:** `999.000` son 999 pesos. Leerlo
   como separador de miles daba $999,000, la comprobación no cerraba nunca y la
   app habría mandado a revisar el 100 % de las líneas — hasta que alguien se
   cansara y las diera por buenas. El importe, en cambio, lleva dos decimales y
   coma de miles. Formatos distintos, funciones distintas.
2. **`precio × cantidad = importe`** es la red. Y dice **en qué línea** falla,
   que es lo que la verificación por subtotales del reporte nunca pudo decir.
3. **El OCR corre EN PARALELO** mientras el asesor elige el producto. Son ~9 s
   medidos en el celular; al revés serían nueve segundos mirando una barra con
   el cliente delante.

`UNIQUE (store_id, ticket, producto)` frena la doble captura — dos asesores
registrando el mismo ticket al cerrar el día.

#### El reporte al Excel regional *(18-ago-2026, v188)*

`Registro_Ventas_MrFix_Odemas_2026.xlsx` en SharePoint, 128 hojas (tienda ×
mes). La de este mes es **`1217 AGOS 26`** — agosto va abreviado, y confundirlo
es pegar en la hoja de otro mes.

**La hoja está protegida y solo 7 columnas se pueden escribir**, leído del
archivo y no supuesto:

```
B día · D ticket · E SKU · F producto · G cantidad · H precio · N empleado
     C, I, J, K, L, M  →  fórmulas (tienda, sin IVA, total, comisión, PUESTO)
```

Por eso son **tres pegados** —B, luego D:H, luego N— y no uno: un bloque
contiguo B:N chocaría con la protección. Los datos empiezan en la **fila 6**.

⚠️ **El nombre tiene que coincidir letra por letra.** La columna M no se
escribe: la deduce un `INDEX/MATCH` que busca el nombre en la lista del equipo.
Si no coincide, **el puesto sale vacío y esa comisión no se suma a nadie**, sin
dar error. Y no coincide sola: en el Excel van apellidos primero, en mayúsculas
y sin acentos, y uno está escrito distinto —`Fuentes Bravo` en la app,
`Fuentes Bravo` en el Excel—. De ahí `empleados.nombre_reporte`, mapeado
**explícito por número de empleado**: una regla automática acertaría hoy y
fallaría con el primer apellido compuesto, un mes después.

`accesorios_reporte` marca con `sin_nombre` las ventas cuyo vendedor no tiene
ese mapeo, y la pantalla las enseña en rojo en vez de esconderlas.

**Se baja un .xlsx aparte y se pega en el archivo regional**, nunca se
sobreescribe: ese archivo lo comparten diez tiendas y reemplazarlo pisaría el
trabajo de las demás. El .xlsx que genera la app trae las columnas **en la
misma posición** que el regional, para que el pegado caiga donde debe.

#### Mantener el catálogo sin escribir SQL *(20-ago-2026, v198)*

Los 23 productos se sembraron a mano, y Mr Fix mete producto cada temporada.
Ahora se editan en **Admin → 📦 Catálogo**, al final de la pestaña.

**Estuvo unas horas en Captura**, junto al Excel del mes, con este argumento: el
momento en que se descubre que falta un producto es *capturando un ticket*, y
mandar al gerente a otra pantalla y de vuelta es fricción justo cuando hay un
cliente delante. Pesó más el argumento contrario, de Ángel: **quien no se
acuerda de dónde estaba lo busca donde están todos los catálogos**, y nadie va a
Captura de Series a mantener una lista. La fricción se paga una vez por producto;
no encontrar la pantalla se paga cada vez.

Lo que queda de aquello es una línea en el panel de Captura, debajo del selector
de producto, que dice dónde se agregan. **Se ve siempre, también para el asesor**:
si el producto no está, la venta no se puede capturar, y quedarse mirando la
lista sin saber qué hacer es peor que no poder agregarlo uno mismo.

El permiso lo comprueba el servidor con `puede_gestionar_` —gerente y
subgerente—, igual que el ✏️ de corregir. Admin ya exige `puede_admin` para
abrirse, así que son dos puertas distintas: **entrar a Admin no da derecho a
tocar este catálogo**, y hoy coinciden solo porque los dos que tienen Admin son
el gerente y el subgerente.

⚠️ **Había una versión rota de esto en el servidor, sin usar.**
`accesorio_catalogo_guardar` se escribió el 18-ago, **el día antes** de que el
catálogo tuviera `articulo` y `sku`, y solo guardaba (nombre, precio, orden).
Nunca se llamó desde ninguna pantalla, así que el fallo no llegó a pasar; pero
ponerle un botón encima lo habría activado. Un producto dado de alta con ella:

- **sin `articulo`** — `accAdivinar` se salta las filas sin código, así que ese
  producto **no se propondría nunca** al leer un ticket. Parecería que el OCR
  empeoró, sin nada que lo ligue al alta.
- **con `sku` 43739 por omisión** — cierto para micas y cargadores, falso para
  los Office (63602 y 57518), que van al reporte con **su** código. La columna E
  del Excel saldría mal en cada venta de ese producto.

Ninguna de las dos da error. Por eso se rehízo la función entera
(`supabase_accesorios_catalogo.sql`) en vez de llamar a la que había, y por eso
`pruebas/catalogo_accesorios.js` comprueba que el alta manda los dos campos.

**Dos avisos que no bloquean**, porque los dos casos son legítimos y aun así
degradan la captura:

- **Código parecido.** `accAdivinar` gana por prefijo más largo y **calla si hay
  empate**. Dar de alta `43739-MICAHRPLUS` teniendo `43739-MICAHR` hace que, al
  capturar una MICA HR normal, empaten en seis letras y no se proponga ninguna.
- **Precio repetido.** La lista se ordena por precio y se marca sola cuando solo
  hay un producto a ese precio. MICA HR y MICA MATTE cuestan las dos $149 y por
  eso ninguna se marca: son los 19 tickets que en julio hubo que abrir uno a uno.

⚠️ **La regla de los códigos vive en `acc_codigos.js`, no en cada página.**
`ACC_OCR`, `accClave`, `accPrefijo` y `accChoca` estaban dentro de
`captura_series.html`; al mover el editor a Admin habrían quedado **dos copias**
de la misma idea en dos archivos. Y esa copia falla en silencio: el aviso de
Admin daría por bueno un código que la adivinanza de Captura va a empatar, y se
vería meses después como un producto que «dejó de proponerse solo».

Eso trajo una dependencia nueva entre archivos, que también falla mal: un
`<script src>` que no llega **no rompe la página al abrirla**, rompe la primera
función que use lo que traía —aquí, al teclear un código—. Por eso
`verificar.py` comprueba ahora que todo `./x.js` que carga una página exista
**y esté en `ARCHIVOS` de `sw.js`**: si falta lo segundo, funciona con red y
falla sin ella, que es el peor de los dos mundos porque pasa las pruebas.

**Renombrar no arrastra el histórico** — las ventas guardan el nombre del
producto como texto. No se impide, porque a veces hay que corregir una falta;
la ficha enseña **cuántas ventas** llevan ese nombre antes de tocarlo.

**Dar de baja nunca borra.** Además de conservar el histórico, así vuelve a
activarse sin volver a teclearlo cuando el producto regresa.

Al cerrar el panel se vacía `_accCat` para que el catálogo de capturar se vuelva
a pedir: sin eso, quien acaba de dar de alta un producto no lo vería en la lista
hasta recargar la app, y lo daría de alta otra vez.

#### La clave del técnico la pone el gerente *(24-ago-2026, v206)*

Hasta hoy la clave la inventaba el alta y el gerente solo podía **copiarla**. Una
clave que nadie elige acaba apuntada en un papel pegado al mostrador, y no había
forma de cambiarla cuando un técnico dejaba de venir.

Ahora, en **Admin → 👥 Equipo → Técnicos externos**, cada técnico tiene un botón
**`clave`**. La anterior deja de servir en el acto.

**Esto cierra además el agujero que quedaba abierto**: las dos claves estaban
**sembradas en `supabase_tecnicos.sql`**, en un repo público que sirve la app por
GitHub Pages. Cualquiera que diera con el repositorio las tenía, y cada push las
volvía a publicar. Con ellas se entra a ver las ventas de la tienda y las fotos
de los tickets. La siembra se retiró: los técnicos se dan de alta desde Admin y
ninguna clave vuelve a pasar por el repo. Mismo motivo por el que se borró
`comisiones_datos.js` el 1-ago.

⚠️ **El mínimo son 8 caracteres y no un PIN de 4**, y no es celo: esa pantalla
está **abierta en internet**, sin sesión ni segundo factor, así que cualquiera
puede probar claves contra ella. 10.000 combinaciones se agotan en un rato. Se
rechazan también las que son solo dígitos —un número de 8 cifras se prueba
entero—, las que llevan espacios, las obvias, y las repetidas entre técnicos:
dos con la misma clave hacen imposible saber quién entró, que es justo para lo
que sirve `ultimo_acceso`.

**Las reglas las pone el servidor, no la pantalla.** Admin comprueba la longitud
solo para no hacer ir y volver; si esa comprobación se borrara,
`tecnico_clave_poner` seguiría rechazando la clave. Al revés —fiarlo al
navegador— cualquiera con la consola abierta se salta el mínimo.

#### Una función definida en dos archivos *(el mismo día)*

Al ir a pedir que se repegara `supabase_tecnicos.sql` se vio que
**`accesorios_tecnico_foto` estaba definida dos veces**: allí en su versión
original —solo accesorios— y en `supabase_reparaciones.sql` ampliada para servir
también los tickets de reparación.

**No da error: gana la última que se pegue.** Repegar el primero por un motivo
completamente ajeno —dar de alta un técnico, cambiar una clave— habría devuelto
la versión vieja y roto las fotos de las reparaciones, sin tocar nada
relacionado. La función se quitó de `supabase_tecnicos.sql`, y **sus permisos se
fueron con ella**: un `GRANT` sobre algo que ese archivo ya no crea mata el
pegado en una base donde el otro archivo no esté todavía.

Lo avisa **`r_funcion_repetida`**, y es **aviso y no falla** a propósito: en este
repo redefinir una función en un archivo posterior *es* el mecanismo de
migración —`ventas_detalle`, `inventario_vivo` y `apartados_lista` viven así
desde hace meses—, y bloquear el commit obligaría a limpiar todo eso de golpe.
Solo habla de los archivos que se tocan en ese commit, que es cuando la pregunta
sale barata.

#### El pegado que murió con 42P13 *(24-ago-2026)*

Añadirle `captura_id` y `tiene_foto` a `accesorios_reporte` pasó todas las
reglas, se dio por bueno, y el error salió **en el SQL Editor** con el pegado a
medias:

```
42P13: cannot change return type of existing function
```

`CREATE OR REPLACE` **no puede cambiar el tipo de retorno**. Hace falta un
`DROP FUNCTION` delante, y ahora lo lleva.

Es de los pocos fallos que no se pueden ver leyendo el archivo, porque dependen
de lo que **ya hay en el servidor**. Pero sí se puede ver que el `RETURNS TABLE`
cambió respecto al último commit, y eso basta: lo vigila **`r_returns_table_drop`**.

⚠️ **El `DROP` se lleva los GRANT por delante**, así que la regla exige también
que el archivo vuelva a darlos. Una función sin `GRANT` existe pero no la puede
llamar nadie, y la pantalla lo enseña como falta de permiso — que es exactamente
el fallo de v199, tres días antes.

**Esa regla falló dos veces antes de servir, y las dos en silencio:**

1. **`git show` con `text=True`** decodifica en cp1252 en Windows y revienta con
   el primer acento del archivo. `stdout` llegaba vacío, la regla comparaba
   contra nada, no veía ningún cambio y **daba permiso**. Peor: un parche previo
   —`r.stdout or ''`— había convertido ese error ruidoso en el silencio. Ahora va
   con `encoding='utf-8'` explícito.
2. **El extractor de columnas** era `^\s*(\w+)\s+\w`, heredado de
   `r_contrato_sql`, que coge solo el primero de **cada línea**. Con
   `dia integer, ticket text` en un renglón veía `dia` y se perdía `ticket`. Para
   un aviso que enseña una muestra da igual; aquí se comparan dos listas, y **una
   columna añadida al final de una línea que ya existía no cambiaba nada** — el
   caso exacto que la regla venía a cazar. Ahora parte por comas de nivel
   superior, respetando los paréntesis de `numeric(12,2)`.

**Una regla que calla por no saber leer el archivo es peor que no tenerla**,
porque además da permiso. Las dos veces se vio probándola contra el fallo real;
ninguna se habría visto leyéndola.

#### La vista del gerente *(24-ago-2026, v204)*

Hasta hoy, sobre la misma venta de accesorio, **el técnico externo de Mr Fix podía
abrir la foto del ticket y el gerente no**. Y con las reparaciones pasaba entero:
el asesor las capturaba, el técnico las consultaba, y el único sin pantalla era el
dueño de la tienda.

**Dos piezas, en dos sitios distintos, y la separación es deliberada:**

| qué | dónde | por qué ahí |
|---|---|---|
| Ticket de un accesorio | Captura → 🔧 Mr Fix → 📊 Reporte del mes | Es la lista que ya estaba; solo le faltaba el botón |
| Reparaciones del mes | **Admin → 👥 Equipo** | Captura es la pantalla que baja el Excel |

⚠️ **Las reparaciones NO se ven desde Captura de Series, y no es un descuido.**
Esa es la pantalla que arma el pegado del Excel regional, y las reparaciones no
van a ese Excel. Que no pueda *ni leerlas* es lo que lo garantiza —lo vigila
`r_reparaciones_fuera`—, y ponerlas ahí «para tenerlo todo junto» sería deshacer
la garantía por comodidad. Revisar el mes es además trabajo de gestión, no de
piso con un cliente delante.

**El botón del ticket sale solo cuando hay foto.** `accesorios_reporte` devuelve
ahora `captura_id` y `tiene_foto`, **al final** del `RETURNS TABLE`: el generador
del Excel mapea por nombre de campo y no por posición, así que no se mueve ni una
columna del pegado. Un botón que a veces abre y a veces dice «no hay» enseña a no
fiarse de él, y entonces deja de usarse también cuando sí está.

**`reparaciones_lista` es una función aparte de la del técnico, no la misma con
dos porteros.** El técnico entra con su clave y el gerente con el token de la
tienda; meter las dos credenciales en un solo `IF ... OR ...` hace que aflojar el
portero para uno se lo afloje al otro sin que se vea. Esta **sí puede ser
`STABLE`** —`escritura_ok_` solo lee—, al revés que la del técnico, donde
`tecnico_ok_` sella el último acceso.

El gerente ve además **`capturado_por`**, que el técnico no: a él le toca su
dinero, no quién de la tienda tecleó el ticket.

En Admin, `p_token` va **explícito** en la llamada: `sbLeer` no lo manda solo
—solo lo hace `sbEscribir`—, que es exactamente el fallo de v199 con el catálogo.
Y la foto va por `sbEscribir` aunque sea una lectura, porque necesita el token y
devuelve un objeto en vez de filas.

Un mes sin reparaciones **es un resultado normal** y se dice nombrando el mes, al
revés que el catálogo, que nunca está vacío de verdad y donde cero siempre es un
problema.

#### La coma no siempre es de miles *(24-ago-2026, v221)*

Quinta foto, del mismo accesorio que la cuarta, y **dos fallos que ninguna otra
tenía**:

```
000943739 1 999,000 $999,00 1 =
```

**1 · El importe `$999,00` viene con coma DECIMAL.** El ticket lo imprime
`$1,124.39` —coma de miles, punto decimal—, así que el conversor borraba las
comas sin mirar: `999,00` se convertía en **99900**, cien veces más, y la cuenta
no cerraba nunca.

La regla nueva sale del propio número, no de suponer un formato: si trae **punto
y coma**, la coma es de miles; si solo trae coma y detrás quedan **1 o 2**
dígitos, es decimal; si quedan **3**, es de miles.

**2 · El SKU `000043739` salió `000943739`** — un 4 leído como 9. Los accesorios
se comparaban **por prefijo exacto** mientras las reparaciones ya toleraban un
dígito. Ahora los dos usan la misma tolerancia.

⚠️ **Y quitar los ceros de delante lo empeoraba.** El fallo cayó justo en esa
zona: al recortar ceros quedaban `43739` y `943739`, de distinto largo, así que
ni siquiera se comparaban. Ahora los códigos se alinean **por la derecha
rellenando ceros**, que es lo que de verdad los hace comparables — `000043739`
contra `000943739` es un dígito de diferencia, ni más ni menos.

#### Cinco fotos, cinco fallos que no se repiten

| foto | qué hizo el OCR |
|---|---|
| 1 | Ruido del borde (`N`, `NN`) y rayas entre columnas |
| 2 | Un dígito del SKU mal leído · el punto del precio perdido |
| 3 | La cantidad mudada al renglón de arriba |
| 4 | El importe mal leído (`$993.00` por `$999.00`) · mes cero en la fecha |
| 5 | Un dígito del SKU mal leído en la zona de los ceros · coma decimal |

**Ninguno se parece al anterior**, y ninguno se deduce mirando el papel. Los
cinco textos crudos están en `pruebas/`, y son lo que convierte «a veces no lee
el precio» en cinco fallos concretos, cada uno con su arreglo y su comprobación.

#### El ticket se desmiente a sí mismo *(24-ago-2026, v220)*

Cuarto ticket, el primero de **accesorio**, y dos fallos más del OCR:

```
000043739 1 999.000 $993.00 1
...
MM — Total 999.00
Recuento de artículos vendidos = 1
```

El importe `$999.00` se leyó **`$993.00`**, así que `precio × cantidad = importe`
no cerraba y el aviso mandaba a revisar **una venta que estaba bien**. La app
hacía lo correcto —desconfiar— pero se dejaba en la mesa lo que el propio papel
dice **dos veces**: el total y el recuento.

Ahora, cuando la cuenta no cierra, el **`Total`** desempata. Se corrige solo el
que no cuadra con él: si `precio × cantidad` da el total, el mal leído era el
importe; si el importe da el total, era el precio. Si ninguno cuadra, **no se
toca nada** y el aviso sigue mandando a mirarlo.

⚠️ **SOLO CON UN ARTÍCULO**, y esa cautela vale más que la corrección. El total
del ticket **no dice nada de una línea** cuando hay varias: un ticket de ocho
artículos por $16,962.50 llevaba un kit de limpieza de $169. Corregir ahí
guardaría dieciséis mil pesos como precio del kit, y en el reporte de comisiones
eso no es un aviso — **es dinero**. Se comprueba con el `Recuento` del propio
ticket, y si no está, contando las líneas encontradas.

La prueba lleva el mismo ticket con **dos artículos** y verifica que entonces
**no** se corrige. Comprobado quitando el guardarraíl: pasa a corregir, que es
exactamente lo que no debe hacer.

**La fecha de este ticket salió `23/0/26`** — mes cero. Se rechaza y se avisa,
como desde v213: es una fecha imposible, y ponerla sería peor que dejar la que
había.

#### La cantidad se muda de línea *(24-ago-2026, v219)*

Tercer ticket, tercer fallo distinto del OCR. La cantidad **no estaba en la
línea del artículo**:

```
REP FUERA DE GARANTÍA HW 1 1
100175537 877.270 $877.27 | y
```

El `1` se fue al renglón del nombre. El patrón exigía cuatro columnas en el
mismo renglón, así que no encontraba la línea: **ni SKU ni precio**.

Ahora la cantidad va en un grupo opcional y, si falta, **es 1** — lo que vale
cuando el ticket no dice otra cosa. Se sigue comprobando con
`precio × cantidad = importe`, así que una cantidad supuesta que no cuadre
aparece en el aviso en vez de colarse.

El motor de expresiones resuelve bien la ambigüedad por sí solo: en
`877.270` no puede tomar `877` como cantidad, porque detrás viene un punto y no
un separador.

⚠️ **Y por eso el `$` del importe pasa a ser OBLIGATORIO.** Con la cantidad
opcional el patrón se afloja lo bastante como para que la línea del pie —
`1217 2 23/8/26 1:54 PM 33673`, que está en **todos** los tickets — case como si
fuera un artículo: SKU 1217, precio 2, importe 23. Eso convertiría cualquier
reparación en un ticket «mixto», que es de los que no se deciden solos.

Comprobado quitando el `$`: **los tres tickets dejan de detectarse**. Es de los
cambios que parecen inofensivos y rompen todo lo demás.

#### Tres fotos, tres fallos que nadie habría adivinado

| ticket | qué hizo el OCR |
|---|---|
| 1 | Ruido del borde (`N`, `NN`) al principio de línea, y rayas entre columnas |
| 2 | Un dígito del SKU mal leído, y el punto del precio perdido |
| 3 | La cantidad mudada al renglón de arriba |

Los tres textos crudos están guardados en `pruebas/`. **Ninguno de los tres
fallos se parece a los otros**, y ninguno se deduce mirando el papel — que es
exactamente por lo que los primeros intentos, escritos contra el ticket «como se
ve», pasaban sus pruebas mientras la app fallaba en la tienda.

#### El OCR no falla igual dos veces *(24-ago-2026, v218)*

Segunda foto **del mismo ticket**, y dos fallos que la primera no tenía. La
línea salió así:

```
(Ei 100175540 1 1124390 $1,124.39 1 0)
```

| lo que pasó | consecuencia |
|---|---|
| El SKU `100175545` se leyó `100175540` — el último 5 por un 0 | No reconocía la reparación: se habría capturado como **accesorio**, o sea al Excel de comisiones |
| El precio `1124.390` perdió el punto → `1124390` | El precio salía mil veces mayor y la cuenta del ticket no cerraba nunca |

**El punto del precio se corrige contra el IMPORTE**, que se lee aparte y con
otro formato (`$1,124.39`, dos decimales y coma de miles). Solo se divide entre
mil **si así cuadra**: es una comprobación, no una suposición. Dividir «por si
acaso» sería inventarse un precio que nadie escribió.

**El SKU admite un dígito de diferencia**, y solo con la misma longitud. Pedir el
código entero perfecto es pedirle al OCR que no falle nunca, y falla. Es seguro
porque los códigos en juego no se parecen: los dos de reparación tienen **nueve
dígitos y difieren en dos**, y los de accesorio tienen cinco — un dígito mal
leído no puede convertir uno en otro.

⚠️ **Si un código queda a un dígito de DOS de la lista, no se elige ninguno.**
Ahí ya no se sabe cuál era, y decidir con esa duda es peor que preguntar.
Comprobado subiendo la tolerancia a tres: los dos códigos se vuelven
indistinguibles y la detección deja de decidir, que es lo que debe hacer.

Cuando el código no se leyó limpio **se dice**: «lo cobra con el código
100175545 (el OCR lo leyó con un dígito distinto — compruébalo)».

Y la misma tolerancia se usa en los **dos** sitios que miran el SKU. Si uno
comparara exacto y el otro no, se detectaría el tipo bien y el importe saldría
vacío — dos piezas contradiciéndose sobre el mismo ticket.

⚠️ **Se guardan las DOS lecturas del mismo papel** (`ocr_ticket_real.txt` y
`ocr_ticket_real2.txt`). Es lo que obliga al código a aguantar un OCR que falla
**distinto cada vez**, en vez de a acertar con una foto concreta. Una sola
lectura habría dejado pasar los dos fallos de hoy.

#### Borré tres funciones y nada lo dijo *(24-ago-2026, v217)*

`accVerCrudo`, `accBotonCrudo` y `accAvisoFecha` **se borraron sin querer en
v215**, al reemplazar un bloque de código, y siguieron llamándose. Al leer un
ticket la excepción caía en el `catch` del OCR, así que se veía como **«no se
pudo leer el ticket»** y no como lo que era. Pasó el verificador y se publicó
**dos veces**.

⚠️ **`r_helpers` existía justo para esto y no lo vio.** Vigila una lista fija de
**trece nombres**, escrita hace meses: ninguna función creada después estaba
cubierta. Ampliarla a mano deja el mismo agujero para la siguiente.

Ahora, además, **compara con el commit anterior**: lo que ayer existía, hoy no, y
se sigue llamando, está roto seguro. Eso no necesita lista ni mantenimiento. No
caza una función que nunca existió —para eso sigue estando `propios`— pero sí el
caso de hoy, que es borrar algo que estaba.

#### Quién atendió, y por qué no se rellenaba

El nombre se buscaba **entero** dentro de la lista del equipo. El ticket lo
escribe al revés —apellidos primero— y el OCR le pega ruido al final, así que
bastaba una letra de más para no casar con nadie.

Ahora se compara **por palabras**: gana quien comparta más, con **dos como
mínimo y sin empate**. Dos y no una porque un solo apellido puede ser de dos
personas del equipo; y con empate no se elige, porque poner el nombre equivocado
en un accesorio **le da la comisión a otro** sin dar error en ningún sitio.

Y se dice cuál de los **tres casos** ocurrió, porque cada uno se arregla distinto:
no se leyó (repetir la foto), se leyó y no coincide con nadie (falta esa persona
en Admin → Equipo), o casó (solo comprobarlo). Un campo vacío los confunde los
tres.

⚠️ **Datos personales fuera del repo.** El ticket guardado traía el nombre
completo de un empleado, el número de cuenta y el de autorización. `r_personales`
lo cazó al aparecer en un comentario del código. El texto se conserva entero
—que es lo que lo hace útil— pero con nombre ficticio y esos números tapados:
este repo es público.

#### Ni fecha ni quién atendió, en una reparación *(24-ago-2026, v216)*

Con el SKU y el importe ya leídos, faltaban dos campos. Dos causas distintas, y
ninguna estaba en la lectura: `accExtraer` sacaba los dos bien del texto crudo.

**1 · «Lo atendió» se rellenaba después del corte de reparación.** Ese campo
pasó a ser **del ticket** en v207 —una persona atiende la compra entera— pero el
código que lo rellena se quedó donde estaba, en la parte del accesorio. En una
reparación se salía antes de llegar, y el campo quedaba vacío **con el nombre
impreso en el papel**. Ahora va antes del corte.

No se guarda en la reparación, que no comisiona a nadie, pero **sí se enseña**:
si el ticket dice otro nombre del que está puesto, eso se ve.

**2 · La fecha colgaba del literal `1217`.** `accExtraer` la saca de la línea del
pie —`1217 2 23/8/26 11:44 AM 33671`— y basta que el OCR lea mal **un dígito de
ese 1217** para perder la fecha entera. El número de ticket ya tenía respaldo
desde el 18-ago; la fecha no.

⚠️ Y perderla no deja el campo en blanco: deja **la fecha de hoy**. En un corte
**mensual**, un ticket de fin de mes se va al mes siguiente sin que nada avise.
Ahora hay respaldo que busca la fecha por su cuenta. Los centavos en letra
—`39/100 MXN`— no se cuelan: hacen falta los tres grupos separados por barra.

Las dos comprobadas rompiéndolas, y la de la fecha con el ancla estropeada a
propósito (`T2I7`), que es como falla de verdad.

#### El texto del OCR no se parece al ticket *(24-ago-2026, v215)*

Tres intentos de arreglar esto fallaron, y los tres por lo mismo: **el patrón se
escribió mirando el ticket de papel, no lo que el OCR devuelve**. Esta es la
línea, impresa:

```
100175545      1      1124.390   $1,124.39  I
```

y esto es lo que sale del OCR:

```
N 100175545 1 — 1124.390 $1,124.39 1 RU
```

| lo que se suponía | lo que pasa de verdad |
|---|---|
| La línea empieza por el número | Empieza por `N` — el **borde del papel** se lee como `N`, `NN`, `ON`… en casi todas las líneas |
| Las columnas van separadas por espacios | El OCR mete **rayas** (`—`, `–`) donde el papel solo tiene separación |

Se toleran hasta 12 caracteres no numéricos por delante, y raya larga o barra
como separador. **El guion normal `-` NO**: aparece en los teléfonos y las
fechas del propio ticket, y admitirlo lo convertiría en separador de columnas
en todas partes.

⚠️ **El texto crudo está guardado en `pruebas/ocr_ticket_real.txt`** y es el caso
principal de `mrfix_detecta.js`. No es el ticket transcrito a mano: es la salida
literal de Tesseract, con su ruido.

**Esa es la diferencia entre las tres versiones que fallaron y esta.** Las tres
pasaban sus pruebas — porque las pruebas también estaban escritas contra el
ticket *como se ve*. Un ticket transcrito por quien escribe el código confirma
lo que ese código ya supone; **el crudo es el único que puede desmentirlo**.

Comprobado devolviendo el patrón anterior: la prueba falla diciendo que no
reconoce la reparación.

De ahí también el botón **«ver lo que leí en el ticket»** de v214: sin poder
mirar ese texto, «no lee el precio» no es un dato, es una queja — y se arregla a
ciegas, tres veces.

#### Poder ver lo que leyó el OCR *(24-ago-2026, v214)*

El SKU y el precio no se leían y **no había forma de saber por qué**: lo único
visible era el resultado de intentar interpretar el texto, nunca el texto. Se
arregló dos veces a ciegas —adivinando el formato del ticket— y las dos veces
mal: primero leyendo el campo `SERVICIO:`, luego suponiendo cómo separa las
columnas el OCR.

Ahora los dos avisos traen **«ver lo que leí en el ticket»**, que despliega el
texto tal cual sale del OCR.

No es un modo de depuración escondido. Cuando esto falla, lo que ve el asesor es
un campo vacío, y con el texto delante se distingue entre **tres arreglos
distintos**: foto mal tomada, impresora que imprime otra cosa, o código que
interpreta mal. Sin él, «no lee el precio» no es un dato: es una queja.

#### Ni fecha ni importe en una reparación *(24-ago-2026, v213)*

Detectado el tipo, la captura seguía coja: el asesor tenía que teclear el
importe y la fecha a mano. Dos fallos distintos, los dos en el mismo ticket.

**1 · `accExtraer` buscaba literalmente la línea del `43739`.** Una reparación se
cobra con `100175537` / `100175545`, así que no encontraba nada y devolvía
cantidad, precio e importe **vacíos** — sin decir por qué. Ahora lee **la línea
del artículo sea cual sea su SKU**: coge la de la reparación si la hay y si no la
del accesorio.

`accSkusDeLineas` pasa a apoyarse en esa misma función. Con dos copias del mismo
patrón, un día dirían cosas distintas del mismo ticket — y aquí eso sería
**decidir qué es una venta con unos números y cobrarla con otros**.

**2 · La fecha del ticket se leyó `23/0/26`** — el OCR confundió el 8 con un 0.
Eso arma `2026-00-23`, y un `<input type="date">` **rechaza esa fecha en
silencio**: el campo se quedaba en blanco y la venta se guardaba con la fecha de
hoy en vez de la del ticket.

⚠️ En un corte **mensual** eso mueve la venta de mes cuando el ticket es de fin
de mes. Ahora se comprueba que el día y el mes existan; si no, **se dice** —«la
fecha del ticket se leyó "23/0/26", que no es una fecha»— en vez de dejar la de
hoy puesta y que el asesor la dé por buena.

**Y en una reparación ahora se enseña lo que se leyó.** Antes el aviso azul solo
se armaba para accesorios: en una reparación los campos se rellenaban solos y no
había nada contra lo que comprobarlos.

La prueba corre `accExtraer` contra el ticket transcrito y comprueba **el importe
(1124.39), el ticket, la fecha y que `precio × cantidad = importe` cuadre**.
Verificada devolviendo la búsqueda del 43739: falla diciendo que no leyó el
importe.

#### El código estaba en otra columna del ticket *(24-ago-2026, v212)*

Con todo lo demás ya en su sitio, la detección seguía sin reconocer una
reparación. El ticket de verdad lo explicó:

```
Artículo   Cantidad   Precio      Importe
REP FUERA DE GARANTÍA HW 2
100175545      1      1124.390   $1,124.39  I
IMEI / SERIE / SERVICIO: 3RYUN24919G00047
```

⚠️ **El SKU está en la columna «Artículo», no detrás de `SERVICIO:`.** Lo que
hay tras esa etiqueta es el **IMEI del equipo reparado** — el rótulo entero es
«IMEI / SERIE / SERVICIO:». La detección leía ahí, se traía el IMEI
`3RYUN24919G00047` y **no reconocía una reparación jamás**.

**En los accesorios ese mismo campo sí trae el código del artículo**
(`43739-MICAHR`, abreviado a mano), porque una mica no tiene IMEI. De ahí venía
el error: `accCodigos` funciona para **adivinar el producto** de un accesorio, y
lo reutilicé para algo que no es lo mismo.

Ahora el SKU sale de la **línea del artículo** —número, cantidad, precio,
importe—, que es exactamente la línea de la que `accExtraer` saca el precio del
43739 desde el 18-ago. Estaba delante todo el tiempo.

Y se comparan **sin los ceros de la izquierda**: el catálogo guarda `000043739`
y el ticket imprime `43739`.

**La prueba corre contra el ticket transcrito del papel**, entero, con su
cabecera y su pie — no contra un resumen cómodo escrito por mí. Es la diferencia
entre probar lo que sale de la impresora y probar lo que yo suponía que salía.

⚠️ **Dos debilidades de la propia prueba, encontradas al romperla:**

1. Al volver a leer el campo `SERVICIO:`, fallaba con *«accCodigos is not
   defined»* — que suena a **prueba rota**, no a detección rota, y se habría
   arreglado borrando el caso. Ahora el motor carga esa función aunque no se
   use, para que el fallo diga *qué decidió mal*.
2. Quitar el recorte de ceros **no rompía nada**: ese trozo no estaba cubierto
   por ningún caso. Un código sin prueba que lo respalde es código que nadie
   sabe si hace falta. Ahora hay un caso con el SKU configurado con ceros
   delante.

#### La sesión guardada nunca se refresca *(24-ago-2026, v211)*

El código estaba en la base, `login_asesor` y `login_empleado` lo devolvían, y
aun así **el campo salía vacío en Admin y la detección seguía apagada**. Ángel
volvió a entrar y todo siguió igual.

⚠️ **«Volver a entrar» no vuelve a pasar por el login.** `hes_store` se escribe
UNA vez, al identificarse, y nunca se refresca; si la sesión de Supabase sigue
viva, la app arranca directa con lo guardado. Una sesión creada antes de que un
campo existiera **se queda sin él para siempre**.

Es el fallo del 9-ago con la lista del equipo, y el archivo lo tiene escrito:
*«la app recuerda al usuario y ya no vuelve a pasar por aquí»*. Existe
`queFaltaEnLaSesion` para esto, pero mira solo dos cosas y **para gerente no
mira nada**.

**Añadir el campo ahí lo habría tapado hasta el próximo campo nuevo.** El
arreglo va a la raíz: **quien necesita el dato lo pide**.

| pantalla | antes | ahora |
|---|---|---|
| Captura de Series | `hes_store` | `captura_config` al abrir el panel |
| Admin → Configuración | `hes_store` | lee `tiendas` al abrir la pestaña |

Así, el gerente cambia el código en Admin y la captura del asesor lo usa **sin
que nadie vuelva a entrar**.

**Admin además pinta primero y refresca después**: la pestaña no sale en blanco
sin red, y si la lectura falla no se toca nada. Un formulario vaciado por falta
de red **borra los datos de verdad al guardarlo** — que es lo que estuvo a punto
de pasar aquí, con el campo en blanco delante del gerente.

Y al refrescar se pone al día `hes_store`, que es de donde leen las demás
pantallas: sin eso, el gerente vería el dato bueno en el formulario mientras la
app sigue usando el viejo.

`captura_config` va **sin token** a propósito: devuelve un código de artículo
que va impreso en cada ticket que se entrega al cliente. No es un secreto, y
exigir credencial solo daría otra forma de que la detección se apague sin verse.

#### La detección estaba apagada en los teléfonos *(24-ago-2026, v210)*

Ángel abrió la app y seguía viendo los dos botones. El código estaba puesto en
Admin y en la base, y aun así **la detección no se encendía en ningún teléfono**.

`sku_reparacion` viaja a la app dentro de `hes_store`, que se arma **campo por
campo** en el login. No lo añadí a esa lista, así que llegaba vacío, `SKUS_REP`
quedaba vacío y la detección se apagaba sola. **Sin dar error**: el panel
funciona igual, solo pregunta lo que debería saber.

⚠️ **El propio archivo lo advierte desde el 2-ago**: *«se arma el objeto campo
por campo, así que hay que nombrarlo o se pierde en silencio»*. Es exactamente
el fallo que costó el botón de «Ventas del día» oculto para todos. Había que
tocar **cuatro sitios**: el `select` de cada login en `index.html`, los dos
objetos `cfg`, y el `RETURNS TABLE` de `login_asesor` y `login_empleado`.

**Lo cazó `r_cadenas`**, que existe desde aquel fallo. Funcionó.

#### Dos cosas que aprendí de la regla al probarla

⚠️ **Un comentario en medio la ciega.** Al documentar el campo nuevo lo escribí
**entre** la firma de `login_asesor` y su `RETURNS TABLE`. La regla empareja los
dos y solo admite un salto de línea, así que dejó de encontrar los campos y
avisó de que faltaban **todos** — un falso positivo causado por un comentario, y
de los que hacen desconfiar de una regla buena. Los comentarios de esas
funciones van **arriba del `CREATE`**.

⚠️ **Un `.sql` suelto en la carpeta la dejaba ciega, y lo descubrió la propia
prueba.** `r_cadenas` leía *todos* los `.sql` del directorio para saber qué
devuelve `login_asesor`. Al verificarla quitándole el campo, seguía diciendo que
todo estaba bien: el respaldo `_b.sql` que la prueba dejaba al lado **aportaba
el campo como si fuera el archivo bueno**. Un archivo que nadie va a pegar en el
servidor no puede contar como si lo fuera, así que ahora solo mira **lo que git
conoce**.

Las otras reglas SQL no tenían este agujero: recorren `supabase_*.sql`, y un
respaldo `_b.sql` no entra en ese patrón.

#### Y el selector se esconde cuando el ticket decide

Preguntar lo que ya está impreso es trabajo de más. Ahora, cuando la detección
es concluyente, los dos botones desaparecen y queda un cartel con **lo elegido y
por qué** —«Es una reparación: el ticket trae el código 100175537»— y un
**cambiar** al lado. Esconderlo sin decir nada sería peor: el asesor tiene que
poder ver qué se decidió y desdecirlo si el OCR falló.

Los botones vuelven **al agregar cada línea**: la detección ya se gastó en lo
que se acaba de agregar, y lo siguiente que meta en ese mismo ticket puede ser
de otro tipo — que es justo el caso del ticket mixto.

#### El ticket decide qué es, no el asesor *(24-ago-2026, v208)*

Preguntarle el tipo al asesor era pedirle que repitiera algo que **ya está
impreso en el papel**. Los accesorios se reconocían desde el 18-ago por su
código de artículo (`43739` y los dos de Office); faltaba el de la reparación.

**Son DOS códigos, no uno** —en la 1217, `100175537` y `100175545`—, y por eso
la configuración es una **lista** separada por comas. Con uno solo, las
reparaciones cobradas con el otro se habrían guardado como accesorio y habrían
entrado en el Excel de comisiones. La prueba deja ese caso escrito: configurar
solo uno **no es inofensivo**.

Los pone el gerente en **Admin → ⚙️ Configuración → Códigos de reparación**,
y al leer la foto el selector se mueve solo. **Va en la configuración de tienda y
no escrito en la app**: Mr Fix mete producto cada temporada, y el día que cambie
ese código tiene que poder arreglarlo el gerente sin esperar a nadie.

⚠️ **Solo decide cuando el papel no deja dudas.** Hay tres casos en los que
deliberadamente **no** decide y deja elegir:

| caso | por qué no decide |
|---|---|
| El ticket lleva accesorio **y** reparación | Habría que adivinar cuál se está capturando |
| No se reconoció ningún código | El OCR no leyó lo suficiente para saberlo |
| El código no está configurado | Sin referencia, cualquier respuesta es inventada |

**Equivocarse aquí no es un campo mal puesto: manda la venta a la otra tabla.**
Un accesorio guardado como reparación **no entra en el Excel regional, y esa
comisión no se le paga a nadie** — sin dar error, y sin que se vea hasta cuadrar
la región. Al revés, una reparación colada como accesorio mueve las comisiones
de todo el equipo.

Y el OCR de esta impresora falla de verdad: `CARGA100WTS` se leyó
`CARGATOONTS 2 77`. Por eso el código se compara **aplanado por las confusiones
del OCR** (`accClave`), igual que la adivinanza del producto — si no, un
`9OOOT` mal leído no casaría con `90001` y la detección se apagaría sola sin
avisar.

**Vacío = detección apagada**, y es el valor por omisión a propósito: más vale
preguntar que adivinar mal.

`pruebas/mrfix_detecta.js` corre seis tickets contra la regla, y lo que comprueba
no es que acierte sino **cuándo se calla**. Ejecuta solo las piezas que deciden
—`accClave`, `accCodigos`, `accQueEs`— y no la pantalla entera, para que falle
por la regla y no por cualquier otra cosa del panel. Verificada rompiéndola por
sus tres frenos.

#### Un ticket, una foto, varios conceptos *(24-ago-2026, v207)*

El selector de tipo decidía **toda la captura**, y eso rompía con el ticket más
normal del mundo: una mica **y** un cambio de pantalla en el mismo papel. Había
que capturar dos veces y **fotografiar el mismo ticket dos veces**. Lo señaló
Ángel al usar la app.

El defecto era más viejo y más ancho de lo que parecía: **dos accesorios en un
ticket ya tenían ese problema desde el 18-ago**, y nadie lo había dicho.

**La foto, el número y la fecha son del PAPEL. El producto y el importe son de
cada línea.** El panel ahora sigue ese reparto, en tres partes: el ticket
arriba, lo que lleva en medio, y abajo el formulario para agregar un concepto
más. El selector ya no dice «qué venta es esta» sino «qué voy a agregar ahora».

⚠️ **Un solo `captura_id` para todo el ticket, y una sola foto.** Es lo que liga
la evidencia con lo capturado, y el papel es el mismo para todos los conceptos.
Con un id por línea, la foto quedaría ligada a uno solo —`venta_fotos` tiene
`PRIMARY KEY (store_id, captura_id)`, así que la segunda subida ni entraría— y
el resto del ticket se quedaría sin evidencia sin dar error.

**«Atendido por» es del ticket**, no de cada línea: es una persona la que
atendió esa compra. Por eso subió arriba y ya no se oculta en reparación.

**Las tablas siguen separadas.** Cada concepto se guarda con su función, así que
un ticket mixto acaba con sus accesorios en `accesorios_ventas` y su reparación
en `reparaciones`, con el mismo número y la misma foto. Compartir ticket y foto
no las junta; lo que las juntaría es compartir la tabla.

**Se guarda en secuencia, no en paralelo.** Si una línea falla hay que saber
*cuáles* quedaron dentro: con `Promise.all` se pierde ese orden y el asesor no
sabría qué recapturar sin duplicar lo que ya entró. Cuando falla a media
escritura se dice **cuántas entraron**, se quitan de la lista las guardadas y
las que faltan se quedan ahí, para que darle a Guardar otra vez mande solo el
resto. La foto se sube igual si algo entró: sin ella, lo guardado se queda sin
evidencia para siempre.

Dos avisos que salen **antes** de llamar al servidor, porque allí ya sería
tarde y con medio ticket dentro: el mismo producto dos veces en un ticket
—`UNIQUE (store_id, ticket, producto)`— y más de una reparación —`UNIQUE
(store_id, ticket)`—.

**Y si hay algo escrito sin agregar, se agrega solo al guardar.** Olvidar pulsar
«Agregar» es el fallo más probable de este panel, y castigarlo perdiendo la
línea sería peor que adivinar bien: los datos están delante, y lo agregado se ve
en la lista antes de guardar.

`pruebas/mrfix_tipo.js` cubre ahora el ticket mixto: que salgan las dos
llamadas, con **el mismo `captura_id`** y **una sola foto**. Comprobada
rompiéndola por los dos lados — un id por línea, y el tipo ignorado.

#### Un solo botón: 🔧 Mr Fix *(24-ago-2026, v205)*

Accesorio y reparación empezaron siendo **dos botones** en la barra y dos paneles.
Se juntaron en uno el mismo día, a propuesta de Ángel: *«¿por qué no puede haber
solo un botón?»*.

**Tenía razón, y el argumento de separarlos era del sitio equivocado.** Lo que
protege el Excel regional es que sean **dos tablas** y que la pantalla del Excel
no pueda leer reparaciones. Nada de eso depende de que haya dos pantallas.
Separar la interfaz no compraba ninguna garantía: solo llenaba la barra —con tres
botones no cabían las etiquetas en un teléfono— y **duplicaba el flujo de foto y
OCR**, que era idéntico en los dos paneles.

Al asesor, además, le llega **un ticket** de Mr Fix y decide qué fue; no elige
antes por qué puerta entrar.

Ahora es un panel con un selector arriba del todo, en color de marca —naranja el
accesorio, rojo la reparación—. Va **arriba y no entre los campos** porque es el
único dato que decide a qué tabla va la venta, y el único que no se corrige
después sin borrar y recapturar. Producto, piezas y vendedor **se ocultan** en
reparación en vez de quedarse vacíos: un campo que no se usa se acaba llenando de
cualquier cosa. Y el mismo campo cambia de nombre —«Precio» / «Importe
cobrado»—, porque del mismo papel se leen dos números distintos: en el accesorio
manda el precio de **la línea del 43739**, en la reparación el **importe** del
trabajo entero.

⚠️ **El riesgo que esto sí introduce, y que con dos botones no existía.** Lo
único que ahora separa una cosa de otra es una rama `if` dentro de `guardarAcc`.
Si esa rama se rompiera, una reparación saldría por `accesorio_guardar`, caería
en `accesorios_ventas` y de ahí **al Excel regional**, moviendo comisiones de
todo el equipo. Sin dar error: se vería, si acaso, al cuadrar la región semanas
después.

Por eso existe **`pruebas/mrfix_tipo.js`**, que no mira la pantalla sino **la
llamada que sale a la red** —el único punto donde la decisión ya no se deshace—.
Comprueba que cada tipo llame a su función *y que no llame a la del otro*.

Comprobada rompiéndola por los dos lados. La primera versión era más débil de lo
que parecía: con el producto vacío, ignorar el tipo se veía como «falta el
producto» y no como una reparación mal enrutada. Ahora deja el producto puesto
—que es el estado real del panel tras capturar un accesorio—, así una reparación
mal dirigida **llega hasta `accesorio_guardar`** y el fallo se lee con su nombre.

De paso, el DOM de pruebas no tenía `selectedOptions`, que un `<select>` real sí
tiene y que el código usa para sacar el SKU del producto. Sin eso, cualquier
prueba que guardara un accesorio reventaba con un error que **parecía de la
pantalla y era del andamiaje**.

### Reparaciones de Mr Fix *(24-ago-2026, v201)*

El asesor captura el ticket de reparación en **Captura → 🔧 Mr Fix → Reparación**, y los
dos técnicos externos lo ven en su pantalla, en una sección aparte de los
accesorios.

⚠️ **Tabla propia, `reparaciones`, y esa es la pieza que importa.** El Excel
regional de Mr Fix sale de `accesorios_reporte`, que lee `accesorios_ventas`.
Una reparación guardada ahí aparecería como venta de accesorio: **movería las
comisiones de todo el equipo** y el importe de una hoja que comparten diez
tiendas, sin dar error en ningún sitio.

Se pensó en una columna `tipo` dentro de `accesorios_ventas` y se descartó: eso
hace que *no* contaminar dependa de que cada consulta futura se acuerde del
filtro. Basta un `WHERE` que falte —o un `COUNT(*)` en un tablero— para que se
cuelen. Separadas es imposible por construcción, que es el mismo argumento por
el que `accesorios_ventas` no vive dentro de `ventas`.

Lo vigila **`r_reparaciones_fuera`**, por los dos caminos que bastan cada uno por
su cuenta para contaminar el archivo: una función `*reporte*` que lea
`reparaciones`, y la pantalla que baja el Excel llamando a algo de reparaciones
que no sea `reparacion_guardar`. Comprobada rompiéndola por los dos lados.

**No llevan vendedor, ni producto, ni piezas.** La reparación es del técnico y la
tienda no cobra comisión por ella, así que no hay a quién apuntársela. Campos que
no se usan se acaban llenando de cualquier cosa.

**El mismo lector de tickets que el accesorio** (`accLeerTicket`): es el mismo
papel de la misma caja. De lo que devuelve se usan solo ticket, importe y fecha —
en una reparación no hay línea de artículo del catálogo que adivinar, y por eso
se toma el **importe** y no el precio de una línea.

`UNIQUE (store_id, ticket)` sin producto, al revés que en accesorios: un ticket
de reparación es uno. El riesgo que frena es el mismo — dos asesores capturando
lo mismo al cerrar el día.

#### La pantalla del técnico, con dos totales

Dos secciones y **dos totales, nunca uno solo**: los accesorios van al reporte de
comisiones y las reparaciones no, así que son dos cobros distintos. Un total que
los sumara daría un número que no le sirve a nadie y que se prestaría a cotejarlo
contra el que no es.

⚠️ **Que falte `reparaciones_tecnico_lista` en el servidor no cierra la
pantalla.** Mientras el SQL no esté pegado devuelve 404, y tratarlo como avería
tumbaría también los accesorios, que sí contestan. Sin reparaciones se ve la
mitad; con la pantalla cerrada no se ve nada. Por eso `mesDe()` solo mira el
fallo de accesorios para decidir si la clave sirve — y por eso la sección dice
«no disponible» en vez de «no hay reparaciones»: **cero y no-se-pudo-preguntar no
son lo mismo**, y confundirlos es lo que hizo perder una tarde el 24-ago.

La validación de la clave mira **las dos listas**. Con solo los accesorios, un
técnico cuyo mes llevara únicamente reparaciones —que para él es un mes normal—
leería «esa clave no es válida» y dejaría de intentarlo.

**La foto del ticket dura 31 días** *(24-ago-2026; eran 7)*. Los 7 se pensaron
para una serie dudosa, que se reclama en caliente o no se reclama. Pero la misma
tabla guarda los tickets de accesorio y de reparación, que son la evidencia de un
**corte mensual**, y con 7 días los de la primera semana ya no existían al
cotejarlo. **Una evidencia que caduca antes del momento de usarla no es
evidencia.** El coste es de espacio y está medido: a ~10 ventas al día y ~150 KB
por foto, 31 días son unos **46 MB** contra los 10 MB de antes.

⚠️ **31 días cubren el mes EN CURSO, no el anterior.** Un ticket del 1 de mes
mirado el 10 del siguiente ya no está. Es una decisión tomada —el cotejo se hace
dentro del mes—, no un descuido: si algún día hay que revisar un mes cerrado,
esto es lo primero que hay que subir.

La pantalla sigue diciendo el plazo al fallar, en vez de un «no se pudo abrir» que
invita a reintentar toda la tarde algo que no va a volver.

#### El ticket del accesorio, también desde la galería *(24-ago-2026, v200)*

`capture="environment"` no es una preferencia: en el celular **abre la cámara y
deja fuera el carrete**. Así que el ticket que ya estaba en el teléfono —el que
se captura al cerrar el día, o el que un compañero mandó por WhatsApp— no había
forma de subirlo, y esa venta se quedaba sin evidencia. Que es justo la que hace
falta cuando el OCR lee mal el producto.

**Son dos inputs, no uno sin `capture`.** Quitarlo sin más arregla el caso raro
y estropea el normal: el asesor con el cliente delante pasaría de disparar la
cámara a elegir en un menú. Mismo par que ya tenían las series arriba
(`fileCam` / `fileGal`), y las dos entradas acaban en `accFotoElegida`, para que
no haya una foto de galería que se guarde distinto de una de cámara.

⚠️ Lo vigila **`r_galeria`**: un input de galería con `capture` puesto es un
botón que aparece, se pulsa, abre la cámara y no hace lo suyo. **No da error, no
deja pantalla en blanco** — el asesor supone que el teléfono es así. Es el fallo
de copiar el input de la cámara para hacer el de al lado. Comprobada rompiéndola
en los dos inputs.

#### La consulta de Mr Fix decía «no hay conexión» *(24-ago-2026)*

*(Sin número de versión: esta página no la sirve el service worker ni llega a ningún celular del equipo, así que no sube `VERSION`.)*

El técnico metía su clave y le salía **«No hay conexión»** con la red perfecta.
No era la red: era un **405** del servidor que la pantalla llamaba así.

`accesorios_tecnico_lista` y `accesorios_tecnico_foto` iban marcadas **`STABLE`**
y llaman a `tecnico_ok_`, que sella `ultimo_acceso` con un `UPDATE`. **PostgREST
corre las funciones `STABLE` en transacción de solo lectura**, así que el sello
reventaba con `25006: cannot execute UPDATE in a read-only transaction`.

⚠️ **Falla solo con la clave BUENA.** Con una mala, `tecnico_ok_` sale en el
`SELECT` —antes del `UPDATE`— y devuelve cero filas tan tranquila. O sea que
probarlo con una clave inventada, que es lo primero que hace cualquiera, **sale
bien**; el único que ve el fallo es el técnico de verdad, que no puede
depurarlo y cuyo mensaje le dice que el problema es suyo. Así se subió el 20-ago
sin que nadie lo notara.

**Dos cosas se arreglan, no una:**

1. **La causa** — fuera el `STABLE` de las dos. Escriben: declararlo era falso.
2. **El disfraz** — `rpc()` devolvía `null` igual sin red que con un 405, y el
   mensaje elegía el más inocente de los dos. Ahora `RPC_FALLO` distingue
   `'red'` de `'servidor'`, y un fallo del servidor dice **«avisa en la
   tienda»**: reintentar es lo único que se le ocurre a quien lee «no hay
   conexión», y aquí reintentar no arregla nada. El status queda en `console`
   porque el 405 no dejaba rastro en ningún sitio.

Es el mismo patrón de v199 —un fallo de servidor haciéndose pasar por otra cosa—
tres commits después. Por eso esta vez la regla la vigila `verificar.py`:
**`r_sql_volatilidad`** falla si una función marcada `STABLE`/`IMMUTABLE`
escribe, mirando también **a quién llama**, no solo su cuerpo: ninguna de las dos
tenía un `UPDATE` a la vista —estaba una llamada más abajo—, y esa es justo la
razón de que se marcaran `STABLE` sin que chirriara.

⚠️ **La primera versión de esa regla no cazaba el fallo que venía a cazar.**
`UPDATE\s+\w\b` **no casa nunca**: la `\w` se come la primera letra del nombre de
la tabla y entre esa y la segunda no hay límite de palabra. `INSERT INTO\b` sí
casaba, así que la regla parecía funcionar —señalaba `tecnico_guardar`— mientras
daba por buenas las dos funciones del bug. Se vio al probarla contra el fallo
real en vez de contra uno parecido. **Una regla verde que no se ha roto a
propósito no es evidencia de nada.**

De paso, la siembra de claves: iba con `ON CONFLICT (store_id, clave) DO NOTHING`,
que no protege de lo que importa. Una vez rotada una clave, el conflicto ya no
salta y repegar el archivo **resucita la vieja como un tercer técnico activo** —
reabrir un acceso retirado, sin dar error y sin que nadie mire esa tabla. Ahora
solo siembra si la tienda no tiene ningún técnico.

### Los artículos de una compra van juntos *(20-ago-2026, v196)*

Un cliente que se llevaba un teléfono y un reloj salía como **dos ventas**, y al
revisar el día no había forma de saber que fue una sola compra. Ahora el asesor
**cierra la venta a mano** y lo capturado antes queda agrupado.

⚠️ **AGRUPA Y NADA MÁS.** El seguro se marca por artículo, la foto es por
artículo, **el Assurant cuenta por artículo** y el inventario descuenta por
artículo. Si alguien "simplificara" contando una venta con seguro en vez de dos
artículos con uno, **el attach se movería solo** —el KPI con meta del 25 %— y la
regla de combos de la tienda («2 artículos = 1 con seguro») dejaría de tener
sentido. Nadie ataría ese cambio a esto meses después.

Por eso `venta_guardar` es la única función que toca el grupo: ni
`inventario_vivo`, ni `ventas_hoy`, ni `cargar_cortes` lo miran siquiera.

**El número de venta no se guarda: se calcula al leer** con un `dense_rank` por
día. Guardarlo obligaría a que alguien lo asignara, y dos teléfonos capturando a
la vez pedirían el mismo. Calculado no hay carrera posible.

**Las ventas anteriores no se reinterpretan:** sin grupo, cada una es la suya y
se ve igual que antes.

**El único fallo posible es olvidar cerrar**, y no da error: pega la compra del
siguiente cliente a la anterior. Se cubre con dos cosas — el aviso verde
«venta abierta · N artículos» siempre a la vista, y el cierre automático **al
cambiar de vendedor**, que es el olvido más probable. Nada de cerrar por tiempo:
un cliente que se lo piensa veinte minutos sigue siendo la misma venta.

El grupo vive en `localStorage` porque la PWA se relanza cada vez que el asesor
manda un precio por WhatsApp (cadena 5-bis): perderlo ahí partiría la venta en
dos sin que nadie lo note.

Lo cubren los bloques 9 y 10 de `cola_ventas.js`, comprobados rompiendo las dos
guardias.

### Corregir una venta *(17-ago-2026, v171)*

Lo último que se hacía en la hoja. Vive en el panel **Ventas del día** de
Captura, no en Admin: la lista ya está ahí, con navegación por días, la foto y
el `captura_id` —que es lo único que identifica la fila—. Rehacerla en Admin
serían dos listas y una se quedaría atrás.

**Lo que mueve cada campo, porque no es obvio:**

| campo | mueve | ¿avisa si sale mal? |
|---|---|---|
| seguro | el Assurant del día | no |
| vendedor · precio | comisiones | no |
| serie | choca con `UNIQUE(store, serie, día)` | sí, da error |
| fecha | solo el día. **No mueve stock** | — |
| **sku** | **el stock de DOS productos** | **no** |

⚠️ **El SKU obliga a tocar el corte, y esto es lo que hay que entender antes de
tocar `venta_editar`.** El stock es `onhand − (ventas del SKU − corte)`, y
`inventario_corte` es una FOTO de cuántas ventas había al subir el informe. Si
la venta ya estaba en esa foto con el SKU equivocado:

- el SKU **correcto** resta una pieza que el On Hand ya descontaba → una de menos
- el **equivocado** queda con `total < corte`; `greatest(0,…)` lo tapa hasta que
  se venda otra pieza de verdad, y esa **no se descontará**

Ninguno da error. Es el mismo error de las entregas de preventa: restar dos
veces la misma pieza. Por eso `venta_editar` mueve la unidad en el corte junto
con la venta (−1 al viejo, +1 al nuevo, si `vendida_en < tomado_en`), en la
misma transacción. Corregir una etiqueta no cambia cuántas cajas hay en bodega.

**Toda edición queda en `ventas_ediciones`** con el antes y el después
completos. Eso es lo que de verdad protege aquí, y lo que no había cuando esto
se hacía a mano en la hoja: una corrección equivocada se ve y se deshace.

⚠️ **Ver las ventas y corregirlas son DOS permisos, y se estorbaban.** El ✏️
vive dentro del panel «Ventas del día», que solo abría la persona de
`hoja_auth`. El subgerente tenía permiso de corregir —`puede_gestionar_` le dice
que sí— y ninguna forma de llegar al botón: la lista no se le abría. Una puerta
concedía y la otra bloqueaba, sin decir nada. Desde v176 el panel se abre por
`hoja_auth` **o** por puesto de gestión.

Y al revés sigue igual: `hoja_auth` es hoy una asesora, que ve las ventas para
cotejarlas pero NO ve el ✏️.

**Y lo preguntan DOS sitios**, por eso hay un solo portero (`puedeVerVentas_`):
el que enseña el botón y el que responde al clic. En v176 se cambió solo el
primero — el gerente veía «Ventas del día» y al tocarlo le decía que no tenía
permiso. Es la misma lección de `seccionVisible_` en el tablero, aprendida
aparte en este archivo.

La prueba **pulsa el botón** y comprueba que el panel se abre; mirar si
`puedeVerVentas_()` devuelve `true` habría dado verde con el fallo puesto,
porque la función estaba bien y quien no la llamaba era el handler. Para eso el
DOM de `cola_ventas.js` tiene un `classList` de verdad: sin él solo se pueden
probar valores de retorno, no comportamiento.

**Sobre el permiso, sin adornos:** `escritura_ok_` valida el token de TIENDA,
que es el mismo para todos. `venta_editar` recibe además el número de empleado
y comprueba el puesto — pero el gerente dueño entra por correo y no tiene ficha
(cadena 1-bis), así que un `p_quien` vacío tiene que seguir pasando. Es el mismo
nivel que Resurtir: se le esconde al asesor, no se le impide. La auditoría es la
barrera real.

`_esGestionCS` en captura repite el criterio de `esPuestoDeGestion_` del
tablero **a propósito y con nota en los dos sitios**: dos ideas de "quién manda"
acabarían separándose y la misma persona podría editar en una pantalla y no en
la otra.

### El fallo que la prueba no vio, y ahora sí *(17-ago-2026)*

Se enganchó un `addEventListener` a nivel superior sobre `$('edSku')`, cuyo
`<div>` está **después** del cierre del `<script>`. En el navegador eso es
`null` y `null.addEventListener` **tumbaba la captura entera al arrancar** — no
el modal: toda la pantalla, sin poder capturar una venta.

`verificar.py` decía "todo en orden" porque el DOM falso de las pruebas devuelve
un elemento para **cualquier** id. Y no bastaba con comprobar que el id existiera
en el HTML: `edSku` existe, solo que más abajo.

`pruebas/cola_ventas.js` ahora compara **posiciones**: durante la carga, un id
que aparece por debajo del script principal devuelve `null`, como el navegador;
al terminar, existen todos. Comprobado reintroduciendo el fallo — sale con el
mismo mensaje que daría el teléfono.

**Todos los paneles de `captura_series.html` se pintan después del script.** Se
tocan solo dentro de funciones, nunca al cargar.

### La hoja dejó de recibir ventas *(17-ago-2026, v170 — fase 6)*

Se apagó el mismo día que se invirtió el flujo, por decisión de Ángel, sabiendo
que la evidencia medida era del flujo viejo. Es reversible —revertir el commit
devuelve la doble escritura— y no borra nada: la hoja conserva su histórico.

Lo que se fue de `captura_series.html`: `gasPost`, `gasEnviar`, la cola
`hes1217_pending`, `flushCloud`, el `gasEnviar({tipo:'eliminar'})` del borrado y
`refreshGid` (pedía `modo=estado` en cada arranque solo para armar un enlace a
Google Sheets que ya nadie abría).

⚠️ **El rescate de la cola vieja NO se fue, y no es residuo.** Un teléfono puede
pasar semanas sin abrir la app y saltar de v168 a v170 de golpe, con capturas en
`hes1217_pending`; eso es, por definición, lo que no está en Supabase. Es el
único código que sigue leyendo esa clave. Se puede borrar cuando conste que los
seis teléfonos han abierto la app en v169 o posterior.

**Y hubo que desagendar la comparación nocturna en el mismo movimiento**
(`supabase_apagar_hoja.sql`). Comparaba Supabase contra la hoja; sin hoja que
reciba, a partir de la noche siguiente habría dicho «no cuadra» todos los días
con TODAS las ventas como `sobran` — y con razón. Un indicador permanentemente
en rojo por un motivo correcto deja de mirarse, que es justo antes de que un día
se ponga rojo de verdad. Por lo mismo se retiró `revisarCuadre` de Admin, que lo
preguntaba en cada apertura.

`ventas_comparacion` se conserva entera: es la prueba de los 12 días —65 ventas
cotejadas, cero faltantes— que autorizaron apagar. Borrarla sería tirar la única
evidencia de que la decisión estaba fundada.

### La venta ya no pasa por la hoja para llegar aquí *(17-ago-2026, v169)*

```
ANTES (v168)                          AHORA (v169)
captura                               captura
   ↓                                     ├──► cola Supabase ──► tabla ventas
cola Sheet ──► POST al GAS               │     (manda: stock, Assurant, comisiones)
                  ↓ SI CONFIRMA          └──► cola Sheet ──► POST al GAS
             tabla ventas                      (respaldo, no condiciona nada)
```

**Supabase dependía del Apps Script y nadie lo había visto así.**
`guardarEnSupabase` colgaba del final de `flushCloud`, o sea que solo corría si
el Sheet confirmaba. Con el GAS caído no entraba **ni una venta** a Supabase, y
como `inventario_vivo` descuenta de la tabla `ventas` DE SUPABASE, el stock
dejaba de bajar. Sin error: con el número de piezas de ayer.

Ahora son dos colas independientes. Ninguna espera a la otra ni puede tumbarla.

**El aviso se mudó con la verdad.** El banner de «capturas sin subir» era del
Sheet; ahora lo levanta la cola de Supabase, porque una venta que no llegue ahí
no cuenta para nada aunque esté en la hoja. `flushCloud` dejó de alarmar a
propósito: un fallo suyo ya no tiene consecuencia en piso, y alarmar por algo
sin consecuencia enseña al equipo a ignorar el aviso. **No se calla:** sale al
día siguiente en `ventas_comparacion` como `faltan`, con las series.

⚠️ **El rescate de la cola vieja va AL FINAL del archivo, y no es un capricho.**
Lo que hubiera en `hes1217_pending` al actualizar es, por definición, lo que NO
está en Supabase; sin rescatarlo son ventas que solo viven en la hoja. Se
escribió primero junto a la cola, y ahí `_sbCuerpo` reventaba con
ReferenceError —usa `SB_STORE`, un `const` de 200 líneas más abajo, y un `const`
no se eleva— **y el `catch` se lo tragaba entero**: la migración no hacía nada y
no lo decía. Lo cazó `pruebas/cola_ventas.js`, no la lectura del código.

Esa prueba corre en cada commit y comprueba las dos cosas que fallarían sin dar
señal: que una venta capturada **sin red** acaba en la cola de Supabase, y que
la cola vieja se rescata una vez y solo una. Las dos, comprobadas rompiéndolas.

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

## El verificador y las pruebas *(17-ago-2026)*

Las 15 reglas de `verificar.py` nacieron cada una de un fallo que ya había
llegado a producción, así que por diseño miran hacia atrás. En un día con tres
fallos nuevos eso se notó, y el diagnóstico no fue "faltan reglas":

**El DOM de las pruebas mentía.** Devolvía un elemento para CUALQUIER id y
traía `classList.add(){}` vacío. Con eso es imposible detectar dos cosas: tocar
algo que todavía no se ha pintado, y si una pantalla se abrió de verdad.

Ahora vive en `pruebas/dom.js`, uno solo para todas:

- **respeta el orden del documento** — durante la carga, un id que se pinta por
  debajo del `<script>` devuelve `null`, igual que el navegador
- **`classList` de verdad**, con un Set, para poder probar comportamiento

⚠️ **Probar la función no es probar el comportamiento.** La primera prueba del
botón de «Ventas del día» llamaba a `puedeVerVentas_()` y daba VERDE con el
fallo puesto: la función estaba bien, quien no la usaba era el handler. La que
sirve pulsa el botón y mira si el panel se abrió.

Y los handlers `async` hay que esperarlos: el `onclick` hace `flushSupabase()`
antes de abrir el panel, así que comprobar justo después daba un falso rojo.

**Dos reglas nuevas:**

- `porteros` — una condición de permiso comparada en más de un sitio. Solo mira
  constantes de sesión; con banderas ya calculadas daba falso positivo
  (`confirmarPuesto` compara antes/después, que no es decidir un permiso), y una
  regla que avisa de algo correcto se acaba ignorando.
- `contrato` — avisa, sin bloquear, cuando cambia el `RETURNS TABLE` de un SQL,
  diciendo qué pantallas lo leen. No puede decidir por nadie, pero pone delante
  la pregunta que costó el fallo del aparador: **¿siguen significando lo mismo
  esos campos?**

Y una tercera *(20-ago-2026)*: **un `.js` en `pruebas/` que no esté en la lista
de `verificar.py` bloquea el commit**. La lista es explícita para que se note si
falta un archivo, pero eso dejaba el hueco contrario —una prueba escrita y no
registrada no corre nunca, y el repo aparenta cubrir algo que no cubre—. Las
bibliotecas (`dom.js`, `entorno.js`, `casos_tablero.js`) están exentas.

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
| 2 · lecturas | ✅ las cinco apps |
| 3 · ventas, doble escritura | ✅ v115 · **medida y cerrada el 17-ago** |
| 4 · fotos, autollenado, edición | ✅ salvo **editar una venta**, que no existe |
| 5 · invertir el flujo | ✅ v169 — Supabase deja de depender del GAS |
| 6 · retirar la escritura al Apps Script | ✅ **v170, 17-ago-2026** |
| + · corregir una venta | ✅ v171 — lo último que quedaba de la hoja |

**La migración está terminada.** La hoja es respaldo de solo lectura con su
histórico hasta el 17-ago-2026 y no queda nada que dependa de ella.

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
