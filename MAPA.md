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
todos, incluida la única persona que lo usa. Lo cierra
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
`index.html` guardaba `puesto:''`. O sea que el subgerente veía una cosa con
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

### Cadena 1-ter · El gerente que no tiene número *(15-sep-2026, v238)*

**La misma familia de fallo, por tercera vez, y ahora en la pantalla del
sueldo.** Entrando con su número, el gerente veía las comisiones del equipo.
Entrando con su correo —la misma persona, la misma tienda— la pantalla le decía
*«Para ver tu comisión, entra con tu número de empleado»*.

Porque **el gerente dueño no tiene ficha de empleado**: su cuenta vive en
`tiendas.user_id`, no en `empleados`. `doLogin()` lo encuentra por ahí, nunca
llega a `vincular_mi_cuenta`, y su `else` hace `removeItem('hes1217_empleado')`.
Comisiones lee esa clave y solo esa, así que le llegaba un desconocido — y a un
desconocido, por diseño, no se le enseña nada (`supabase_comisiones_privadas.sql`).

```
comisiones.html
   ↓ ¿hay hes1217_empleado?  → sí: puesto (gerente/subgerente) o su propia fila
   ↓ no  → ¿hay sesión de correo?   ← la tercera vía, 15-sep-2026
          ↓ admin_de(store) EN EL SERVIDOR
          ↓ y la RPC se firma con el access_token, no con la clave publicable
```

**Las dos mitades hacen falta o esto no existe.** `comisiones_lista` lleva
ahora `admin_de(p_store)` (`supabase_comisiones_gerente_correo.sql`), pero
`admin_de` mira `auth.uid()` y con la clave publicable no hay uid: si la
pantalla no mandara el JWT de la sesión, el servidor devolvería cero filas y se
vería *«aún no hay comisiones cargadas»* — un fallo mudo, con aspecto de que
falta subir el reporte. Por eso la prueba no comprueba que se pinte el equipo:
comprueba **con qué cabecera se pidió**.

**Aquí no vale el atajo del tablero.** Resurtir se resuelve cayendo en
`ROLE === 'gerente'`, y está bien: lo peor que pasa es ver una lista de pedidos.
Esto es el sueldo del equipo, así que quién manda lo dice `admin_de` y no el
`localStorage`, que además lo comparten todas las apps del mismo origen (ver
la regla `r_sesion_prefijada`). Una sesión de otra tienda llega hasta aquí igual
que la propia; lo único que las distingue es preguntar.

Se le pregunta **solo a quien no traiga ficha**: quien entra con su número no
paga ni una llamada ni un milisegundo. Y mientras se pregunta, la caché del
teléfono **no se borra** — si resulta ser el gerente, esa caché es suya y es lo
único que le queda sin señal.

Lo cubren los casos 6 a 8 de `pruebas/comisiones_solo_mia.js`, **los tres
comprobados rompiendo su guardia**: firmar con la clave publicable en vez de con
la sesión, y fiarse de que hay sesión sin preguntar si manda. Los dos se
detectan.

**Y la otra mitad, en `index.html` (v239).** `doLogin()` preguntaba por la ficha
del equipo **solo si no encontraba tienda**, y el dueño la encuentra siempre, así
que nunca llegaba a `vincular_mi_cuenta`. Ahora se pregunta siempre. Dos cosas
que no son evidentes y que la prueba sujeta (`pruebas/login_por_correo.js`, la
primera que tiene esta función):

- **`esDuena` manda sobre el `admin` de la ficha.** Hasta que el dueño pudo
  traer ficha, ese campo daba igual; en cuanto registra su correo empieza a
  contar, y una ficha sin `admin` lo dejaría de asesor en su propia tienda —sin
  Admin ni Resurtir— por haber hecho justo lo que se le pidió.
- **Una ficha de otra tienda no se guarda.** Dejaría en el teléfono un número
  que aquí no es de nadie, y las pantallas que identifican por número lo usarían
  sin dudar.

### Cadena 1-quater · Admin, con sesión de otra tienda *(15-sep-2026, v240)*

Encontrado revisando lo anterior: `verificarAcceso()` abría Admin con
**cualquier** sesión de Supabase abierta.

```js
const { data } = await sb.auth.getSession();
if (data && data.session) return { ok:true, via:'sesión de gerente' };   // ← así estaba
```

La sesión, como el resto de `localStorage`, es **por origen**: la del tablero
multi-tienda abría el Admin de la 1217. El gerente de cualquier otra tienda de
la red entraba tecleando la URL, sin un solo error en pantalla. Mismo agujero
que el horario cerró el 4-ago, misma respuesta: `admin_de(store_id)`, en el
servidor. La pestaña **Equipo** lo pregunta también, aunque la RLS ya parase la
escritura: si no, enseña el alta de accesos y la lista del equipo a quien no
puede tocarlos.

⚠️ **Lo que sujeta esta guardia no es el caso que cierra, son los que deja
pasar.** Si no manda —o si `admin_de` no contesta— no se corta: se sigue al
camino del número, que es como entra el subgerente y como entra el gerente
cuando no hay señal. Una guardia que además deja fuera a quien tiene que pasar
se quita a la semana, y entonces no queda ninguna. Los casos 3, 4 y 6 de
`pruebas/admin_sesion_ajena.js` son exactamente eso, y el 5 es su límite: no
poder comprobar tampoco significa «pasa».

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

#### El seguro se veía en el servidor y no en la pantalla *(6-sep-2026, v230)*

Visto en piso: «cuando vemos ventas del día no veo qué artículos se fueron con
seguro». Y el dato estaba ahí desde el principio — `ventas_detalle` devuelve
`con_seguro` en **las tres clases** de fila. Lo tiraba el traductor del cliente
(`cargarVentasDia`, l. 1607), que arma las claves cortas del panel campo por
campo: **lo que no se nombra ahí se pierde en silencio**, exactamente como en la
Cadena 1 con `gas_token` y `hoja_auth`. Tercera vez que el mismo mapeo campo por
campo se come un campo, y las tres veces la pantalla se veía normal.

Ahora cada renglón lleva su insignia, y debajo va el **attach del día**
(`notaAttach_`).

⚠️ **Tres cosas que, si se deshacen, no dan error:**

1. **`null` no es «sin seguro».** Son las capturas anteriores al dato. Pintarlas
   en gris inventa ventas sin proteger que nadie registró así, y de paso mete un
   denominador falso en el porcentaje.
2. **El attach de aquí EXCLUYE las entregas e INCLUYE los cobros** — el criterio
   de `ventas_hoy`, que es el número que se reporta a Demetrio. Contar todas las
   filas daría **otro** attach del mismo día sin que ninguno esté mal: es el
   descuadre que cerró v182, reabierto por abajo. Al romperlo a propósito, la
   pantalla decía 75 % donde el KPI dice 67 %.
3. **La insignia sí se pinta en entregas y cobros.** La pregunta que contesta la
   lista es qué se llevó el cliente, y un apartado lleva su seguro desde el día
   que se apartó. Lo que no cuenta igual para el KPI ya lo dice la pastilla de al
   lado.

Lo cubre `pruebas/ventas_dia_seguro.js`, comprobada rompiéndola por los tres
lados. Mira **lo pintado**, no el mapeo: un campo que se pierde al traducir deja
la pantalla igual de callada que un campo que no existe.

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
quien cobró en caja. En el 33480 el número era el del gerente y había
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
y sin acentos, y uno está escrito distinto —una letra de más en la app que en
el Excel—. De ahí `empleados.nombre_reporte`, mapeado
**explícito por número de empleado**: una regla automática acertaría hoy y
fallaría con el primer apellido compuesto, un mes después.

`accesorios_reporte` marca con `sin_nombre` las ventas cuyo vendedor no tiene
ese mapeo, y la pantalla las enseña en rojo en vez de esconderlas.

**Se baja un .xlsx aparte y se pega en el archivo regional**, nunca se
sobreescribe: ese archivo lo comparten diez tiendas y reemplazarlo pisaría el
trabajo de las demás. El .xlsx que genera la app trae las columnas **en la
misma posición** que el regional, para que el pegado caiga donde debe.

#### Un asesor escrito de dos formas *(28-ago-2026)*

El reporte de AGOS 26 avisó de **19 ventas de un asesor sin nombre para el
Excel**. El mapeo del 18-ago estaba bien puesto —su número → sus apellidos en
mayúsculas—: nunca se llegaba a él.

**Hay dos listas del equipo, y difieren en una letra.** Con nombres de ejemplo,
que es como está escrito en las pruebas desde que se limpió el repo:

| | |
|---|---|
| `public.empleados.nombre` | `María Fuentes Bravo` *(una V)* |
| `tiendas.vendedores` (jsonb, Admin → Equipo) | `Maria Fuentes bravvo` *(dos V)* |

`accesorios_reporte` las casa con `upper(unaccent_(…))`. Eso salva a los otros
cuatro, cuya única diferencia son los acentos —`Martínez`/`Martinez`,
`Pérez`/`Perez`—, pero **una letra de más no la arregla ningún `unaccent_`**:
el `LEFT JOIN` se queda sin empleado, `nombre_reporte` sale `NULL` y la fila se
marca `sin_nombre`.

⚠️ **Y el nombre se guarda desde dos sitios distintos.** Quien entra con su
número captura con el de `empleados` —el bueno—; quien lo elige en «¿Quién
eres?» captura con el de la config —el malo—. Maria llevaba meses **partido en
dos personas**: 19 ventas de accesorio y 32 en `ventas` con la grafía mala,
contadas aparte en leaderboard y attach. Es el mismo fallo que ya se cerró para
los apartados (`tablero.html:577`), reaparecido por la otra puerta.

`supabase_unificar_vendedor.sql` unifica los datos ya guardados **recorriendo
todas las columnas de texto del esquema**, y no con dos `UPDATE` a mano: el
nombre del vendedor vive suelto en 24 archivos SQL y un barrido a ojo deja fuera
justo la tabla que nadie recordaba. Las de auditoría quedan fuera a propósito
—guardan lo que se escribió entonces—.

**`hoja_auth` no se tocó, y por poco.** Se compara letra por letra contra la
lista de vendedores; hoy es otra persona del equipo. Si hubiera sido él,
corregir la grafía le habría quitado «Ventas del día» sin dar ningún error.
Se comprueba antes de tocar la lista, siempre.

Queda `equipo_divergencias('1217')`: dice quién no casa **el día que se edita el
equipo**, no a fin de mes con las ventas ya mal guardadas. Detecta tres casos
—nombre de la config sin empleado, empleado sin `nombre_reporte`, empleado que
falta en la config— y `pintarDivergencias()` en `admin.html` lo enseña en rojo
en **las dos pestañas donde se causa**: 👥 Equipo y ⚙️ Configuración.

**Un solo portero para las dos**, igual que `seccionVisible_`: dos consultas
separadas se responden distinto el día que alguien toque una, y entonces una
pantalla avisa y la otra no. Y **si la consulta falla, no dice nada**: un «no se
pudo comprobar» en rojo cada vez que se cae la señal del centro comercial enseña
a ignorar el recuadro, y entonces deja de leerse el día que sí trae algo.

No impide que las dos listas vuelvan a separarse —mientras `tiendas.vendedores`
se escriba a mano, pueden—; hace que se note.

⚠️ **El comentario de `admin.html` no lleva los nombres.** Se escribieron ahí al
documentar el caso y `verificar.py` lo paró: ese archivo es público.

**Y este archivo también lo es** —`MAPA.md` está rastreado en el repo—, cosa que
se dio por supuesta al revés el mismo día. Ver «Los datos del equipo llevan
meses publicados».

#### El POS imprime el mismo producto con dos códigos *(6-sep-2026, v230)*

Visto en piso: *«cada que escaneamos un ticket que tiene un cargador de 100 watts
la descripción en automático aparece cargador kids»*.

**No era del cargador kids, y renombrarlo no lo arreglaba.** Medido sobre los
tickets reales guardados en `pruebas/`:

| ticket | lo que imprime el POS | importe |
|---|---|---|
| 4 y 5 | `CARGA100WTS` (el OCR lo lee `CARGATOONTS`) | $999 |
| **7** | **`CARGADOR100`** | **$999** |

Los dos son el mismo producto —el cargador de 100W— y el catálogo solo admitía
un código, `43739-CARGA-100W`. Normalizado, `CARGADOR100` comparte **ocho**
letras con `43739 CARGADOR KIDS` y **cinco** con el suyo, así que la adivinanza
proponía **CARGADOR KIDS, $330**, para una venta de $999. Con toda confianza,
sin error, y hacia el reporte que se pega en el Excel de la región.

⚠️ **Ninguna regla de prefijo podía separar estos dos casos, y se comprobó antes
de intentarlo.** El caso bueno —`CARGATOONTS p`, con la basura que el OCR le
pega detrás— explica el 75 % del código leído; el caso malo, el 73 %. Afinar el
umbral para partir por ahí habría sido decidir a ciegas por dos puntos, y el
siguiente producto lo rompe otra vez. **El problema no era la regla: era que el
catálogo no podía decir la verdad.**

Ahora el campo **Código de artículo admite varios, separados por coma**
(`accCodigosDe`, `accPrefijoMax` en `acc_codigos.js`). No hizo falta tocar
Supabase: `articulo` solo lo consumen la adivinanza y el aviso de Admin — **no
va al Excel**, que sale del nombre del producto.

⚠️ **Tres cosas que, si se deshacen, no dan error:**

1. **Se compara producto a producto, con el mejor de SUS códigos.** Si cada alias
   entrara por separado, dos códigos del mismo producto se estorbarían en el
   `largo > segundo` y el producto MEJOR dado de alta sería el único que no se
   propone nunca. Se lee como «el OCR ya no acierta». *(Solo se nota cuando los
   dos alias empatan: la primera versión de la prueba usaba los dos códigos del
   cargador —11 contra 5— y pasaba con el fallo puesto.)*
2. **El aviso de Admin mira si uno es el PRINCIPIO del otro, no cuántas letras
   comparten.** `MICAHR` y `MICAHRPLUS` sí chocan; `CARGADOR100` y
   `CARGADORKIDS` comparten ocho y no. Con la regla vieja, el aviso decía «no
   hagas esto» justo al dar de alta el alias que arregla el fallo — y quien lo
   lee no tiene cómo saber que esa vez el aviso se equivoca.
3. **La coma se parte ANTES de normalizar.** `accClave` convierte `|` en `1`, así
   que un separador que ella pueda tocar es un separador que a veces desaparece.

⚠️ **Esto NO se arregla solo con código.** Mientras el producto no lleve sus dos
códigos en el catálogo, la app sigue proponiendo el kids. El dato se pone en
**Admin → 📦 Catálogo**: `43739-CARGA-100W, CARGADOR100`.

Lo cubre `pruebas/acc_alias_codigos.js`, con los tickets reales y comprobada
rompiéndola por los tres lados.

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

#### El producto de una línea con el importe de otra *(24-ago-2026, v225)*

Noveno ticket, y el fallo **más caro de todos** — y este no era del OCR. El papel
llevaba las dos cosas:

```
000043739 | 149,000 $149.00 |      ← mica, $149
100175545 1 1145,470 $1,145.47 |   ← reparación, $1,145.47
```

Las dos líneas se leyeron bien. La detección hizo lo correcto: dijo que el ticket
lleva accesorio **y** reparación, y no decidió. Pero `accExtraer` cogía **siempre
la línea de reparación primero**, sin mirar qué se estaba capturando.

⚠️ **Resultado: el producto del accesorio con el importe de la reparación.** Y
encima con un «la cuenta del ticket cuadra ✓» — cuadraba, pero de la línea que no
era. Guardado así, quedaba **una mica a $1,145.47** en el reporte de comisiones.

Es peor que cualquier fallo del OCR: **no da error, no da aviso, y los números
son reales**. Sólo están en el campo equivocado. Nadie lo ataría a nada al
cuadrar el mes.

**Ahora la línea se elige según lo que se está capturando**, y `accTipo` rehace
los números al cambiar: pulsar «Reparación» trae los de la reparación y
«Accesorio» los del accesorio, del mismo ticket y sin volver a fotografiar. Que
es justo lo que hacía falta para el ticket mixto que motivó el panel de v207.

La prueba comprueba los **dos** tipos sobre el mismo texto: 149 con Accesorio,
1145.47 con Reparación. Verificada devolviendo la prioridad fija: falla diciendo
que está cogiendo la línea de la reparación.

#### El importe, ilegible entero *(24-ago-2026, v224)*

Octava foto. Donde el papel dice `$1,013.20`, el OCR leyó **`SOI`**:

```
100175537 1 1013,200 SOI |
```

Exigiendo el importe se perdía **la línea completa** — y con ella el SKU y el
precio, que estaban **bien leídos**. Ahora el importe es opcional y lo rellena el
`Total`, que en este ticket sí se leyó.

⚠️ **El guardarraíl es lo que sostiene el cambio: sin importe, el precio tiene
que llevar decimales.** Sin esa condición, la línea del pie del ticket
—`1217 2 23/0/26 4:59 PM 33685`, que está en **todos**— pasaría por artículo:
SKU 1217, cantidad 2, precio 23.

Comprobado quitándola: **nueve fallos**, porque esa línea se cuela en casi todos
los tickets y los convierte en «mixtos», que son de los que no se deciden solos.
`1013,200` lleva decimales; `23` no.

#### Ocho fotos, ocho fallos

| foto | qué hizo el OCR |
|---|---|
| 1 | Ruido del borde y rayas entre columnas |
| 2 | Dígito del SKU · punto del precio perdido |
| 3 | Cantidad mudada al renglón de arriba |
| 4 | Importe mal leído · mes cero en la fecha |
| 5 | Dígito en la zona de ceros · coma decimal |
| 6 | Línea partida en dos · SKU irreconocible |
| 7 | Precio mal leído · sin `Total` con el que comprobar |
| 8 | **Importe ilegible entero** (`$1,013.20` → `SOI`) |

Ocho fotos del mismo modelo de impresora y **ninguno de los ocho fallos se
repite**. Cada campo de la línea ha fallado ya al menos una vez —SKU, cantidad,
precio, importe— y en dos ocasiones se fue de línea.

Lo que hace que esto siga siendo capturable es que **el ticket dice cada número
varias veces**: la línea, el `Total`, la línea del IVA, y en letra al pie. Nada
se corrige por parecido — todo se corrige contra otro sitio del mismo papel, y
lo que no se puede comprobar se deja como está y se avisa.

#### El mismo número, dicho tres veces *(24-ago-2026, v223)*

Séptima foto. Ahora el mal leído fue **el precio**:

```
000043739 1 399,000 $999,00 |
```

`999.000` salió `399,000` —un 9 por un 3—, así que la cuenta no cerraba. Y el
`Total` de ese papel **quedó ilegible**, con lo que el desempate de v220 no tenía
con qué trabajar.

Pero el mismo número está una tercera vez, más abajo:

```
I-IVA 16% 861.21 137.79
```

**Base más impuesto: exactamente 999.00.** Ahora, si no hay `Total` legible, se
reconstruye desde ahí.

Se usa **solo** cuando el `Total` falta: cuando está, es más directo, y una suma
de dos números mal leídos daría un total falso con toda la confianza del mundo.

⚠️ **El ticket dice cada importe hasta cuatro veces** —línea del artículo,
`Total`, línea del IVA, y en letra al pie— y esa redundancia es lo que permite
corregir sin inventar. Todo lo que se corrige aquí se corrige **contra otro sitio
del mismo papel**, nunca por parecido ni por lo que suele valer un producto.

#### Siete fotos, siete fallos

| foto | qué hizo el OCR |
|---|---|
| 1 | Ruido del borde y rayas entre columnas |
| 2 | Dígito del SKU · punto del precio perdido |
| 3 | Cantidad mudada al renglón de arriba |
| 4 | Importe mal leído · mes cero en la fecha |
| 5 | Dígito en la zona de ceros · coma decimal |
| 6 | Línea partida en dos · SKU irreconocible |
| 7 | Precio mal leído · sin `Total` con el que comprobar |

Siete fotos de la misma impresora, siete fallos distintos y **ninguno repetido**.
La lista ya no es una anécdota: es la medida de cuánto ruido mete este OCR, y de
por qué cada corrección tiene que apoyarse en otro dato del ticket en vez de en
una corazonada.

#### La línea del artículo, partida en dos *(24-ago-2026, v222)*

Sexta foto, sexto fallo que no se parece a ninguno:

```
10004373
mer 149,000 $149.00 1
```

El SKU quedó **solo en un renglón** y los números en el siguiente. El patrón
pedía todo en la misma línea, así que no encontraba nada: ni SKU ni precio.

Ahora, entre el SKU y el resto se admite ruido que puede incluir **un salto de
línea**: hasta 15 caracteres, y ninguno un dígito ni un `$`. Lo justo para
cruzar el corte sin saltar a una línea lejana y emparejar números que no van
juntos.

⚠️ **Y el SKU quedó irreconocible.** `000043739` se leyó `10004373`: perdió el 9
del final y ganó un 1 delante — **seis dígitos de diferencia**, muy lejos de la
tolerancia de uno. Cuando eso pasa pero en todo el ticket hay **una sola** línea
de artículo, se usa esa: no hay nada que elegir.

**Solo con una.** Con varias habría que acertar cuál, y equivocarse es capturar
el precio de otro artículo. La prueba lleva el mismo ticket con una segunda
línea y verifica que entonces **no** elige — mejor un campo vacío que el número
de otra cosa.

#### Seis fotos, seis fallos, ninguno repetido

| foto | qué hizo el OCR |
|---|---|
| 1 | Ruido del borde (`N`, `NN`) y rayas entre columnas |
| 2 | Dígito del SKU mal leído · punto del precio perdido |
| 3 | La cantidad mudada al renglón de arriba |
| 4 | Importe mal leído · mes cero en la fecha |
| 5 | Dígito en la zona de los ceros · coma decimal |
| 6 | La línea partida en dos · SKU irreconocible |

Seis fotos de la misma impresora, y **cada una rompió algo distinto**. Ninguno de
los seis se deduce mirando el papel: los seis salieron de leer el texto crudo.

Eso es lo que hay detrás de «a veces no lee el precio» — no un fallo, sino seis,
cada uno con su arreglo y su comprobación. Y por eso los seis textos se guardan
en `pruebas/`: es la única forma de que el arreglo del séptimo no rompa los
anteriores.

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

#### Corregir o borrar un ticket de Mr Fix *(6-sep-2026, v230)*

Visto en piso: *«cuando suben un ticket mal del de Mr Fix no se puede borrar, no
se puede modificar»*. Las dos cosas, a elección: unas veces sobra el ticket
entero y otras solo está mal un campo.

**El motivo de fondo no era que faltara la función.** `accesorio_eliminar`
estaba en la base desde el 18-ago y **no la llamaba ninguna pantalla**: después
de guardar un ticket de Mr Fix no había dónde volver a verlo. *Una función que
ninguna pantalla llama es una función que no existe.* De reparaciones no había
ni eso.

```
Captura → 🔧 Mr Fix → 🧾 Lo capturado hoy
      ↓ mrfix_dia(store, token, fecha)     ← las DOS tablas en una lista
   ✏️ accesorio_editar / reparacion_editar
   🗑️ accesorio_eliminar / reparacion_eliminar
      ↓ todo queda en mrfix_ediciones (antes y después)
```

⚠️ **Cinco cosas que, si se deshacen, no dan error:**

1. **El tipo no se corrige editando.** Un accesorio no se vuelve reparación: son
   dos tablas, y esa separación es lo único que impide que una reparación acabe
   en el Excel regional. Se borra y se recaptura, y la pantalla lo dice en vez de
   dejar que se intente. Mismo criterio que `venta_editar` con la procedencia.
2. **La foto solo se borra si no queda nadie que la use.** Un ticket de varios
   artículos son varias filas con el MISMO `captura_id` y **una sola foto**:
   borrarla al quitar la primera línea deja a las demás sin evidencia justo
   cuando se cotejan, y esa evidencia es el motivo de guardarlas 31 días.
3. **`precio × cantidad = importe` se exige también al corregir.** Es cuando más
   falta hace: al corregir se teclea a mano y ya nadie vuelve a mirar el papel.
4. **La fecha se mueve por `vendida_en`, no por `dia`.** `dia` es derivado por
   trigger; ponerlo a mano los desincroniza y el `UNIQUE` deja de proteger sin
   avisar.
5. **`borradas: 0` no es un fallo.** Pudo borrarlo otro o ser un reintento. Se
   dice tal cual —«ese ticket ya no estaba»— en vez de cantar un éxito que no
   hubo.

**Todo queda en `mrfix_ediciones`, con el antes y el después.** Esto toca dinero
de gente de OTRAS tiendas: una línea borrada sin rastro no se puede ni detectar
ni deshacer. Es el mismo argumento de `ventas_ediciones`.

**Y la regla del Excel hubo que rehacerla, porque se apoyaba en los nombres.**
`r_reparaciones_fuera` permitía en esta pantalla una sola llamada,
`reparacion_guardar`. Se quedó corta al añadir corregir y borrar — y ya estaba
corta antes: una lectura llamada `mrfix_dia` trae reparaciones y no lleva
«reparacion» en el nombre, así que **habría pasado sin decir nada**. Ahora se ata
**al dato**: `_repFilas` es lo único de lo que se construye el XLSX, y solo puede
llenarse desde `accesorios_reporte`. Da igual cuántas lecturas de reparaciones
haya en la pantalla; ninguna llega al pegado sin pasar por ahí.

⚠️ La primera versión de esa regla nueva **no cazaba el caso que importa**:
buscaba `accesorios_reporte` «cerca» de la asignación, y la llamada está siete
líneas más arriba, así que cambiar el origen por otra lista la pasaba entera. Se
vio rompiéndola a propósito. Ahora exige que la variable asignada sea **la
misma** que recibió esa llamada.

Lo cubre `pruebas/mrfix_corregir.js`, que mira **la llamada que sale a la red** y
no la pantalla —el único punto donde la decisión ya no se deshace—, comprobada
rompiéndola por tres lados.

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

## Cadena 2-quater · Cada quien ve su comisión *(6-sep-2026, v230)*

Pedido en piso: que cada integrante vea solo la suya, y el gerente las de todos.
Al ir a hacerlo apareció **algo más gordo que lo que se pedía**.

⚠️ **`comisiones_lista(p_store)` no pedía NADA salvo el número de tienda, y
estaba concedida a `anon`.** La clave publicable viaja dentro de
`comisiones.html`, en un repo público. Comprobado con un `curl`, sin sesión y
sin PIN: cuatro filas con nombre completo, venta, garantías e importes. No era
que el equipo se viera entre sí — era que el sueldo del equipo estaba **abierto
a cualquiera que leyera el HTML publicado**.

```
comisiones.html
   ├─ hes_empleado → MI_EMPNO + puesto        ← quién mira
   ├─ comisiones_lista(store, TOKEN, empno)   ← el servidor decide qué devuelve
   │     · gestión → todas   · cualquiera → la suya   · sin token/número → nada
   ├─ soloLoMio_()  ← red del cliente, por las tres puertas de abajo
   └─ localStorage hes<store>_comisiones      ← se reescribe filtrada al abrir
```

**El filtro del servidor no basta, y esa es la parte que se olvida.** Había
**tres** puertas más que devuelven el equipo entero, y cada una sola ya destapa
el dato:

1. **La caché del teléfono.** Está escrita de cuando la pantalla enseñaba a
   todos. Sin filtrarla al abrir, el asesor ve el sueldo de sus compañeros **sin
   red** y para siempre. Se filtra y se vuelve a guardar filtrada, así el dato
   viejo deja de existir en ese teléfono.
2. **El respaldo por Apps Script.** Lee una hoja y no sabe filtrar. Olvidarlo
   dejaba el filtro funcionando solo mientras Supabase contestara — o sea,
   fallando el día raro, que es cuando nadie mira.
3. **El rato entre publicar y pegar el SQL.** La app llama primero a la firma
   nueva; si no existe todavía, PostgREST responde 404 y se cae a la vieja. La
   pantalla funciona en los dos mundos —da igual el orden— pero **hasta pegar el
   SQL el dato sigue viajando al teléfono**, y solo lo tapa el cliente.

⚠️ **Sin número no se enseña NADA.** Pasa cuando se entró con el PIN de la
tienda. «No sé quién eres» no puede acabar en «toma las de todos»: sería el
agujero más fácil de abrir —basta borrar una clave del localStorage—. Se pide
entrar con el número, que es lo que falta de verdad.

⚠️ **Esto es un cerrojo, no una caja fuerte, y conviene no confundirlo.** El
equipo no tiene contraseña propia: se identifica con un número que aparece en
tickets y reportes. Cierra el caso real y cierra la fuga hacia fuera, pero no
para a quien conozca el número del gerente y lo teclee a propósito. La caja
fuerte es que el gerente entre con correo y contraseña; se decide aparte.

**Pegar el SQL basta: no espera a que nadie actualice su celular.** La primera
versión de esto dejaba el `REVOKE` de `comisiones_lista(p_store)` para «cuando
todos estén en v230», y Ángel lo devolvió con la razón correcta: *«eso no debería
importar; cuando yo suba el SQL deberían ver el cambio»*. Lo que hacía falta no
era esperar — era **cerrar la segunda puerta a la vez**.

```
app anterior a v230
   → comisiones_lista(p_store)      ← revocada: ya no contesta
   → respaldo Apps Script (modo=comisiones)
        → hoja «Comisiones», sin recibir desde el 7-ago
        → JULIO, con aspecto del mes en curso   ⛔
```

Se cierra **sin tocar el Apps Script** —decisión de Ángel el 6-sep: *«ya no
quiero trabajar con Apps Script»*—, renombrando la pestaña en el propio Sheet:

```
«Comisiones»  →  «Comisiones_hasta_ago2026»
```

`leerComisiones_` la busca por ese nombre exacto; sin ella devuelve la lista
vacía y la app vieja dice «No llegaron datos nuevos» en vez de pintar julio. Se
renombra y no se borra: el histórico se conserva. **Quedarse sin comisiones un
rato se nota y se pregunta; ver las de otro mes como si fueran de hoy, no.**

Vale la pena quedarse con la forma del arreglo: **un modo del Apps Script se
puede apagar quitándole el dato, sin abrir el editor.** Es la vía para retirar el
resto (ver «Retirar el Apps Script»).

⚠️ Lo único que no se cierra desde el servidor es la copia que cada teléfono ya
tiene guardada. Se borra sola en cuanto esa persona abre la app en v230.

⚠️ **El respaldo del GAS filtra de más, a propósito.** La hoja no trae número de
empleado, así que a un asesor no le casa ninguna fila y se quedaría sin ver la
suya. Es el error correcto de los dos: casar por nombre es exactamente lo que
descuadró las comisiones de agosto, por un apellido con una letra de más.

`PUESTOS_GESTION_C` es la **tercera** copia de la misma lista de puestos
(tablero, horarios, comisiones): estas pantallas no comparten ningún `.js`.
`r_puestos_gestion` compara ya las tres.

Lo cubre `pruebas/comisiones_solo_mia.js`, comprobada rompiéndola por los cuatro
lados: la caché sin filtrar, la respuesta sin filtrar, todos pasando por
gerentes, y el número sin mandar.

## Cadena 2-quinquies · La cotización *(6-sep-2026, v230)*

Pedido en piso: *«estamos vendiendo un reloj, selecciona el reloj más la
garantía; pero también quiere un teléfono… y va haciendo la suma. No se va a
cobrar desde ahí, solamente necesito que se puedan sumar varios artículos y le
podamos dar el precio al cliente»*.

**Suma y nada más.** No cobra, no aparta, no toca inventario y no sube nada a la
nube. Lo que sustituye es la calculadora del celular, donde lo que se pierde es
un seguro que no se sumó o un precio tecleado de otro producto.

```
segSelector()  → chips «Sin seguro / 1 año / 2 años»  +  ＋ Sumar
      ↓ cotAgregar() lee EL CHIP ACTIVO del bloque
   COT[]  → barra fija con el total  → panel con las líneas
      ↓ localStorage hes1217_cotizacion
```

⚠️ **Cinco cosas que, si se deshacen, no dan error:**

1. **El seguro se lee del CHIP ACTIVO, no de una copia.** El DOM es el estado que
   ve el asesor; con una variable aparte, tocar «1 año» y que la copia no se
   enterara sumaría sin garantía sin que nada lo dijera.
2. **El botón vive DENTRO del selector de precio**, no suelto en la tarjeta. Lo
   que se suma es «este producto con lo que esté elegido ahí»; separarlos invita
   a elegir garantía en un sitio y sumar en otro.
3. **Cada línea guarda su total ya hecho.** Así quitar una línea se lleva su
   seguro con ella. Sumando bases por un lado y seguros por otro, quitar un
   artículo dejaría su garantía en la cuenta.
4. **«+1 año» se dice «protege 2».** El contratado se suma al de fábrica, y así
   se le explica al cliente. Decir «1 año» a secas es vender de menos lo mismo
   que se cobra. El texto se arma en un solo sitio (`cotTextoSeguro`) para que
   las dos formas no se separen.
5. **Sin precio no hay botón.** Un «＋ Sumar» sobre un producto sin precio
   registrado mete un cero en la cuenta del cliente.

**Sobrevive a recargar la app, a propósito**: se arma con el cliente delante y
basta una notificación para perderla. Es del teléfono y de nadie más — aquí no
hay dato de la tienda que proteger, son precios que ya se le dijeron al cliente.

El panel dice **lo que esto NO es**: «no aparta piezas ni registra la venta». Un
total en pantalla con el cliente delante se confunde con una venta hecha, y de
aquí no sale ningún apartado ni se descuenta ninguna pieza.

Lo cubre el bloque 11 de `casos_tablero.js`, comprobado rompiéndolo por cuatro
lados —ignorar la garantía elegida, no leer el chip activo, callar los años que
protege, y ofrecer sumar sin precio—.

### Los MSI de la cotización salen del TOTAL *(10-sep-2026, v234)*

Pedido en piso: *«en la cotización no aparecen los msi»*.

**Es donde más valen, y por eso esconderlos costaba ventas.** Los plazos se
alcanzan por importe, y el importe de la cuenta entera es mayor que el de
cualquier artículo suelto:

```
WATCH FIT 5 con garantía   $5,048   → solo 6 MSI
+ PURA 80 PRO             $24,999
  ────────────────────────────────
  TOTAL                   $30,047   → 18 MSI · $1,670/mes
```

El asesor tenía el argumento delante y la pantalla no se lo decía.

⚠️ **Los umbrales viven en `msiPlazos` y en ningún otro sitio.** Estaban
copiados en dos —el badge de la tarjeta y el WhatsApp del producto— y la
cotización habría sido la tercera. Con tres copias, mover el mínimo de 6 MSI se
hace en dos y el que falta **no da error**: solo deja de ofrecer meses que el
cliente sí tiene. `msiInfo` se reescribió encima y sigue enseñando lo mismo —los
dos plazos más largos, el mayor primero, el banco solo en los 18—.

⚠️ **Se repinta en cada cambio, no al abrir.** Quitar una línea puede bajar el
total por debajo de un umbral, y unos MSI heredados de la cuenta anterior serían
meses ofrecidos que el cliente ya no tiene.

En el mensaje de WhatsApp van **todos** los plazos, no los dos más largos: ahí
no hay tarjeta estrecha que obligue y el cliente elige. El asterisco del 18
lleva su nota con los bancos — un asterisco sin nota es una restricción que el
cliente no puede leer.

Lo cubre el bloque 12 de `casos_tablero.js`, comprobado rompiéndolo por cuatro
lados: sin pintar el panel, sin MSI en el mensaje, enseñando un solo plazo en el
badge, y pintando una vez sin refrescar.

⚠️ **Lo que sigue abierto:** los CEA dan los MSI **por SKU** (el 267 da 9 y 6 al
Watch GT6 de $2,999, donde la regla por importe solo ofrece 6). `carga_promos`
guarda ese dato en `promos.msi` y **el tablero no lo lee en ninguna parte** — se
captura y se tira. Mientras siga así, la app ofrece de menos en unos productos y
podría ofrecer de más en otros.

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

### El precio a cobrar era el que la promo venía a bajar *(10-sep-2026, v232)*

El **CEA 265 PROMOCIONES EOL SEPTIEMBRE 2026 3ER BLOQUE** trae dos columnas de
promoción en el mismo renglón: `PROMOCIÓN ANTERIOR` y `PROMOCIÓN NUEVA`.
`_ceaPrecios` buscaba la de cobrar con `/NUEVA\s*PROMO/i` —la **frase** del CEA
257, "NUEVA PROMO"—, que **no casa con las mismas dos palabras al revés**. Sin
casar, caía al comodín `/PROMO/` y ahí ganaba `PROMOCIÓN ANTERIOR` por venir
antes en el renglón.

```
CEA 265, Pura 80 Ultra:   regular $39,998 · anterior $31,999 · NUEVA $23,698
                                              ↑ se leía esta
```

⚠️ **Dos columnas de promo es lo normal, no la rareza.** Todo CEA que quiera
enseñar la rebaja pone el precio viejo al lado del nuevo. Por eso no basta con
acertarle al título: hay que saber **cuál de los dos es el viejo**, y eso es
`_CEA_PROMO_VIEJA` (`ANTERIOR|ACTUAL|VIGENTE|PREVIA`). El orden de las palabras
de un encabezado no puede volver a decidir cuánto se cobra.

El último `find` vuelve a admitir las columnas viejas **a propósito**: un CEA
cuya única columna de promo se llame `PROMO ACTUAL` tiene ahí el precio a
cobrar, y quedarse sin precio es peor que quedarse con ese.

⚠️ **Esto es el lector compartido: toca Promos igual que EOL.** El fallo no era
solo de los EOL — cualquier CEA de promociones con esas dos columnas cobraba el
precio anterior.

Lo cubre `pruebas/cea_precio_nuevo.js` con los tres renglones reales del CEA
265, el 257 al derecho, un PRICE MATCH con columna DESCUENTO y un CEA de una
sola promo. **Comprobada rompiéndola**: con el bloque `pp` original vuelven los
seis fallos con las cifras del comunicado.

### Un CEA de lanzamiento no dice "Vigencia:", y se perdía entero *(17-sep-2026, v244)*

El **CEA HUAWEI 269 LANZAMIENTO WATCH GT 7 Y GT 7 PRO** (10-sep) se cargó por
Promos y **no se guardó ni una de sus 11 filas**. El lector las leyó perfectas
—SKU, descripción, $8,999 → $6,999, los MSI—; lo que faltó fue la fecha.

`_ceaVigencia` sólo entendía la frase `Vigencia: X al Y de MES de AÑO`, y un CEA
de **lanzamiento no la trae**: el precio nuevo no tiene término anunciado. Lo
único fechado del 269 es `"Las promociones se verán reflejadas en punto de venta
a partir de 11 de septiembre 2026"`. Sin `d2`, `carga_promos` descarta por
`vigente_hasta IS NOT NULL` y `promos_vigentes` no devuelve nada: **seis días
cobrando $8,999 donde el CEA manda $6,999, en 11 SKU.**

⚠️ **El 269 es el raro, no la regla.** Comprobado en Chrome con la misma pdf.js
que carga la página: el 223, el 265 y el 267 **sí** traen su `Vigencia:` y se
leen bien. Sólo los CEA de lanzamiento caen por aquí.

⚠️ **Un CEA trae varias "a partir de" y sólo una es de precio.** El 269 tiene
tres: *10 de septiembre* (venta exclusiva) y *17 de septiembre* (venta al
público) son de **disponibilidad**; la de **punto de venta** —11 de septiembre—
es la única que dice desde cuándo la caja cobra la promoción. Tomar una de
disponibilidad promete un precio que el POS todavía no da. Por eso el regex
exige `punto de venta` y un **día** en la misma oración.

Y por eso mismo sólo corre si no hubo `Vigencia:`: un comunicado puede traer las
dos frases, y entonces manda la ventana. *(Al CEA 223 no lo salva ese guard sino
el regex —su frase de punto de venta dice "a partir de la fecha de inicio de
cada vigencia", sin día—; el guard cubre el caso de las dos frases, y las dos
cosas están probadas por separado.)*

⚠️ **La fecha de FIN no se inventa.** La escribe el gerente en los dos campos
nuevos de la pestaña Promos, precargados con lo que el PDF sí trajo. Mientras
falte, **el botón de subir se queda apagado**: "sin fecha de fin" ya significó
una vez "vigente para siempre" y se cobraron promociones terminadas.

⚠️ **Y la pantalla daba el fallo por bueno.** Con `promos: 0` caía a un mensaje
**verde** —"Enviado (11 promos, 0 EOL)"— que contaba las **leídas del archivo**,
no las guardadas. Ahora cero guardadas es rojo y dice por qué; y si entran unas
sí y otras no, el conteo de las que faltan se queda en pantalla en vez de irse
con el toast.

Lo cubre `pruebas/cea_vigencia.js` con los textos reales de los cuatro CEA
(tal como los parte pdf.js: `"3 0 de septiembre"`, `"202 6"`) y con el
comportamiento de la pantalla. **Comprobada rompiéndola**: quitar el camino
nuevo, dispararlo siempre, armar el botón sin fecha de fin o inventar un `d2`
—los cuatro cebos fallan con su cifra.

⚠️ **Lo que esto NO arregla, y sigue abierto:** que el precio leído llegue a la
tienda. `saveEolFromPdf` manda `r.pr` —el **PRECIO REGULAR**— a `eol_guardar`, y
`eol_precio_venta` lo divide entre dos. Así que en el Pura 80 Ultra la tienda
calcula $19,999 cuando el CEA manda cobrar $23,698. Ver «El CEA 265 no es un CEA
189» abajo.

### El CEA 265 no es un CEA 189, y entraban por la misma puerta *(10-sep-2026, v233)*

Dos comunicados distintos comparten la palabra EOL y el tablero los metía por la
misma puerta, porque `parseEolPDF` deduce el estatus **del título**:

| | CEA 189 · *Listado de artículos EOL* | CEA 265 · *Promociones EOL* |
|---|---|---|
| Columnas | SKU · DESCRIPCIÓN · ESTATUS | + REGULAR · ANTERIOR · NUEVA · 18/12/9/6 MSI |
| Precio | **no trae** | lo dice, explícito |
| Regla | última pieza de **exhibición** al 50% | precio nuevo para **el SKU**, ajuste manual en POS |
| Vigencia | mientras haya pieza | fechas (7 al 30 de septiembre) |
| Assurant | **pierde** elegibilidad | el CEA **no dice** que se pierda |

⚠️ **Lo de Assurant es lo que más caro sale.** Marcar un CEA 265 como EOL le
dice al equipo que ahí no se vende seguro, y eso pega directo en el KPI crítico
—attach >25%— sobre ocho SKU de la serie que más se mueve.

⚠️ Y los MSI: el 265 dice **por SKU** cuáles aplican. El Pura 80 6.6" a $8,890
lleva 9 y 6 MSI, y la regla genérica de `msiInfo` —por importe— solo ofrecería 6
por estar debajo de $10,000. La pestaña de Promos ya guarda los MSI del
comunicado; la de EOL no.

**Cómo quedó:** la pestaña de EOL detecta que el comunicado trae precio de
promoción (`_eolFilasConPromo`: alguna fila con `pp`) y **no deja guardar**.
Avisa con las cifras de verdad —«en el SKU 100269138 aquí cobrarías $19,999 y el
CEA manda $23,698»— y manda a Promociones, que ya guarda precio, vigencia y MSI
sin tocar SQL.

**El camino bueno sigue abierto**, y esa es la mitad que importa: el listado 189
no trae precio, así que entra igual que siempre. Un aviso que frenara también al
189 dejaría a la tienda sin poder marcar un EOL.

⚠️ **`carga_promos` no escribe en la tabla `eol`**, aunque Admin diga «N
productos EOL guardados en la nube automáticamente». Los deja en `promos` con
`estatus='EOL'`. El texto miente desde antes de esto y **sigue ahí**: si algún
día hace falta que un CEA de promos marque además el SKU como no resurtible, hay
que escribirlo, no darlo por hecho.

**Lo que sigue abierto de aquí:** `eol_guardar` responde `existe` y **no toca
nada** si el SKU ya estaba, así que un 189 repetido nunca refresca el precio
heredado del catálogo. Distinguir el precio heredado del puesto a mano lleva SQL.

Lo cubre `pruebas/cea_precio_nuevo.js` (bloque 6), comprobado quitando el
guardián: vuelven los seis fallos, con el panel abierto y las tres filas armadas.

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

### El cero del agotado se llevaba la pieza de piso *(17-sep-2026)*

Tres reglas, que en piso son una sola:

1. El **reporte de exhibición es la foto completa** del piso, y se sube cada vez
   que entra mercancía nueva al aparador.
2. **EOL con el On Hand en cero, pieza exhibida y una venta** → esa venta *es* la
   de exhibición, y el tablero la descuenta solo. No hay casilla que marcar:
   cuando no queda bodega, la casilla ni aparece —el 50 % se aplica automático
   (`EOL_VENTA` en captura_series.html)—, así que **el descuento automático es
   la única vía que hay**.
3. **Lo que no es EOL no vende su pieza de piso.** Con el On Hand en cero, una
   venta es un equipo de traspaso o del CEDIS que el informe aún no refleja. El
   aparador no se toca.

Hasta el 17-sep el excedente sobre el On Hand se le cobraba al aparador de
*cualquier* artículo (rompía la 3), y además lo hacía sobre un corte viejo:

```
vendido     = ventas − corte           corte viejo  →  vendido > 0
exh_vendida = exh_marcada + greatest(0, vendido − onhand)
onhand = 0  →  ventas de bodega de días pasados se leen como piezas de aparador
```

Porque desde el 5-sep `carga_catalogo` pone en cero el On Hand de lo que ya no
viene en el informe —correcto— pero **no retomaba su corte**. Así, el descuento
de la regla 2 dejaba de ser «una venta después de que la bodega quedó vacía» y
pasaba a ser «todo lo vendido desde hace semanas»: **el aparador se vaciaba solo
al agotarse el almacén**. No da error, porque el stock sí queda bien —cero es
cero— y lo roto es el lado que solo se sube de vez en cuando, el que no se
corrige con el informe del día siguiente.

Encontrado en piso con el **Watch Fit 4 1.82" NG (100259554)**: pieza de piso
puesta, artículo EOL, y el tablero decía «ya no». `onhand 0 · vendido 3 ·
exhibición 1 · exh_vendida 3` — las tres ventas salieron de las tres cajas que
hubo en bodega. Había **36 SKU con el corte huérfano**, 13 con pieza de piso y 4
EOL sin su remate.

Tres cambios, cada uno en su sitio:

| Dónde | Qué |
|---|---|
| `inventario_vivo` (`supabase_venta_exhibicion.sql`) | el excedente pasa por un `CASE`: solo lo paga el aparador de un EOL **no pausado** |
| `carga_catalogo` (`supabase_cargas_admin.sql`) | el `UPDATE … onhand = 0` es ahora un CTE que devuelve los SKU y les reescribe el corte con `corte_tomar_`, en la misma transacción |
| `carga_exhibicion` (íd.) | la foto del piso retoma también el corte de On Hand **de los que trae con On Hand en cero**: una medición manda sobre una deducción, y sin esto reponer la exhibición de un EOL agotado no serviría de nada |

Los 36 de hoy no se arreglan solos —el `UPDATE` solo toca los que tenían On Hand
distinto de cero—, así que se repararon una vez con `supabase_corte_agotados.sql`,
que retoma el corte **solo hasta la última subida del informe**: las ventas
posteriores a ese momento sí son el descuento de la regla 2 y no se borran.

En el tablero la segunda barrera sigue en pie: `finalizarStock` resta
`exh_vendida` únicamente en los EOL, así que un SQL viejo sin pegar no puede
vaciar el aparador de un producto activo. Las dos direcciones están fijadas en
`pruebas/casos_tablero.js` (SKU 900008 y 900009), comprobadas con cebos.

Reparar hacia atrás tiene un precio, y se pagó *(19-sep-2026)*. Retomar el corte
también borra la señal de las piezas de piso que **ya se habían vendido sin
marcar**: para el sistema esas ventas eran el excedente, y al recortar vuelven a
ser de bodega. La reparación devolvió 13 piezas de piso y Ángel las cotejó
contra el mueble: el Watch Fit 4 NG estaba, pero el **Watch GT6 41 mm BN
(100274973)**, la **MatePad Pro 13.2" DO (100250576)** y el **Watch Kid AZ
(100074525)** no — `onhand 0 · vendido 0 · exhibición 1`, sin ninguna venta que
descontarles. Se corrigen por donde vive el dato equivocado, que es cuántas
piezas hay exhibidas: **subir el reporte de exhibición**, que pone en cero lo
que no viene y retoma los cortes. Por eso la comprobación 3 de
`supabase_corte_agotados.sql` se lee con el aparador delante y no desde el
escritorio: es la única que ningún SQL puede contestar.

### Una pausa que solo conocía una app *(19-sep-2026)*

Comercial puede detener el remate de un EOL. Esa pausa vivía en una constante de
`tablero.html`:

```js
const EOL_PAUSADOS = new Set(['100280724']);  // pendiente autorizacion
```

y solo escondía **una** de las tres puertas por las que ese producto se ofrece:

| Puerta | Qué hacía con el MatePad 11.5" VD+TCL |
|---|---|
| Sección EOL del tablero | lo escondía — la única que respetaba la lista |
| Buscador (`estadoSku`) | lo daba en `50`: «última pieza de piso, 50%» |
| Captura de Series | lee `eol_precio_venta` y **ponía el precio a la mitad solo** |

Las tres leen el mismo producto y dos no sabían de la pausa. **Una regla escrita
en un cliente no es una regla**: es una regla de ese archivo. La captura ni
siquiera tenía de dónde enterarse — no importa la app, `eol_precio_venta` no
distinguía porque en la tabla `eol` el SKU nunca se pausó.

Ahora la pausa es un dato, `eol.pausado`, y cada quien la lee de ahí:

- `eol_precio_venta` ya filtraba `NOT e.pausado` → la captura queda cubierta sin
  tocarla.
- `eol_lista` **deja de filtrar** y devuelve la columna `pausado`. Filtrarla era
  lo que obligaba a la lista del cliente: sin la fila, el tablero no sabía que
  el SKU era EOL, lo sacaba de `eolSkuSet` y lo mandaba a **Resurtir** —«pedir
  caja»— de un producto descontinuado del que no va a llegar ninguna.
- `tablero.html` filtra la sección EOL por `e.pausado`, y `estadoSku` devuelve
  `piso` («en piso, en pausa») en vez de `50`.
- `admin.html` lista los pausados con la etiqueta **EN PAUSA**. Antes no
  aparecían en ningún lado: la pausa los volvía invisibles hasta para quien
  tenía que administrarlos.

Ser EOL y estar detenido son dos cosas distintas, y el error fue meterlas en el
mismo `NOT e.pausado`. Para detener o soltar uno:

```sql
update public.eol set pausado = <bool> where store_id='1217' and sku='...';
```

Fijado en `pruebas/casos_tablero.js` con el SKU 900010 y comprobado con dos
cebos: quitar el filtro de la sección EOL y quitar la rama de `estadoSku` hacen
fallar la suite por separado.

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

### La preventa se abre y se termina sin deploy *(17-sep-2026, v247)*

Lo de arriba describe cómo era hasta hoy, y **por qué tenía que cambiar**: la
preventa era código. Para abrirla había que editar `const PREVENTA` en
`tablero.html`, correr `preventa_cupo_gen.py`, pegar el SQL y publicar; para
cerrarla, otra vez lo mismo.

**Lo que costó (5-sep-2026).** Un cliente quiso apartar un PURA 90S PRO MAX NJ y
la app contestó «Cupo agotado: 6 de 6 piezas ya apartadas». Los 6 llevaban
semanas **entregados**: `apartado_cabe` cuenta todo lo que no esté Cancelado, así
que el SKU se bloqueó *justamente por haberse vendido bien*. Y quitarle el tope
no estaba en ninguna pantalla.

```
Admin · 🎁 Preventa ──► carga_preventa      ┐
                   ──► preventa_terminar    ├──►  tabla `preventa_cupo`
                                            │      (producto, precio, cupo,
tablero.html · cargarPreventaNube           │       activa)
   └── preventa_lista ──► PREVENTA ──► sección 🎁 + botón de apartar
                                            │
                       apartado_cabe  ◄─────┘   el tope, solo si `activa`
```

Tres decisiones, con su motivo:

- **El cupo sigue contando los entregados.** No se cambió la cuenta: el cupo es
  cuántas piezas tiene asignadas la tienda, y una entregada ocupó su lugar de
  verdad. Lo que faltaba era poder decir *«ya terminó»* — eso es `activa`.
- **`cupo` puede ser NULL, y NULL no es cero.** Preventa abierta sin tope es el
  caso normal antes de que el corporativo reparta piezas. En pantalla se dice con
  palabras («sin límite» / «SIN CUPO»), no con el número: pintados igual, uno
  bloquea y el otro no, y no habría error que lo delatara.
- **`producto` y `precio` viven en la fila.** Un equipo en preventa no está en el
  catálogo ni en el inventario —ese es el caso—, así que sin esos dos datos no
  hay con qué dibujar la tarjeta, y sin tarjeta no hay dónde apartar.

**La preventa viaja en su propia llamada**, no dentro de `tablero_todo`. Meterla
ahí obligaba a redefinir `tablero_todo` en el .sql de la preventa, y entonces la
misma función queda escrita en dos archivos: el día que alguien repegue el otro,
la sección desaparece sin un solo error. Cuesta ~0,2 s en paralelo y a cambio la
función sigue estando en un solo sitio.

El botón de apartar de esta sección **no** pasa por `botonApartar`. Aquél decide
por existencia (solo `traer` y `piso`), y en preventa eso daría los dos errores
opuestos: dejaría apartar sin mirar el cupo, y dejaría de ofrecerlo el día que
llegue el embarque — que es cuando más se aparta.

`preventa_cupo_gen.py` y la regla `cupo` de `verificar.py` quedan por si alguien
vuelve al camino viejo; el camino vivo es Admin. Las nueve comprobaciones nuevas
de `pruebas/casos_tablero.js` cubren lo que no da error al romperse: la tarjeta
de un SKU que no está en el inventario, el agotado sin botón, el sin-límite con
botón, y que sin preventa la sección no exista.

**Lo que NO se probó:** abrir y terminar contra la base de verdad. Requiere el
token bueno de la tienda, y una preventa de mentira en `1217` la habría visto el
equipo en su tablero.

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

### Cada quien ve su horario *(6-sep-2026, v230)*

Pedido en piso: el equipo ve **solo su semana**; el gerente y el subgerente, la
de todos.

```
empleados.puesto (Supabase)
   ├─ login_empleado → emp_puesto      ← URL suelta
   └─ hes_empleado.puesto              ← heredado del tablero
        ↓ fijarSesion({ puesto })
   _verTodo = _puedeEditar || esPuestoDeGestion_(puesto)
        ↓ veElEquipo_() lo consultan LOS CINCO:
   tarjetas del resto · botón «Ver tabla completa» · la tabla ·
   el pie de descansos · verTablaCompleta()
```

**Cinco sitios, un solo portero.** Es la misma forma que `seccionVisible_` en el
tablero, y aquí el que menos parece es el que más se olvida: **el pie de
descansos fijos nombra a todo el equipo** —horario ajeno dicho de otra manera— y
no tiene aspecto de tabla.

⚠️ **Cuatro cosas que, si se deshacen, no dan error:**

1. **`_verTodo` NO es `_puedeEditar`.** Quien entra con su número no edita, pero
   el subgerente sí lleva la tienda. Atarlas le daría una vista distinta según
   entrara con su número o con su correo: la misma persona, el mismo puesto,
   distinta puerta. Es el fallo de `hoja_auth` y el de `vincular_mi_cuenta`, por
   tercera vez.
2. **La tabla no se esconde: no se ESCRIBE.** Taparla por CSS deja el horario de
   los demás dentro del HTML, a un «inspeccionar» de distancia. Y hace falta
   además `body.solo-mi-horario`, porque en la tablet de piso o en la
   computadora de la trastienda la tabla se ve sin pedirla — sin esa clase,
   «solo su horario» dependería del ancho del aparato.
3. **`verTablaCompleta` lleva su propia guardia.** Es global: sin ella,
   teclearla en la consola —o un botón que quede pintado de una versión en
   caché— abre la tabla del equipo entero.
4. **Quien no se reconoce ya no ve una pantalla en blanco.** Ese hueco lo abre
   este mismo cambio: antes, un número que no casaba con ninguna ficha veía
   igual el horario de todos. Ahora se le dice qué falta y quién lo arregla —una
   pantalla vacía se lee como «la app no sirve», no como «falta un dato».

⚠️ **Esto le esconde el horario al asesor; no se lo oculta a quien sepa mirar.**
`horario_equipo` sigue devolviendo el JSON del equipo entero, así que el dato
baja al teléfono aunque no se pinte. Filtrarlo en el servidor obliga a partir el
RPC —y con él el respaldo y el restaurar del gerente, que leen esa misma
estructura—. Se eligió a sabiendas: es el mismo trato que la cadena 1-bis.

**`PUESTOS_GESTION_H` está escrita dos veces a propósito**, aquí y en
`tablero.html`: este archivo se publica también en `planeador-odemas`, donde no
existe nada del 1217 de donde importarla. Que no se separen lo vigila
**`r_puestos_gestion`**, comprobada por los dos lados. Si se separaran, ascender
a alguien le abriría el tablero y no el horario —o al revés— y nadie ataría el
síntoma a dos listas distintas.

Lo cubre `pruebas/horario_solo_mio.js`, comprobada rompiendo las **cinco**
superficies una por una. Mira lo que se ESCRIBIÓ en cada sitio, no lo que se ve.

### Las tareas de piso *(19-sep-2026, v252)*

Lo que pasaba antes: barrer, limpiar mesas, lavar el sanitario y ordenar bodega
se repartían de palabra —y de palabra también se perdían: nadie podía decir si
el baño ya se había lavado esta semana—. El pedido de piso fue un checklist que
**se reparta solo**, leyendo el horario, para que no le caiga el sanitario a
quien descansa ni «limpiar pantallas» a quien entra a las 12:30.

```
generarSemana() → dias[día][persona]        (el horario que ya se pinta)
        ↓
repartirTareas(dias, semana) → _reparto     (determinista; NO se guarda)
        ↓
panel «Tareas de la semana» · tarjetas móviles · fila «Tareas» de la tabla
        ↓  palomita
tareas_hechas (Supabase)  ← lo ÚNICO que se guarda
```

**El reparto no se guarda, se deriva.** Misma semana + mismo horario = mismo
reparto en todos los teléfonos. Guardarlo sería una segunda verdad que se
desincroniza con el horario en cuanto alguien pida vacaciones y el planeador
mueva los turnos: el tablero diría una cosa y el checklist otra, y ninguna de
las dos avisaría.

El catálogo (`CATALOGO_TAREAS`) y las reglas del motor:

| Tarea | Cada | Quién |
|---|---|---|
| Barrer y trapear piso | diaria | la gerencia que **abre** ese día |
| Limpiar mesas y pantallas | diaria | el apoyo + el asesor que **abre**; el día que el apoyo no viene, el asesor solo |
| Limpiar sillas | diaria | el apoyo + el asesor que **esté** ese día, abra o no *(21-sep-2026)* |
| Lavar sanitario | semanal | rueda: gerentes, asesores y el apoyo |
| Orden y limpieza de bodega | semanal | rueda propia, el apoyo incluido |

Las sillas van **con las mesas y no en la rueda semanal**: el cliente se sienta
en ellas todos los días. Su icono es 💺 y no 🪑 a propósito — 🪑 ya es la Ley
Silla en la tarjeta del celular, y dos cosas distintas con el mismo dibujo en la
misma tarjeta se leen como una sola.

⚠️ **Pero no son de apertura, y las mesas sí.** Nacieron iguales, y el hueco solo
se vio con el horario de verdad puesto: los días en que queda un solo asesor y
entra a las 12:30, mesas Y sillas caían **en el apoyo sola**, con el asesor en la
tienda toda la tarde y su panel sin ninguna de las dos. Una silla se limpia a
cualquier hora; una pantalla, antes de que entre el primer cliente. De ahí sale
`momento: 'presente'`, que es lo contrario de `'apertura'`: no *quien abre*, sino
*quien está*.

**Y por eso hay `yaEseDia`.** El índice de las dos diarias sale de `semana + d`,
el mismo para ambas: sin repartir a propósito caen SIEMPRE en la misma persona y
el otro asesor pasa el día sin ninguna — un reparto que se ve impecable y carga a
uno solo. Cada diaria prefiere a quien no lleve otra ese día, y solo repite
cuando no queda nadie más. **Depende del orden del catálogo**: lo de apertura va
antes, así que cuando llegan las sillas las mesas ya tienen dueño. Al revés se
repartirían igual de bien, pero las mesas dejarían de caer siempre en quien abre.

⚠️ **Seis cosas que, si se deshacen, no dan error:**

0. **Las dos semanales no pueden caer en la misma persona.** Sanitario y bodega
   ruedan las dos (la bodega dejó de ser «todo el equipo junto» el 20-sep-2026),
   y girando igual le tocarían LAS DOS a la misma persona cada semana mientras
   el resto no hace ninguna: una rotación que no rota. Por eso la rueda da dos
   pases —el primero salta a quien ya lleva una semanal; el segundo admite
   repetir, porque con media plantilla de vacaciones dejar la bodega sin dueño
   es peor—. Probado con cebo: sin el primer pase, las 20 semanas colisionan.

1. **Lo de apertura va a quien abre, sin excepción.** Cuando nadie del grupo que
   le toca abre ese día, la tarea pasa a **quien sí abra, del grupo que sea**; si
   no abre nadie, se queda sin dueño a propósito. El respaldo anterior era «quien
   esté presente», y eso puso «limpiar mesas» sobre un turno de cierre
   12:30–21:00 —justo lo que se pidió evitar—. La prueba tampoco lo cazó, porque
   se saltaba ese caso.

   **Y `momento` es por tarea, no del módulo** *(21-sep-2026)*. «Presente» no
   volvió como respaldo de las de apertura —eso sigue prohibido, y es lo de
   arriba—: volvió como el momento propio de las sillas, que no se hacen antes de
   abrir la cortina. Las dos reglas conviven porque dicen cosas distintas de
   tareas distintas; juntarlas otra vez en una sola es el fallo original.
2. **Al asesor no se le nombra a nadie.** El panel dice `te toca` / `un
   compañero`, nunca un nombre: decir «el jueves le toca a DANI» es horario
   ajeno dicho de otra forma. Es la sexta superficie de la política del
   6-sep-2026, y `quienesTexto_()` es su portero.

2-bis. **Y desde el 20-sep-2026 el asesor ve SOLO lo suyo, pero TODO lo suyo.**
   No nombrar a nadie no bastaba: el panel listaba la semana entera y se leía
   «Lavar sanitario · jueves · un compañero» —el pendiente de otro puesto en la
   lista de este, y desde el piso no se distingue cuál de las seis líneas es la
   de uno—. `renderTareas()` filtra a las tareas donde él aparece, y la nota al
   pie del apoyo queda solo para gerencia.

   Lo suyo se le pinta **día por día, la semana completa**, con hoy en rojo:
   recortarlo a hoy fue un paso de más de mi parte y él lo corrigió —saber el
   lunes que el jueves le toca el sanitario es poder organizarse—. Verla entera
   no es poder palomearla entera: lo de más adelante sale con la casilla
   apagada (`esFuturo_`, y el `title` dice «se marca el jueves»), porque una
   tarea marcada tres días antes es una tarea que nadie hizo y el checklist se
   leería al día con el piso sin barrer. Hacia atrás sí se puede: de algo hecho
   a las 9 nadie se acuerda de la palomita hasta las 8. Gerencia no pasa por
   ese freno —es quien valida— y sigue con «hoy + lo semanal», que su panel es
   para revisar el día, no para leer 16 líneas.

   **El filtro va en lo que se pinta, no en el motor**: el reparto sigue siendo
   idéntico para todos, que de eso vive que no haya dos verdades. Lo comprueban
   cuatro pruebas que leen los `data-tarea`/`data-dia` y el `disabled` de cada
   casilla pintada, no el texto. Los cuatro cebos: sin el filtro, al asesor le
   llegan cuatro tareas ajenas; recortado a hoy, le faltan dos suyas; sin
   `esFuturo_`, puede marcar el viernes desde el domingo; y devolviendo la nota
   del apoyo, reaparece el pendiente de alguien más.
3. **El apoyo sí lleva nombre, y solo cuando la tarea es suya.** Quien limpia y
   no está en el planeador no tiene tarjeta donde aparecer, así que va en una
   nota al pie. Solo para lo que hace sola: en la bodega también participa, pero
   ahí la nota («esta semana le toca a Fulana») haría entender a los demás que
   esa semana no van.

   **Y el apoyo SÍ puede tener número de empleado** *(21-sep-2026)*. Todo esto
   se escribió sobre «el apoyo no tiene con qué entrar», y era falso: el apoyo
   de la 1217 tiene ficha activa y entra al planeador con su número como
   cualquiera. Entraba y veía **dos cosas falsas a la vez**: el cartel *«no
   encontramos tu horario — tu número no coincide con ninguna ficha»* —su alta
   está bien, solo que en otra tabla— y un panel que decía *«esta semana no te
   toca ninguna tarea»* mientras el reparto le daba las mesas los seis días que
   viene. Sus tareas viven en `externos` y el filtro del panel solo miraba
   `quienes`. **Ni un solo error a la vista: el reparto estaba bien, lo que
   estaba mal era a quién se le enseñaba** — la misma forma que las dos puertas
   de la cadena 1-ter, por cuarta vez.

   Cómo quedó: el `#Emp` se captura junto al nombre y el descanso, y es
   **opcional**. Con él, esa persona ve su semana y palomea lo suyo igual que el
   asesor —el servidor nunca puso pegas: `tarea_marcar` solo pide que el número
   esté activo en `empleados`—. Sin él, todo sigue como antes.

   ⚠️ **`miClaveTareas_()` no es `quienSoy()`, y no pueden juntarse.**
   `quienSoy()` responde «qué tarjeta del planeador es la mía» y tiene que
   seguir devolviendo `null` para el apoyo, porque quien la llama hace
   `EQUIPO[yo]` y una clave `@fulana` no existe ahí. La nueva responde «qué clave
   del reparto soy». Si el mismo número estuviera en las dos partes, **gana la
   ficha del planeador**: es quien tiene turno, y de ahí cuelgan sus tareas de
   apertura.

   ⚠️ **Y con número, su palomita deja de ser de cualquiera.** El permiso
   «cualquiera del equipo marca lo del externo» existía porque, sin ficha, una
   palomita que nadie puede poner es una tarea que siempre se ve pendiente. En
   cuanto hay número, ese permiso se cierra: queda en ella y en gerencia. Sin
   número sigue abierto, o volvería el problema que vino a resolver.

   Su tarjeta del celular lleva **«EN TIENDA» / «DESCANSO»** y no un turno: de
   esta persona se capturaron días, no horas, e inventarle un horario sería
   decirle a qué hora entrar. Las tareas salen de `tareasDe_`, el mismo reparto
   que leen el panel y la tabla del gerente.

   **Su nombre se captura en Admin → Equipo y vive en `horarios_config`**, no en
   el código: los dos repos donde se publica este archivo son públicos, y el
   nombre lo cazó la regla `datos` de `verificar.py` el día que se escribió esto.
   En el catálogo solo queda la bandera `conApoyo`. Si no hay nadie capturado,
   el reparto sigue en pie: sin nota al pie y sin acompañante.

   **Y se le captura el DÍA QUE DESCANSA, como a todo el equipo** *(20-sep-2026)*.
   Viene todos los demás, y de esos días depende la limpieza de apertura: esos
   días es suya —con el asesor que abra, y sola si ese día no abre ningún
   asesor, que para eso la gerencia ya está barriendo—; el día que descansa la
   hace el asesor solo. Si el reparto no supiera qué días viene, el fallo se
   vería al revés de como es: el panel enseñaría el nombre de alguien que no
   está en la tienda, o dejaría las mesas esperándola.

   Se preguntó primero al revés —marcar los seis días que sí viene— y se
   cambió el mismo día: era la misma persona capturada con dos lógicas
   distintas (los del planeador llevan `descFijo`) y abría un hueco que no
   existe en el resto del formulario, desmarcar todos. **`externosTareas_()`
   lee los tres formatos** —`descanso` (el de ahora), `dias` y un `dia` suelto—
   porque lo guardado vive en `horarios_config` y nadie lo migra: dejar de leer
   uno sacaría a esa persona del reparto sin un solo error. Lo que no se puede
   traducir a «toda la semana menos uno» deja el desplegable sin elegir y
   guardar lo pide; convertirlo por nuestra cuenta la pondría a trabajar días
   que nadie capturó. Con nombre y sin día elegido, error en pantalla:
   `leerExternosForm_` descarta esa fila y sin el aviso se borraría en silencio.
4. **`TIENDA_TAREAS = '1217'`.** Este archivo se publica también en
   `planeador-odemas`; allá el checklist no se pidió y encendido solo repartiría
   tareas que ese equipo nunca acordó. La tabla sí lleva `store_id`, así que
   abrirlo para otra tienda es tocar el HTML, no migrar nada.
5. **El catálogo del HTML y el CHECK de `tareas_hechas` dicen lo mismo.** Agregar
   una tarea aquí y olvidar el SQL no rompe el reparto —se ve perfecto— pero al
   palomearla la base la rechaza y no se registra nada.

   **Y el id va en el SQL DOS veces** *(21-sep-2026)*: en el `CREATE TABLE`, que
   solo corre en una base nueva, y en un `ALTER … ADD CONSTRAINT` que lo rehace
   sobre la que ya existe. `CREATE TABLE IF NOT EXISTS` no toca una tabla que ya
   está, así que actualizar solo la primera dejaba a la 1217 con la lista vieja:
   el reparto pintando «Limpiar sillas» todos los días y la palomita rechazada.
   La prueba compara ahora **las dos listas del SQL entre sí**, además de contra
   el catálogo.

La palomita vive en `supabase_tareas.sql`: `tareas_semana()` para leer (devuelve
`mia`, no el número de quien marcó) y `tarea_marcar()` para escribir. La primera
palomita manda (`ON CONFLICT DO NOTHING`) y **desmarcar solo puede quien marcó**:
sin eso, cualquiera podría borrar el trabajo registrado de otro y la tabla
dejaría de servir para lo único que sirve.

Lo cubre `pruebas/tareas_rotacion.js` (12 bloques). Los trece cebos del
21-sep-2026 muerden todos. Del apoyo con numero y la tarea nueva: filtro viejo
por `quienes`, el cartel de «no encontramos tu horario» de vuelta, el apoyo
leyendo su propio nombre en vez de «te toca», las sillas coladas como semanales,
las sillas sin apoyo, `miClaveTareas_()` perdiendo la ficha del planeador, la
palomita del apoyo numerado abierta a cualquiera, y el SQL actualizado en una
sola de sus dos listas. Y del reparto diario: las sillas vueltas de apertura,
las mesas dejando de serlo, `presente` sin mirar el turno —tarea a quien
descansa—, y las dos formas de perder el reparto del dia (sin `libres` y sin
apuntar en `yaEseDia`), que dejan mesas y sillas sobre la misma persona.

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

## Los datos del equipo llevan meses publicados *(28-ago-2026)*

Buscando dónde poner un `.sql` nuevo se vio que **este repo es público y traía
los nombres completos y los números de empleado en 14 archivos**. El peor,
`supabase_accesorios_reporte.sql`: el mapeo entero, los cinco con su número,
desde el 18-ago.

**`r_personales()` nunca los vio porque solo miraba `HTML + SUELTOS + datos.js`.**
No revisaba los `.sql`, ni este archivo, ni `pruebas/`. La regla contra la fuga
de datos cubría siete archivos de noventa y ocho.

⚠️ **Y el único que sí estaba en un archivo vigilado se le escapó igual.** El
patrón conocía un apellido y `tablero.html` traía la otra grafía, con una letra
de más — la misma que descuadró las comisiones de agosto, dos secciones más
arriba. El mismo error, en la regla que debía protegerlo.

Nota amarga: `pruebas/login_a_captura.js` empezaba con *«sin el gas_token ni las
URLs: este repo es público»*. Se sabía. Se quitó la llave y se dejaron los
nombres.

### Cómo quedó

**Los datos reales salieron del repo, a `_privado/`** (en el `.gitignore`):

| Archivo | Qué guarda |
|---|---|
| `_privado/datos_equipo.txt` | apellidos y números, para que `r_personales()` sepa qué buscar |
| `_privado/mapeo_nombres.sql` | el `UPDATE` de `nombre_reporte`, que se pega tras `supabase_accesorios_reporte.sql` |
| `_privado/unificar_vendedor.sql` | el arreglo de la grafía, ya aplicado |

Lo versionado lleva ejemplos: `<empno-gerente>` en los comentarios y nombres
inventados en las pruebas. **Las pruebas conservan lo que probaban** — la lista
sigue trayendo grafías flojas y una que difiere del nombre oficial en una letra,
porque ése es justo el caso que hay que seguir cubriendo.

`r_personales()` ahora **mira todo lo que `git ls-files` publica**, no una lista
escrita a mano, y compara contra `_privado/datos_equipo.txt`. Si ese archivo no
está, **falla**: no saber qué buscar no es lo mismo que no encontrar nada. Y
`verificar.py` ya no se excluye a sí mismo — antes llevaba los apellidos dentro,
o sea que el archivo que vigilaba la fuga era parte de la fuga.

#### La lista de personas no escala, y por eso hay una regla que no la usa *(15-sep-2026)*

`r_personales()` compara contra `_privado/datos_equipo.txt`: una lista de
personas escrita a mano. En la 1217 son seis y no se mueven. En
**`tablero-odemas` eso no funciona**, y lo dijo Ángel con la frase exacta del
problema: *«cada gerente haría eso para cada asesor que se dé de alta y
operativamente no lo veo viable»*. Tiene razón, y no es un detalle: las altas de
asesor se hacen **desde la app**, no desde el repo —los 21 commits de odemas son
todos de la misma cuenta—, así que nadie va a venir a anotar aquí a nadie. La
lista se queda vieja el primer día, **y una lista vieja es peor que ninguna
porque aparenta estar cubriendo**.

`r_nombres_forma()` no pregunta quién es: pregunta si algo tiene **forma** de
nombre de persona. Lo único que mantiene son los nombres de ejemplo
—inventados, los mismos siempre—, y ésos no crecen con el equipo. **Coste por
asesor dado de alta: cero.** Es la misma regla para una tienda que para
cincuenta, y corre en los tres repos por el mismo `--solo-datos`.

Tres formas, y las tres se midieron **antes** de apretarlas, porque una regla
que grita en cuarenta archivos corrientes deja de leerse:

| Forma | Qué caza | Ruido medido (1217 / odemas / horario) |
|---|---|---|
| Tres palabras Capitalizadas | «Nombre y dos apellidos» | 13 / 9 / 0 |
| Detrás de etiqueta de persona | `atendido por`, `nombre_reporte` | 12 en total |
| TRES MAYÚSCULAS + nº de empleado | una fila del concentrado | 9 / 8 / 0 |

Lo que se **descartó**, con su número, para que no se vuelva a proponer:

- **TRES MAYÚSCULAS sueltas**: 293 cadenas. Aun filtrando SQL y palabras vacías
  se queda en 44 —catálogo de accesorios y basura del OCR—. Por eso se pide el
  número de empleado al lado: una fila del concentrado siempre lo trae.
- **El número de empleado de CINCO dígitos** es exactamente la forma de un SKU.
  Pedirlo encendía los trece accesorios con nombre de tres palabras en alta, y
  **ese catálogo crece**: sería otra lista que mantener. El de cinco sólo cuenta
  si el renglón además dice `asesor`, `gerente`, `empleado`…
- **`APELLIDOS, Nombre`** (como lo imprime el POS): 35 y 18, casi todas
  `KEY, JSON` de desestructurar en JS.
- **Aceptar minúscula tras la etiqueta**: costaba 21 fallas falsas, porque
  `nombre_reporte text NOT NULL` se lee como una persona en cada `.sql`.

Se auditó con **veinte cebos** armados desde `_privado/` —nunca tecleando un
nombre, y corriendo la función de verdad, no una copia—. Se le iban ocho. Tres
se arreglaron: la etiqueta sólo casaba en minúscula, la inicial con punto no
contaba como palabra, y **el número de empleado se pedía de seis dígitos cuando
los reales son de cinco y de seis** —la fila del concentrado pasaba por un
dígito—. Los otros cinco están escritos en el docstring de la regla, con lo que
costaría cerrarlos, para que no se descubran otra vez.

El hueco que no se cierra: el **apellido suelto** de alguien de otra tienda. Una
palabra capitalizada no se distingue de ninguna otra palabra. Para la gente de
la 1217 lo cubre `r_personales()`; para el resto, nada puede.


#### Y el mismo error, repetido: la tercera columna tampoco era viable *(15-sep-2026)*

Quitado el mantenimiento a mano de `tablero-odemas`, se le volvió a pedir a
Ángel exactamente lo mismo por otra puerta: **llenar a mano la tercera columna
—los nombres de pila— en los dos `datos_equipo.txt`**. Lo paró otra vez:

> «te dije que este no es viable»

Tenía razón las dos veces. Y no hacía falta pedirlo: **`_privado/mapeo_nombres.sql`
ya trae el `nombre_reporte` de cada persona**, que es «APELLIDOS NOMBRE».
Quitándole los apellidos —que ya están en la lista— lo que queda es el nombre de
pila. `_pilas_deducidas()` lo hace en cada commit, sin que nadie escriba nada, y
ese archivo no se queda viejo por su cuenta: es el que cuadra las comisiones
contra el Excel regional, así que si le falta alguien se nota en el sueldo de esa
persona mucho antes que aquí. El aviso que pedía llenar la columna se quitó: un
aviso que nadie va a atender enseña a no leer los avisos.

Lo que deduce hoy, medido:

| | |
|---|---|
| Palabras del mapeo que ya eran apellido | 10 (ya cubiertas) |
| **Nombres de pila que ahora se vigilan** | **4** |
| Del dueño del repo, fuera a propósito | 2 |
| Hueco: nombres de **menos de 4 letras** | 1 |

Los dos que se dejan fuera son deliberados. El del dueño porque su nombre es
suyo y lo publica él —sale de `git config user.email`—; sin eso el repo fallaría
por llevar la firma de quien lo firma. Los de menos de cuatro letras porque se
buscan con frontera de palabra y tres letras casan con demasiada palabra
corriente; **ése sí es un hueco real y está abierto.**

⚠️ **Y al medirlo aparecieron dos fugas vivas.** Los nombres de pila de dos
personas del equipo estaban en **22 sitios de 13 archivos ya publicados** de este
repo (`tablero-odemas` y `horario-semanal` estaban limpios). No se cambiaron por
un nombre inventado: se cambiaron por **el papel que hace esa persona** —«quien
captura», «el subgerente»—. Un nombre inventado habría sido peor que el real,
porque alguien lo buscaría en la tienda y no existe.

Dos no se arreglaban sustituyendo:

- `captura_series.html` decía «Solo *Fulana* abre la hoja de ventas» **en la
  pantalla que ve el equipo**. Ahora dice «Solo quien tiene el permiso»: dice lo
  mismo y no nombra a nadie.
- `GAS_MODOS.md` nombraba **la pestaña del Sheet**, que sí tiene valor operativo
  —un modo se apaga renombrándola—. El nombre se fue a
  `_privado/nombres_operacion.txt` y la nota apunta ahí.

Un detalle que costó una prueba falsa: en ese SQL **el número de empleado va
entre comillas igual que el nombre**, así que la primera versión los dedujo como
si fueran nombres. El cebo de punta a punta pareció pasar, pero lo que había
cazado era un número, no un nombre. Con `isalpha()` la cuenta bajó de 8 a 4 —y
ésa es la buena—.



⚠️ **Limpiar el HEAD no bastaba: los datos seguían en el historial.** Se
reescribió con `git filter-repo` y se forzó el push. Cualquier clon anterior a
esa fecha queda inservible y hay que volver a clonarlo.

#### Y aun así quedó un archivo dentro *(19-sep-2026)*

Tres semanas después, `comisiones_datos.js` seguía descargándose. Había salido
del árbol el 1-ago —el commit se llama «saca datos personales del repo»—, pero
su blob vivía en los **52 commits** en los que el archivo existió, y
`raw.githubusercontent.com/.../<sha>/comisiones_datos.js` contestaba **200**.

Lo que traía, mirado antes de borrarlo: el puesto y **la venta del mes de cada
persona** de la 1217. Los nombres resultaron ser los inventados de
`NOMBRES_EJEMPLO` —eso sí se había limpiado en su día—; las cifras no. Se
comprobó además que esas cifras **no aparecen en ningún otro archivo** del
historial: `git grep` de las cuatro contra las 414 revisiones solo enciende ése.

Se reescribió con `git filter-repo --path comisiones_datos.js --invert-paths` y
se forzó el push. Comprobado después: los 414 commits siguen ahí, el árbol de
HEAD es **el mismo objeto** que antes (`6be3ab1…`, así que no se movió ni un
byte de lo publicado), el blob no existe en ningún commit y la URL de `main` da
404.

⚠️ **Lo que una reescritura NO hace.** GitHub conserva los objetos que quedan
sueltos hasta que los recoge, así que **el SHA viejo siguió contestando 200
después del push**: eso solo lo purga GitHub Support, pidiéndolo desde la cuenta
dueña del repo. El respaldo de antes de reescribir quedó en `_revisar/` de la
bóveda, fuera de todo repo.

**La regla que deja esto:** un archivo con datos **no se arregla borrándolo en
un commit**. Mientras no se reescriba el historial, sigue publicado en la URL de
cualquier commit viejo — y el `git log` del día siguiente ya no lo enseña, que
es lo que hace que se olvide.

---

## El verificador y las pruebas *(17-ago-2026)*

Las 15 reglas de `verificar.py` nacieron cada una de un fallo que ya había
llegado a producción, así que por diseño miran hacia atrás. En un día con tres
fallos nuevos eso se notó, y el diagnóstico no fue "faltan reglas":

#### El rojo que nadie leía era el de la regla de los nombres *(19-sep-2026)*

«Verificar tablero» llevaba fallando en **todos** los push desde que existe, y
siempre por lo mismo: en GitHub Actions no está `_privado/datos_equipo.txt` —ni
puede estar, porque `_privado/` es justo lo que no se publica—, así que
`r_personales` no tenía contra qué comparar y fallaba a propósito. Correcto en
la máquina del gerente; en CI convertía el check en un rojo permanente.

Un rojo que siempre está rojo no avisa de nada. Es el mismo error del 4-ago con
`working-directory` —que ese mismo archivo ya documenta— y es el ambiente en el
que un archivo con las ventas de la tienda pasó tres semanas publicado.

Ahora en CI es un **aviso que dice qué se deja de comprobar** (el cotejo contra
los nombres y números reales, que se hace antes de cada commit en la máquina
donde se trabaja) y la **falla sigue intacta fuera de CI**. Probado con cebo:
en CI, un archivo con «APELLIDOS NOMBRE» junto a un número de empleado tumba el
job igual, porque `r_nombres_forma` no necesita la lista; y el árbol limpio sale
verde. El verde vuelve a significar algo.

#### El hueco de los nombres cortos era otro hueco *(15-sep-2026)*

La deducción de nombres de pila se quedaba con los de **cuatro letras o más**,
por miedo a que un nombre corto casara con palabra corriente. Se midió, y el
miedo apuntaba al sitio equivocado.

Primero, **hoy el hueco no existe**: la única palabra de menos de cuatro letras
que sale del mapeo tiene dos, y es la partícula de un apellido compuesto, no el
nombre de nadie. Nadie del equipo tiene nombre corto. El hueco era del futuro.

Después se midió qué costaría el día que entre alguien así, con diez nombres de
pila de tres letras corrientes en México, sobre los tres repos (**179 archivos**):

| Nombre | Enciende (1217 / odemas / horario) |
|---|---|
| nueve de los diez de 3 letras | 0 / 0 / 0 |
| `luz` | 1 / 1 / 0 — los avisos de la cámara, «con buena luz» |
| `rosa`, que **ya se aceptaba** con 4 letras | 5 / 2 / 0 — el color |
| `juan`, que **ya se aceptaba** | 3 / 0 / 0 — los fixtures de pruebas |

O sea que **el ruido no viene del largo del nombre, sino de que el nombre sea
además una palabra corriente** — y eso pasa igual con cuatro letras que con
tres. `rosa` mete más ruido él solo que los diez nombres cortos juntos. El
mínimo bajó a **tres**, y las partículas de apellido compuesto («de», «del»,
«la», «san»…) se sacaron por lista aparte: es castellano, no personas, así que
esa lista no crece con el equipo.

⚠️ **Y queda un hueco abierto, que NO se tapa a mano.** Si entra alguien que
se llame como una palabra corriente —Luz, Rosa, Cruz—, la regla va a fallar en
archivos donde no hay ninguna fuga. La salida que existía era poner `!palabra` en
`datos_equipo.txt`; Ángel la descartó con la razón de siempre:

> «no es funcional, ninguno de los demás gerentes van a realizar o mover más que
> dentro de la app»

Y es la tercera vez que lo dice. **Cualquier arreglo que pida editar un archivo
del repo está muerto antes de empezar.** Esto lo tiene que resolver el código:
para los nombres que chocan con palabra corriente, pedir una segunda señal en el
mismo renglón —`asesor`, `gerente`, un número de empleado, un apellido al lado—
en vez del nombre a secas.

#### Cerrado: lo que decide no es la palabra, es la compañía *(17-sep-2026)*

Hecho como estaba dicho, y sin lista ninguna que mantener. La diferencia la
marca **quién identifica solo**:

- un **apellido** identifica a una persona él solo, y sigue cayendo solo;
- un **nombre de pila** no. Es el que choca con el color y con la palabra
  corriente, así que ahora sólo cuenta como fuga si a menos de 80 caracteres
  hay algo que diga que ahí hay una persona: una palabra de puesto, una de las
  etiquetas que preceden a un nombre (`atendido por`, `nombre_reporte`…), o un
  apellido del equipo.

El vocabulario no es nuevo ni se mantiene aparte: es el mismo que ya usaban las
dos reglas de la sección 4-bis, sacado a una constante. **Coste por asesor dado
de alta: cero**, que era la condición.

Medido antes de darlo por bueno, sobre los tres repos, inyectando veinte
nombres de pila que además son palabra corriente como si acabaran de entrar al
equipo:

| | Antes | Ahora |
|---|---|---|
| Archivos encendidos sin fuga | 74 | **3** |
| Y si varios del equipo se llaman así a la vez | — | **0** |
| Cebos de fuga cazados (de 20) | 20 | **17** |

Los 3 que siguen encendiendo son frases que **sí** nombran a una persona
(«lo pidió Fulano», con «gerente» en la misma línea): la regla acierta, el cebo
era artificial. Los 3 cebos que se pierden son el mismo caso —el nombre de pila
a secas, sin nada al lado— y ninguno lleva a nadie: una fuga de verdad sale del
POS, del concentrado o del Excel regional, y ésos imprimen el renglón entero.

Dos cosas se cayeron al medirlas, y las dos por la misma razón —lo que no
estorba dentro de un renglón no sirve suelto a 80 caracteres—:

- **el número de empleado como señal.** El SKU `304271` de `tablero.html` caía
  a un palmo de la palabra «rosa» del catálogo y la convertía en persona.
- **`puesto` a secas**, que en español es también el participio de poner: «el
  código estaba puesto en admin» hacía persona a quien pasara cerca.

Y una tercera se probó y se tiró: **«otro nombre de pila del equipo al lado»**.
Recuperaba uno de los tres cebos perdidos, pero encendía `MAPA.md` y
`verificar.py` — los dos archivos que explican este problema enumerando nombres
corrientes uno detrás de otro. **Un archivo que explica la regla no puede
dispararla**, y acortar la distancia hasta que dejaran de tocarse habría sido
ajustar el número hasta que la medición saliera bien, que es medir al revés.

#### Decía «Todo en orden» sin haber comprobado *(28-ago-2026)*

Se tocó `admin.html` en una máquina **sin git en el PATH** y el verificador dio
el visto bueno. No comprobó nada de lo que importaba:

```
git_cambiados()  →  except OSError  →  return []
r_version()      →  if not cambiados: return
```

`admin.html` está en el precache de `sw.js`, así que **había que subir
`VERSION`** — y esa es justo la regla que se saltó. Con ella callaron
`r_contrato_sql`, `r_returns_table_drop` y `r_funcion_repetida`, y
`git_publicados` dejó de filtrar los `.sql` que no están en el repo. Cuatro
reglas y un filtro, en silencio, detrás de 24 «ok» verdes.

El archivo ya condenaba esto dos veces, con otras causas: *«una regla que calla
por no saber leer el archivo es peor que no tenerla, porque además da permiso»*.
Aquí no sabía leer el repo.

Lo vigila `r_git()`, y va **la primera**: conviene saber que las reglas de git
no corren antes de leer la lista de oks, no después. **Falla, no avisa** — un
aviso al final de una lista verde no para a nadie, y lo que está en juego es
subir sin `VERSION`: Pages queda al día y los celulares del equipo se quedan con
la copia vieja, sin error y sin aviso. Eso ya costó horas el 1-ago-2026.

⚠️ **Efecto secundario buscado:** en una máquina sin git, `verificar.py` ahora
falla siempre. Es correcto — ahí tampoco se puede hacer el push.

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

## Retirar el Apps Script *(decidido el 6-sep-2026)*

*«Ya no quiero trabajar con Apps Script».* Era la etapa 5 del plan de migración;
pasa a ser el rumbo.

**La buena noticia, medida y no supuesta: no hay nada que migrar.** Los once
modos que las apps siguen pidiendo tienen ya su función en Supabase:

| `modo=` del GAS | quién lo pide | ya existe en Supabase |
|---|---|---|
| `todo` | tablero, datos.js | `tablero_todo` |
| `inventario` | tablero, datos.js | `inventario_vivo` |
| `promos` | tablero, captura | `promos_vigentes` |
| `eol_cloud` | tablero, datos.js | `eol_lista` |
| `eol_venta` | captura | `eol_precio_venta` |
| `avisos_cloud` | tablero, datos.js | `avisos_vigentes` |
| `bundles` | tablero | `bundles_vigentes` |
| `ventas_hoy` | tablero | `ventas_hoy` |
| `catalogo` | captura | `catalogo_completo` |
| `estado` | captura | `estado_datos` |
| `comisiones` | comisiones | `comisiones_lista` |

Y **el GAS solo se llama cuando Supabase no contesta**: `refrescarNube` hace
`if(await cargarTodoSupabase()) return;` antes de mirarlo. O sea que retirarlo
**no cambia el camino normal de nada** — quita el segundo camino.

**Qué se pierde, dicho sin adornos:** el respaldo del día que Supabase se caiga.
Pero el respaldo que de verdad deja vender no es el GAS, es el teléfono:
`tablero.html` guarda inventario, promos y bundles en `localStorage`
(`INV_KEY`, `PROMOS_KEY`, `BUNDLES_KEY`), y captura guarda el catálogo. Con
Supabase caído y sin GAS, el asesor sigue viendo los precios que bajó la última
vez — que es justo lo que el respaldo protegía.

**Lo que se lleva por delante, y es la mitad del premio:** sin Apps Script no hay
`gas_url` ni `gas_token`, y con ellos se van la cadena 1 entera, el candado
`GAS_ESTRICTO` —cerrado el 4-ago y **vuelto a comprobar el 19-sep**: contra el
`/exec` sin token, `estado`, `zzz_inventado`, `catalogo` y `ventas` devuelven
las cuatro `{"error":"no_autorizado"}`—, `accesoPermitido_`, `SINTOK_HOY` y las
reglas del verificador que los vigilan.

**Un modo se apaga quitándole el dato, sin abrir el editor.** Es lo que se hizo
con `comisiones` (cadena 2-quater): renombrar la pestaña del Sheet y
`leerComisiones_` devuelve vacío. Sirve para desconectar de uno en uno y
comprobar en piso antes de borrar código.

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

**B · Cerrar el Apps Script, bien esta vez** — ✅ **hecho** *(4-ago-2026, y
comprobado de nuevo el 19-sep contra el `/exec`)*
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
Historial de git del tablero — ✅ **reescrito el 19-sep**, ver «Y aun así quedó
un archivo dentro» · los commits huérfanos del planeador — **medidos el 19-sep,
ver aquí abajo**; lo único que queda es el ticket, que solo puede mandar Ángel ·
`exhibAt` para detectar cuándo el On Hand quedó viejo.

#### Los commits huérfanos del planeador, ya con nombre y apellido *(19-sep-2026)*

Esta línea llevaba semanas en el mapa sin decir qué había dentro. Ya está
medido, y **pesa más que lo del tablero**: son datos de personas, no cifras de
venta.

Cómo se encuentra sin adivinar: la API de GitHub publica la actividad del repo
—`/repos/<owner>/<repo>/activity`, que contesta **sin credenciales**— y ahí
aparece el único `force_push` de `planeador-odemas`, el **30-jul-2026**, que
dejó atrás la cabeza vieja. Con esa SHA, `git fetch origin <sha>` la trae al
clon aunque ya no cuelgue de ninguna rama.

| Qué se midió | Resultado |
|---|---|
| Commits que quedaron fuera de `main` | **63** |
| De esos, con `horario_semanal.html` dentro | **63**, todos |
| Nombres completos del equipo en ese archivo | **5** personas |
| Números de empleado | **3** |
| Secretos (JWT, `service_role`, llaves) | ninguno |
| `main` hoy, los 73 commits vivos | **limpio**: cero coincidencias |

O sea: el force push del 30-jul **sí** limpió la rama, y desde entonces lo
publicado no trae nombres. Lo que quedó es el rastro de antes, que GitHub sigue
sirviendo por SHA — comprobado: `raw.githubusercontent.com/.../<sha vieja>/
horario_semanal.html` contesta **200**.

**Aquí no hay nada que reescribir.** La rama ya está limpia; el objeto es
inalcanzable y aun así se descarga. Lo único que lo quita es que GitHub recoja
los objetos inalcanzables, y eso **solo lo puede pedir el dueño de la cuenta**.
Mientras tanto, la SHA está a la vista de cualquiera en esa misma API de
actividad: no hace falta saberla de antes.

Del lado de esta máquina sí se cerró: el clon de `horario-semanal` tenía además
dos objetos sueltos con un apellido y un número de empleado —de una edición que
nunca se subió; comprobado contra la API, **404** en GitHub—. Se expiró el
reflog y se corrió `git gc --prune=now`: ya no existen aquí, y `main` quedó
intacto.

**La regla que sale de esto, y vale para los dos repos:** un force push no
borra nada, solo deja de nombrarlo. Lo que de verdad protege es no publicarlo,
y por eso `deploy.ps1` nombra archivo por archivo y el hook revisa los nombres
antes de cada commit.

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

## Concurso Oro/Plata *(15-sep-2026, v241)*

Pestaña propia dentro de **Captura de Series** (botón 🏆). El asesor sube la foto
del ticket **completo**, el lector lo clasifica y el gerente valida el detalle de
artículos. Tres vistas en `#cnPanel`: subir, marcador y lista para validar.

**La regla vive en `concurso_nivel.js`, no en el SQL ni en el HTML.** ORO son los
cuatro papeles —Core, Accesorio Huawei, Garantía y TechSmart/Servicio—; PLATA es
Core más dos de los otros tres. Core es **solo** MatePad, teléfono y MateBook: la
band, el watch, el router y los audífonos son Accesorio Huawei. Esto se preguntó
tres veces y la respuesta está escrita en la cabecera de ese archivo y en
`pruebas/concurso_oro_plata.js`; **no se cambia sin volver a preguntar**.

Piezas: `concurso_ticket.js` (lee el OCR), `concurso_roles.js` (qué papel juega
cada SKU), `concurso_nivel.js` (reparte papeles con backtracking y califica),
`supabase_concurso.sql` (nueve funciones).

⚠️ **El ticket se guarda para TODO el equipo**; el filtro está en el marcador
(`concurso_participantes`), no en la puerta. Por eso `concurso_marcador` tiene
una red: si la lista de alta está vacía, cae a los `empno` de los tickets. Un
marcador en blanco mientras entran tickets se lee como «nadie ha vendido», que
es justo lo contrario de lo que estaría pasando. Y `concurso_guardar` devuelve
`en_marcador`: al asesor que no sale en el marcador se le dice que su ticket sí
se guardó, o vuelve a subirlo pensando que falló.

⚠️ **La fecha es día/mes.** Leer `09/10/26` como mes/día convierte un 10-sep en
un 9-oct, el ticket se sale de la ventana y el rechazo es indiscutible con el
papel en la mano. `concursoFechaISO` está aparte y probada por eso.

## Escaneo continuo: MEDIDO Y DESCARTADO *(21-sep-2026)*

**No entra. El paso 1 de Captura de Series se queda con la foto.** Lo decidió
Ángel con los números delante, que es para lo que se construyó el banco.

Las dos razones, y la segunda explica la primera:

1. **Falla más que la foto.** Primera y única tanda real, en un Huawei Pura 70
   Ultra: 9 intentos en vivo, **22 % de fallos**, y los dos fallos fueron el
   mismo — UPC leído, serie nunca.
2. **Desde la página, la cámara no enfoca.** `getUserMedia` entrega el flujo
   tal cual: el enfoque lo decide el sistema y desde la web no hay control
   fiable del enfoque ni del macro (en Safari, ninguno). La app de cámara del
   teléfono, la que abre `capture="environment"`, **sí enfoca y hace macro
   antes de disparar**.

Y eso es exactamente lo que necesita el **Code 128 de la serie**, que es más
fino y más largo que el EAN del producto. De ahí el patrón de los nueve
intentos: el UPC entraba solo en 1.4–2.9 s y la serie llegaba tarde o no
llegaba. No era la regla de la doble lectura: era óptica. Lo confirma la
prueba con la foto real de una caja de FreeBuds Pro 4 —la misma serie que no
decodificó en la foto de WhatsApp (900 px) sí decodificó cuando la etiqueta
ocupaba el fotograma entero—: lo que decide no es el modo, son los píxeles
enfocados que ocupa el código.

⚠️ **Lo que esto deja dicho para la próxima vez que se proponga.** Ya van dos:
el «visor» decorativo de la mañana del 21-sep y esto. La respuesta no es «no
se puede», es **«mídelo primero, y mide la serie, no el UPC»**.

**Descartado también, y por escrito para que no vuelva como idea nueva:**
producto en vivo y serie por foto. El UPC sí llega solo en 1.5 s, así que
técnicamente se podría — pero serían **dos caminos que mantener en el paso 1**
y dos modos que explicarle al asesor con el cliente enfrente, a cambio de
ahorrar un segundo y medio en el dato fácil. No compensa, y no se midió porque
no llegó a plantearse en serio.

**El banco se borró el mismo día, a petición de Ángel: no quería una página de
pruebas publicada.** `banco_escaneo.html`, `banco_escaneo.js` y
`pruebas/banco_medicion.js` ya no están en el repo ni los sirve GitHub Pages;
salieron también de `SUELTOS` y de la lista de pruebas de `verificar.py`.
Siguen en el historial de git —commit `9f6d911`, el último que los tuvo— así
que recuperarlos es `git show 9f6d911:banco_escaneo.html`, no volver a
escribirlos.

Lo que sigue debajo es CÓMO se llegó aquí, y eso sí se conserva: la decisión
vale por los números, y quien quiera volver a tomarlos necesita saber qué se
midió y con qué trampas. Lo de abajo está en pasado a propósito — describe una
herramienta que ya no está.

## Cómo se midió: el banco *(21-sep-2026 — borrado, ver arriba)*

La pregunta venía de quitar el visor decorativo: ¿convenía cambiar el paso 1
—«Tomar foto» y analizarla— por la cámara en vivo leyendo fotogramas hasta que
el código apareciera? **Para contestarla no se tocó `captura_series.html`: se
construyó el instrumento aparte** —`banco_escaneo.html`, la lógica que decidía
en `banco_escaneo.js` y sus pruebas en `pruebas/banco_medicion.js`— y se midió.

Era una **página suelta de medición**, de la misma clase que
`prueba_ticket.html` (la del OCR, de agosto): entraba en `SUELTOS` de
`verificar.py` —para que la revisaran sintaxis, secretos y datos personales,
porque se publicaba igual de expuesta— y **no** en `HTML` ni en el precache. Por eso **no se subió VERSION** en ningún momento: un `v268` sin un
solo cambio en la app empuja una actualización vacía a todos los teléfonos, y
la regla de `r_version` ya dice exactamente eso.

⚠️ **Y por eso mismo se borró al terminar, el mismo día.** Una página de
pruebas publicada no se cae nunca sola: no la enlaza nadie, así que nadie la
ve vieja, y se queda ahí con una URL viva. El banco duró lo que duró la
pregunta.

En el mismo movimiento se borró **`prueba_ticket.html`**, que era la de agosto
—«¿cuánto tarda Tesseract en un celular de piso?»— y llevaba desde el 17-ago
publicada con la pregunta contestada hacía un mes: el OCR lleva desde
entonces en producción en accesorios, Mr Fix y el concurso. Está en el
historial, commit `59ac794`. Con eso **no queda ninguna página de medición
publicada**; `SUELTOS` en `verificar.py` conserva sólo
`accesorios_tecnico.html`, que no es una prueba sino la pantalla del técnico.

**La regla que queda:** una página de medición nace con fecha de caducidad. Se
borra el día que contesta su pregunta, no «cuando alguien se acuerde» — porque
nadie se acuerda de lo que nadie enlaza.

### Qué mide, y por qué así

| Bloque | Qué contesta |
|---|---|
| 0 · sin cámara | cuántos fotogramas por segundo decodifica ESE teléfono |
| A · foto | el flujo de hoy, cronometrado desde que se toca el botón |
| B · continuo | el candidato, con doble lectura y congelado de evidencia |
| C · 5 minutos | cuánto se frena el teléfono con la cámara abierta |

Cuatro decisiones de medición que no son detalle:

1. **El cronómetro arranca al TOCAR el botón, no al empezar a decodificar.**
   El asesor espera a que el teléfono abra su cámara, encuadra, dispara y
   confirma; medir sólo la decodificación sería medir la mitad cómoda, y
   justamente la mitad en la que el continuo no compite.
2. **El bloque A anota POR DÓNDE salió la lectura.** Cada serie que sólo se
   sacó con el OCR del texto «S/N» es una que el continuo habría perdido: ahí
   no cabe un OCR que tarda segundos. Ese conteo sale en el veredicto como
   aviso, gane o pierda.
3. **El bloque 0 dibuja el código en un lienzo de 1280×720**, el mismo tamaño
   que el fotograma que pide la cámara. Medido ese día en Chrome de
   escritorio: el mismo código en un lienzo de 1000×156 se lee en **20 ms** y
   en uno de 1280×720, en **81 ms** —cuatro veces, porque ZXing recorre
   píxeles—. Con el lienzo chico el banco habría anunciado 50 fps y el vivo
   habría dado 12, sin nada que explicara la diferencia. Y esos 81 ms son de
   una PC: el iPhone, donde no hay `BarcodeDetector` nativo y todo cae en
   ZXing-WASM, es el caso a vigilar.
4. **«Cuánto calienta» no se puede leer del navegador.** Ningún teléfono
   publica su temperatura, así que se mide lo que la temperatura provoca
   —caída de fotogramas por segundo entre el primer minuto y el quinto, deriva
   del tiempo de decodificación— más la batería, y una pregunta al asesor al
   terminar. En iPhone la batería **no existe como API**: se devuelve `null`,
   nunca 0, y el veredicto lo trata como no medido.

### La etiqueta lleva DOS códigos, y hacen falta los dos *(21-sep-2026, tarde)*

Lo encontró Ángel con la primera caja que midió —unos FreeBuds Pro 4—: la
etiqueta lleva el EAN del producto y el Code 128 de la serie **uno encima del
otro**, y el lente del teléfono es tan ancho que los dos caben en el mismo
fotograma. El bucle en vivo se quedaba con **el primero** que encontraba y
confirmaba: leía el UPC y perdía la serie, o al revés.

Y no era sólo el continuo. **El modo foto del banco tenía el mismo fallo**,
mientras que `processImage` en la app recorre TODOS los códigos de la foto
(`codes.forEach`) y enruta cada uno. O sea que el banco comparaba una foto
capada contra un continuo capado: el número que hubiera salido no habría dicho
nada. Los tres intentos medidos hasta entonces **se descartan**, y el banco lo
dice en pantalla en vez de promediarlos (`v:2` en cada intento, `viejos` en el
resumen).

Ahora hay **dos casilleros** —producto y serie— con la misma regla de enrutado
que `routeCode`, y el intento sólo cuenta como bueno cuando los dos están
llenos. Con uno solo se anota `parcial`, que cuenta como fallo —la venta
necesita los dos— pero se enseña aparte, porque dice *por qué* falla: si casi
todos los fallos son parciales, lo que cuesta es encuadrar, no leer.

⚠️ **Que los dos casilleros se llenen en fotogramas DISTINTOS es correcto, y es
lo único que el continuo puede hacer y la foto no**: con una sola foto los dos
códigos tienen que salir enfocados a la vez; en vivo el UPC puede caer en el
fotograma 3 y la serie en el 20. Si el continuo acaba ganando, va a ser por
aquí.

Tres cosas medidas ese día con la foto real de esa caja (900×1600, la que
manda WhatsApp):

- **En la foto completa, el Code 128 de la serie NO decodificó.** Salió el UPC
  por código de barras y la serie **por OCR** del texto «S/N», correcta
  (`3RRXC25316084077`). Es el recordatorio de por qué la foto se queda: sin
  OCR, esa caja no se captura.
- **Encuadrando la etiqueta en 1280×720, ZXing saca los dos códigos del mismo
  fotograma**, incluida la serie que falló en la foto entera. Lo que cambia no
  es el modo: son los píxeles que ocupa el código.
- **El mismo valor repetido dentro de un fotograma no son dos lecturas.** Se
  descartan los duplicados de cada fotograma antes de confirmar; sin eso, una
  imagen que trae el código dos veces se confirmaría sola y la regla de las
  dos lecturas seguidas no vigilaría nada. Está probado con cebo.

### Los primeros 9 intentos reales, y lo que hicieron falta *(21-sep-2026, noche)*

Primera tanda de verdad, en un **Huawei Pura 70 Ultra**: 9 intentos en vivo,
7 completos, mediana **3.9 s**, 22 % de fallos. Decodificar no estorba —31 a
70 ms por fotograma, 461 fotogramas en 25 s— y el teléfono lee a ~40 fps
(ZXing 24 ms, y el `BarcodeDetector` nativo **más lento**, 32 ms: la cascada de
la app, que prueba ZXing primero, está en el orden bueno para este teléfono).

Lo que enseñan los nueve, y es un patrón, no una anécdota:

- **El UPC llega siempre primero** (1.4 a 2.9 s) y **la serie siempre después**
  (+0.5 a +2.7 s). El Code 128 de la serie es más fino y más largo.
- **Los dos fallos fueron el mismo fallo**: UPC leído, serie nunca.

Y ahí el banco se quedaba corto: «la serie nunca llegó» no dice si su código
**no se lee** (óptica: el continuo no lo va a arreglar por mucho que se afine)
o si **se lee suelto y no cae dos veces seguidas** (la regla de confirmación,
que sí tiene arreglo barato). Dos problemas distintos, un solo síntoma. Ahora
cada casillero cuenta `vistas` y los valores distintos que vio, y cada fallo
dice cuál de los dos es (`bancoPorQue`).

⚠️ **`undefined` no es cero.** Los intentos medidos antes de que existiera esa
cuenta no traen el dato, y meterlos en un cubo o en otro sería un diagnóstico
inventado. Se cuentan aparte —«de ésos no se sabe, hay que repetirlos»— en vez
de engordar el cubo que toque.

**Y el aviso que faltaba: 9 intentos en vivo y 0 con foto no son media
medición, son ninguna.** El banco existe para comparar; sin las dos columnas no
hay contra qué. Desde ahora, en cuanto los dos modos se separan por dos
intentos, la pantalla lo dice —y recuerda alternar uno y uno, porque hacerlos
en bloques le regala la práctica al segundo modo.

### El veredicto se escribió ANTES de tener los datos

Está en `BANCO_UMBRAL` y es lo único que decide: ≤70 % del tiempo de la foto
**y** al menos 1.5 s menos; no más de 10 puntos de fallos por encima; menos de
40 % de caída de fps y menos de 8 % de batería en cinco minutos. Los dos
criterios de velocidad juntos porque cada uno solo se engaña —un 44 % de mejora
sobre 1.8 s son 0.8 s que nadie nota de pie y con el cliente enfrente—.

Y la regla que de verdad manda: **hacen falta Android e iPhone**. Ganar en uno
no es «entra en Android», es `parcial`, y eso significa mantener dos caminos en
el paso 1. Lo decide Ángel, no el umbral.

⚠️ **Tres agujeros que sólo aparecieron al probarlo en Chrome**, no en Node — la
misma lección que dejó el OCR del ticket 34330:

- **El permiso pendiente deja al asesor atascado.** Si nadie contesta el
  diálogo, `getUserMedia` no se resuelve *ni se rechaza*: se queda pendiente
  para siempre, y la pantalla en «Pidiendo la cámara…» con el botón apagado.
  Ahora hay tope de 8 s y vuelta a la foto — y el rechazo **apaga el flujo que
  pueda llegar tarde**, o el permiso concedido al minuto deja la cámara
  encendida sin que nadie la mire.
- **Un intento cortado al minimizar se anotaba como fallo** (18 s que nadie
  hizo). Sube el porcentaje de fallos del continuo justo en la cuenta que
  decide si entra: ahora se descarta y se dice. Lo que sí cuenta como fallo es
  el botón «No leyó», que lo toca el asesor.
- **Con sólo el Android cargado, el veredicto decía «ENTRA».** La regla «sin
  los dos no se decide» estaba escrita para un iPhone vacío, y el caso real es
  un iPhone **ausente** del objeto. `BANCO_PLATAFORMAS` lo convierte en una
  ausencia que se cuenta.

### Cómo se corre en piso

Teléfono **desconectado del cargador**, brillo a la mitad, las mismas 4 cajas
para los dos modos y **8 intentos de cada modo alternando uno y uno** (los 8
seguidos de un modo regalan práctica al segundo). Cada teléfono copia su
resultado con el botón y lo manda por WhatsApp; ese texto lleva una línea
`#DATOS` que se pega en cualquier otro teléfono para juntarlo todo y ver el
veredicto. Los intentos de varios Android **se suman**, y de las corridas
térmicas se toma **la peor, no el promedio**: el asesor que se queda con el
teléfono que se arrastra es el que deja de usar la app.

### Lo que este banco NO contestó, y a propósito

Mr Fix y Concurso no entran: ahí se fotografía **un ticket entero**, no un
código, y el continuo no tiene nada que ofrecerles. Y la foto se queda pase lo
que pase — es el camino cuando el código está rayado, con el OCR del S/N
detrás. La pregunta es si el continuo se **suma** al paso 1, no si lo sustituye.

## Una venta de PRUEBA en la base de producción *(21-sep-2026, v269)*

Ángel encontró en las ventas a **«ANA QUIROGA»**, y en la 1217 no trabaja
ninguna Ana. No es un nombre mal escrito ni un asesor de otra tienda: **es una
venta de prueba que acabó en la base real**. Cada campo suyo sale de un archivo
de este repo:

| Campo | Valor | De dónde sale |
|---|---|---|
| vendedor | `ANA QUIROGA` | `pruebas/casos_tablero.js` (marcador del concurso, empno 900001) |
| serie | `6UTB826604020099` | `pruebas/ocr_ticket_real11.txt` |
| sku y precio | `100276717` · 14 999 | el mismo ticket de prueba |
| foto | no tiene | una prueba no fotografía la caja |

Fue el **21-sep a las 16:27**, es la única en 45 días de histórico, y el
`captura_id` (`i1790029640903bmcb`, que lleva dentro su propia hora) dice que se
creó en ese momento: no es una venta vieja que subiera la cola de offline.

**Lo que queda descartado, y cómo:**

- **No fue el equipo.** El nombre no está en Admin → Equipo, y en 45 días no
  aparece ninguna otra vez.
- **No fueron las pruebas automáticas.** `pruebas/entorno.js` deja `fetch`
  rechazando todo —«sin red en las pruebas»—, así que `verificar.py` no puede
  escribir en Supabase por mucho que se corra.
- **No fue la otra app.** `tablero-odemas` usa otra instancia de Supabase.

Queda que alguien usó **la app** con los datos de prueba delante. Quién, no se
puede saber: **`public.ventas` no guarda quién capturó la fila.**
`public.accesorios` sí (`capturado_por`), y por eso ahí esta pregunta sí tendría
respuesta. Mientras la columna no exista, la respuesta a «¿quién metió esto?» va
a ser siempre «no se sabe».

⚠️ **Y no es una fila inofensiva.** `ventas` tiene `UNIQUE (store_id, serie)`:
mientras esté ahí, **esa serie no se puede volver a vender** —la venta buena
sería rechazada por duplicada— y de paso descuenta stock y ensucia el conteo del
día y el attach. Se borra desde Ventas del día, que llama a `venta_eliminar` con
el `captura_id`.

### Y faltaba poder borrarla *(v270)*

Al ir a quitar esa fila se vio que **no había por dónde**. Borrar existía, pero
sólo en la lista local del día (`window.del`), que son las capturas hechas en
ESE teléfono. Lo que está en la nube y no en el aparato —lo capturó otro, o
entró por otro camino— sólo se podía **corregir**, y corregir no sirve cuando la
venta entera sobra: se queda contando en el inventario, en el conteo del día y
en el attach.

Ahora «Ventas del día» lleva 🗑️ junto a ✏️, con el mismo permiso —gerente y
subgerente— y el mismo camino que ya usaba la lista local: `venta_eliminar`, que
comprueba el token y **protege las entregas de apartados** (ésas se deshacen
desde Preventa, y su negativa se enseña tal cual en vez de un «no se pudo»).
El aviso dice qué se borra —modelo, serie y vendedor—, porque dos ventas del
mismo modelo el mismo día sólo se distinguen por la serie.

Lo fija `pruebas/venta_borrar.js`, probada con dos cebos: ofrecerle el botón al
asesor, y resumir la razón de la base a un mensaje genérico.

### De paso: el ejemplo del campo Equipo

Buscando el origen apareció otra cosa, que **no fue la causa** pero se arregló
igual: el campo Admin → Equipo tenía como ejemplo «Ana Quiroga / Luis Bermúdez /
María Zepeda», tres nombres indistinguibles de una lista real. El código guarda
lo que se teclea y no el ejemplo, así que no se cuela solo — pero un ejemplo que
se puede confundir con el dato es una trampa esperando. Ahora dice «Un nombre
por línea, como viene en nómina», y `r_ejemplos_no_datos` en `verificar.py`
vigila que no vuelva a tener forma de nombre de persona.

## Lo que la foto de una etiqueta trae de verdad *(21-sep-2026, v268)*

El lector de la foto se midió por primera vez contra fotos reales: **16
etiquetas de piso** —Mate 80 Pro, Mate XT, nova Y74, MatePad SE, FreeBuds 7i y
SE 4, FreeClip 2, Watch Ultimate 2, Watch GT 7 (41 y 46), Watch Kids X1, WiFi
BE3, BE3 Pro y AX3S— con el UPC y la serie de cada una anotados a mano. Las
fotos viven **fuera del repo**, en `05-Analisis/muestras-ocr-series/`, con el
banco que las mide.

| | serie correcta | **serie MAL** | vacía | UPC |
|---|---|---|---|---|
| antes | 7/16 | **4** | 5 | 16/16 |
| ahora | 14/16 | **0** | 2 | 16/16 |

⚠️ **Lo que importaba no eran las vacías: eran las cuatro MAL.** La etiqueta no
trae un código, trae hasta cinco —EAN, IMEI1, IMEI2, MAC, EID y la serie— y
`routeCode` mandaba a «Serie» todo lo que no fuera EAN. Así que el campo se
llenaba con **el IMEI del teléfono, la MAC del ruteador o el EID del reloj**. Un
campo vacío se ve; un número de 15 dígitos que nadie pidió, no: el asesor
encuentra la casilla llena y ese número viaja a la Hoja de Google como la serie
de la venta. Y encima el campo lleno **impedía que corriera el OCR**, que era
justo lo que habría sacado la serie de verdad.

Ahora cada código se reconoce por su forma —IMEI 15 dígitos, MAC 12 hex, EID 32,
serie 16 alfanuméricos con letras y dígitos— y lo que no encaja **no entra a
ninguna casilla**: se anota aparte. La regla vive en `lector_etiqueta.js` con sus
pruebas en `pruebas/lector_etiqueta.js`, y los cebos son los cuatro valores que
de verdad acabaron en el campo.

### Las tres cosas que se aprendieron midiendo

**1. Ampliar la etiqueta hace el trabajo que hacía el OCR, y lo hace bien.**
Es la misma frase que ya estaba escrita arriba para el escaneo continuo —«lo que
decide no es el modo, son los píxeles enfocados que ocupa el código»— aplicada
donde sí se puede: el EAN se lee **siempre** (16 de 16) y su posición dice dónde
está la etiqueta, así que se recorta alrededor, se amplía y se vuelve a
decodificar. No hay que pedirle al asesor que se acerque. Ocho series que antes
necesitaban OCR —o que no salían— ahora salen del código de barras **en menos de
dos segundos y con el valor exacto**. El Mate 80 Pro pasó de 14 s de OCR a
915 ms de código de barras.

Y hay una diferencia que no es de velocidad: **el código de barras devuelve el
valor exacto o no devuelve nada**. El OCR puede devolver quince aciertos y un
fallo —`54P7S` leído `54P75`— que nadie distingue mirando la pantalla.

**2. Al OCR, la foto entera; recortarle la etiqueta lo empeora.**
Medido, y va contra lo que parece:

- OCR sobre el **recorte ampliado**: 0 aciertos y **los 2 únicos falsos
  positivos** de toda la medición.
- OCR sobre la **foto entera reducida**: los 4 aciertos, ningún error, incluidas
  las tres etiquetas negras con letra blanca.

Es lo mismo que enseñó el realce de contraste en los tickets: el tratamiento que
«debería» ayudar empeora la mitad de las veces. Tesseract hace su propio
escalado y binarización; dárselo masticado le estorba. Por lo mismo **no se
invierten las etiquetas negras**: Tesseract 5 las lee solo, y la pasada extra
costaba segundos sin rescatar ninguna.

**3. Al OCR se le exige la forma; al código de barras, no.**
Las series miden 16 y son cinco alfanuméricos más once dígitos. Con eso se
cazaron los dos inventos del OCR: `1L03PQU261290000` donde decía
`63PQU26129000907`, y `BUSTADISPOSITIVO` —16 letras seguidas que el OCR pegó de
la tabla de reciclaje italiana de una caja de FreeBuds—. Los dos tienen pinta de
serie y los dos habrían llenado la casilla.

⚠️ Pero la forma **sólo se le pide al OCR**. El Mate XT rompe el molde
(`4DB0225C18000141`, con una C en la cola) y entra por código de barras. Si se
le pidiera la forma también a ése, esa caja dejaría de capturarse y nadie sabría
por qué. Hay una prueba que lo fija.

### El IMEI se reconoce para tirarlo, y no se captura

Preguntado y contestado el 21-sep-2026: **el IMEI no sirve para el reporte de
ventas**. Se le da nombre en `claseCodigo` por una sola razón —para que no acabe
en el campo Serie, que es lo que pasaba— y ahí se queda. No hay casilla para él
ni la va a haber: la venta se reporta con la serie.

### Lo que sigue sin salir, y por qué no es software

Dos fotos —unos FreeBuds SE 4 y un WiFi BE3 Pro— **se quedan sin serie**, y se
quedan a propósito: su Code 128 no decodifica **ni ampliado ×5 en 18 posiciones
distintas**, y el OCR no saca de ahí nada con forma de serie. Es óptica: código
fino, foto de 1200 px, poco enfocado. Lo que toca es acercar la cámara, que es
lo que dice el aviso — «acerca la cámara a su código y repite la foto», no un
«no se detectó nada» que no manda a ninguna parte.

**La casilla se queda vacía a propósito.** Vacía manda a teclear los 16
caracteres; con un número inventado no manda a nada, porque parece que ya está.

### Dos cosas más que se arreglaron de camino

- **Lo que el asesor teclea ya no se pisa.** El paso 2 aparece en cuanto se
  dispara la foto, así que mientras el lector trabaja él puede estar escribiendo
  la serie. El código miraba la casilla **antes** de leer y escribía **después**,
  sin volver a mirar: lo tecleado se perdía y nada lo decía. Ahora se comprueba
  al escribir. Está probado pasándole la foto lenta y tecleando encima.
- **El worker de Tesseract se conserva entre fotos.** Arrancarlo cuesta unos
  cuatro segundos y se pagaba en cada foto. Medido en la app: la primera foto que
  llega al OCR tarda 15 s; la siguiente, **4.5 s**.

### El mensaje dice de dónde salió la serie

Porque no se comprueban igual. Si salió del código de barras, «Serie y producto
leídos ✓». Si salió del texto, **«compárala con la etiqueta»**: ahí es donde cabe
una S leída como 5.

## Captura de Series: una cosa a la vez *(21-sep-2026, v266)*

Rediseño de FORMA, elegido por Ángel sobre maquetas (propuesta A con la
entrada 3B). La pantalla pasa de un formulario de arriba abajo a **tres pasos**
y de una barra de botones abajo a **cuatro pestañas con nombre** arriba.

**Los pasos: escanea → revisa → guarda.**

- **Paso 1** — el título, «Tomar foto» sólido y, debajo, «Galería» y «Escribir
  a mano». Escribir a mano dejó de ser un secreto: antes había que adivinar
  que se podía tocar el campo.

  ⚠️ **Aquí hubo un «visor» y duró unas horas**: un marco con esquinas rojas y
  un icono de código de barras. Ángel lo tumbó el mismo día con la razón
  correcta — **no es la cámara**. La cámara la abre el teléfono al pulsar
  (`capture="environment"`), así que eran 230 px enseñando algo que no pasa.
  Y el coste no era el hueco: con él, en una pantalla de 844 px, la lista de
  lo capturado hoy caía entera bajo el pliegue; sin él caben las tres filas
  sin desplazar. Si alguien vuelve a proponer un visor, que sea la cámara de
  verdad o que no esté.
- **Paso 2** — la ficha, con «¿Es esto lo que vendiste?» y el botón de volver.
- **Paso 3 — NO SE INVENTÓ: es el modal del seguro**, que ya existía y ya
  estaba probado en piso. Por eso `btnAdd` y `finalizarVenta` **no se
  tocaron**: hacer otro habría sido un segundo sitio donde decidir si una
  venta lleva Assurant.

⚠️ **`irPaso` es sólo qué se ve; la venta no pasa por ahí.** Tres detalles que
parecen cosmética y no lo son:

1. `paso2` se muestra con `n >= 2`, no con `n === 2`. El modal del seguro se
   abre ENCIMA de la ficha: con `=== 2` los dos pasos se ocultaban y, al
   cancelar el seguro, el asesor se encontraba **la pantalla en blanco**. Lo
   cazó la prueba, no la vista.
2. Al paso 2 se pasa **en cuanto se dispara la foto**, sin esperar al OCR: el
   asesor ve la ficha llenándose sola, que es lo que le dice que la lectura va
   bien. Esperando, la pantalla se quedaba quieta y parecía colgada.
3. El arranque lo fija `irPaso(1)` en el JS, no un `style="display:none"` en el
   marcado: el atributo se borra sin querer al editar y la pantalla abriría con
   los dos pasos encima, sin dar error.

**Las pestañas heredaron los identificadores de la barra de abajo** —`btnAcc`,
`btnCn`, `btnCsv`, `lockMsg`—, así que todo lo que ya sabía abrir cada panel
siguió funcionando sin tocarse. Cambió dónde se toca, no qué pasa al tocar. El
bloque de `pruebas/humo_captura.js` comprueba que esos ids **siguen existiendo
en el HTML**, y lo hace sobre el texto del archivo: el DOM de pruebas inventa
un elemento para cualquier id que se le pida, así que preguntarle habría dicho
que sí (probado con cebo).

**La pestaña del Concurso enseña los días que le quedan** (`24d`) y desaparece
sola cuando el periodo cierra. Pide `concurso_config` por su cuenta y **no
toca `_cnPeriodo`**: `abrirConcurso` sólo llama a `cnCargarConfig` cuando esa
variable está vacía, y rellenarla desde aquí saltaría la carga de la tabla de
roles — cada línea del ticket saldría «sin rol» y el ticket bajaría de nivel
sin un solo error.

**«2 de 3 con seguro»**, junto al nombre del asesor, es un RECUENTO de lo
capturado en este teléfono y por eso nunca es un porcentaje: el % con meta del
25 % es el del tablero, sale de Supabase y es de toda la tienda. Dos números
con la misma pinta para la misma pregunta y gana el de piso, que está más a
mano y es el que no vale.

Lo que **no** cambió: Mr Fix conserva su panel y su flujo (captura varias
líneas de un ticket, así que su «paso 2» sería una lista editable — otra
sesión), y el modo `?apartado=` sigue igual, con su tarjeta visible en los dos
pasos porque hay que ver a qué apartado se está ligando.

## Captura de Series: un solo botón sólido *(21-sep-2026, v265)*

Medido antes de tocar nada, con la pantalla abierta: **seis botones a la vista
y seis colores de fondo** distintos —rojo, gris, verde, naranja, dorado, azul—.
Todos gritaban igual, así que lo que el asesor hace veinte veces al día pesaba
lo mismo que lo que hace dos, y la pantalla no se parecía al menú nuevo (blanco,
gris claro e iconos 3D).

**Ahora el único sólido es «Agregar al reporte»**, que es el que cierra la
tarea. Lo demás pasa a tinte: el mismo color, en fondo claro y con la letra del
color. Qué color es cada cosa **se conserva a propósito** —naranja Mr Fix,
dorado concurso, azul la hoja de ventas—: eso no es adorno, dice a qué flujo y a
qué tabla va cada botón.

Y `Agregar` sigue **verde, no rojo de marca**: lleva meses en piso siendo verde,
y en un botón el rojo también se lee como «cuidado».

**La foto y los campos son UNA tarjeta.** Eran dos bloques sueltos con el
consejo de la luz flotando en medio, y la foto es el primer paso de rellenar
esos campos —de ahí salen la serie, el SKU y el precio—. Ahora van los tres
pasos en orden dentro de la misma tarjeta. Ningún identificador cambió:
`btnPhoto`, `btnGal`, `serie`, `sku` y `btnAdd` son los mismos que conocía el
resto del archivo, así que no se tocó una línea de lógica.

⚠️ **El contraste se mide, no se supone.** Los cuatro tintes se midieron contra
su letra (mínimo 4.5:1 para 14px en una pantalla que se mira con el sol del
pasillo):

| botón | antes | ahora |
|---|---|---|
| Mr Fix (naranja de marca sobre su tinte) | **2.66** ✗ | 4.85 con la letra en `#b8460f` |
| Agregar (blanco sobre `--verde`) | **4.28** ✗ | 4.99 con `#178046` sólo en el botón |
| Tomar foto · Concurso · Ventas | 4.60 · 4.82 · 4.83 | sin cambio |

La variable `--verde` **no** se tocó: la usan textos e insignias de toda la
pantalla, donde el verde va sobre blanco y ahí el problema no existe.

Lo que **no** se movió: los paneles (Mr Fix, Concurso, Ventas del día) por
dentro siguen igual —son otra pantalla, con su propio tema— y el botón morado
de `ap-modo`, que es la acción principal cuando se entra por `?apartado=`.

### Leer la foto: el realce no siempre ayuda *(21-sep-2026, v261)*

Ángel subió el ticket **34330** —foto buena: enfocada, plana, con luz— y la
pantalla no enseñó **nada**: tres artículos impresos, cero leídos. Tres fallos
encadenados, y ninguno daba error. Los tres se midieron con las fotos reales
del 34330 y del 34273, ocho tratamientos de imagen y ocho datos comprobados por
foto (ticket, fecha, vendedor, total, las tres líneas y el nivel):

| tratamiento | 34330 | 34273 |
|---|---|---|
| **foto cruda a color** | **8/8** | **8/8** |
| gris + contraste ×1.45 *(el de antes)* | 4/8 | 7/8 |
| gris sin contraste | 8/8 | 7/8 |
| gris + sharpen | 5/8 | 5/8 |

1. **El realce de contraste borra las fotos bien iluminadas.** La impresión
   térmica es gris claro; el contraste la manda a blanco y se pierden los
   trazos finos —los SKU de nueve dígitos y el `1` de la cantidad—. Existe
   porque rescata las fotos apagadas, así que no se cambió la constante:
   `accPreparar` acepta ahora un `trato` y `cnLeerFoto` **prueba la foto cruda
   primero y sólo vuelve a leer con realce si la cuenta no cierra**
   (`cnPuntuar`, que pesa sobre todo que las líneas menos sus descuentos den el
   Total). Cuesta lo mismo que antes cuando sale bien: una sola pasada grande.
   El flujo de accesorios **no** pasa `trato` y sigue igual — cambiarlo sin
   medirlo sería mover una tubería que hoy funciona.
2. **Los tratamientos que mejor leen el renglón pierden la cantidad.** Un `1`
   suelto entre dos columnas de espacios se evapora o sale como `|`, y con la
   cantidad exigida la línea **desaparecía entera**. Ahora se deduce de los
   otros dos números del propio renglón (`importe ÷ precio`); si la división no
   da un entero limpio se toma 1 y se avisa. El guardarraíl: los dos números
   que quedan tienen que traer su decimal, o «100276717 1 14999.000» se leería
   como precio 1 e importe 14999.
3. **Una letra pegada al nombre tiraba el core.** El margen dejó
   `UU CMATEPAD 12X`, y con `\bMATEPAD\b` esa `C` bastaba para dejar el MatePad
   `sin_rol`: sin core no hay nivel, y el ticket pasaba de PLATA a «no
   califica» con la cuenta cerrada y sin un solo aviso. Las fronteras
   izquierdas se quitaron en `concurso_roles.js` donde la palabra es
   inconfundible; **la derecha se conserva** donde separa dos cosas (`BAND\b`
   contra BANDA, `FIT ?\d` contra OUTFIT).

Y el SKU del genérico con un dígito cambiado (`43733` por `43739`) se repara,
porque el POS imprime «PRODUCTOS VARIOS» sólo para el genérico: las dos
condiciones —parecido a un dígito **y** ese nombre— van juntas, y el número
leído queda en `sku_ocr` con su aviso.

⚠️ **Lo que esto enseña para la próxima:** medir el OCR en Node **no basta**.
Los tres fallos se midieron con `sharp`, pero el de la letra pegada sólo
apareció al pasar la foto por el **canvas del navegador**, que escala distinto.
La prueba buena es la página real con la foto real; el fixture del volcado
(`pruebas/ocr_ticket_real11.txt`, anonimizado) es la red, no la medida.

### El marcador, también en el tablero *(21-sep-2026, v264)*

Tarjeta propia justo debajo de la del Assurant, en el Inicio de `tablero.html`:
los oros y platas de cada asesor, los días que quedan y el total de la tienda.
Pedido por Ángel — el marcador vivía sólo dentro de Captura de Series, que es
donde se sube el ticket, y **un concurso que hay que ir a consultar deja de
competir a la semana**. El tablero es la pantalla que el equipo abre sin ir a
buscar nada.

Sin SQL nuevo: `concurso_config` y `concurso_marcador` ya existían y el tablero
ya sabe llamarlas (`sbRpc`). La carga va en paralelo y **no entra en `CARGAS`**
ni en el banner de «faltan datos»: ese banner avisa de lo que hace falta para
vender, y una tienda sin concurso abierto no tiene nada que fallar.

⚠️ **Lo que hay que no romper: la tarjeta muere con el periodo.** La decisión
vive en dos funciones PURAS —`concursoVigente` y `concursoArmar`— separadas de
la llamada a propósito, porque con la red de por medio no habría cómo probarlas:

- periodo terminado → `null` → la tarjeta se retira **aunque ya estuviera
  pintada**. La PWA se queda abierta días y el concurso acaba un 15 de octubre
  con el teléfono encendido; un marcador congelado no se lee como terminado, se
  lee como el de hoy.
- sin respuesta → `undefined` → se deja lo que hubiera. Un corte de red no es
  el fin del concurso (mismo criterio que la preventa).

Los conteos llegan como TEXTO desde PostgREST y se convierten al armar: sin eso
el total de la tienda sale concatenado («35» en vez de 8). Y quien no ha llevado
ningún ticket sale con un guion, no con «🥇 0 🥈 0», que pinta como resultado y
es la ausencia de uno.

Los nombres **no están en `tablero.html`** —es público—: llegan de
`concurso_marcador` con la tienda de la sesión, igual que el leaderboard del
Assurant (ver `VENDEDORES_TB`). Todo el equipo lo ve, que es lo que decidió
Ángel: es la misma exposición que el attach por asesor, que ya estaba a la vista.

Las cinco cosas están en el bloque 14 de `pruebas/casos_tablero.js`, probadas
con cebos.

### Admin → 🏆 Concurso *(17-sep-2026, v246)*

Las dos cosas que se hacían pegando SQL en el panel de Supabase —dar de alta a
quien sale en el marcador y corregir el papel de un producto— ya tienen
pantalla, en una pestaña propia de `admin.html`. Pestaña aparte a propósito: el
concurso tiene fecha de término, y el día que acabe se quita entera sin tocar
nada más.

**Quién concursa se elige por NOMBRE.** Lo que decidió el diseño es el fallo que
la base no puede ver: un `empno` inventado lo rechaza la función —comprueba que
exista el empleado—, pero el de OTRO asesor lo acepta encantada, y lo que se ve
entonces es a alguien que no concursa sumando tickets, sin un solo error. La
lista de nombres sale de la sesión de gerente; con la otra puerta, el PIN de
Admin, la RLS de `empleados` no la deja leer y se cae al número tecleado. Por
eso, venga por donde venga, **lo que se enseña al terminar es el nombre que
devolvió el servidor**, no el que se eligió aquí: es la única comprobación que
queda en la puerta del PIN, y no sobra en la otra.

**El papel se elige entero** —Core / Accesorio Huawei / TechSmart / Servicio—, y
no `roles` por un lado y `clase` por otro. Sueltas se puede guardar «cuenta como
Core» con la etiqueta «Servicio»: eso no da ningún error, da un ORO que nadie
sabe explicar. Cada fila enseña al lado **lo que la app diría por sí sola**
(`concursoRolesDe`, el mismo archivo que usa Captura), para que una corrección
que repite lo que ya decía se vea como lo que es.

**Las tres lecturas van por `cnLeer`, no por `sbLeer`.** `sbLeer` se traga el
error y devuelve `[]`, que aquí significaría a la vez «no hay concurso activo» y
«no pude preguntar». La primera es normal el 16-oct; la segunda es una pantalla
que miente.

**Sin pantalla a propósito: borrar una fila de `concurso_roles`.** No existe
función para borrarla y no se añadió — una fila se corrige poniéndole el papel
que le toca, y la lista ya dice cuándo ese papel es el que la app daría sola, o
sea cuándo la fila ya no hace nada.

Probado contra la base real: el periodo, los participantes y los papeles llegan
y se pintan, y `43739` se anuncia como TechSmart antes de guardar nada. Las dos
escrituras llegan a su función y se paran en el token (`no_autorizado`), que es
justo lo que prueba que los parámetros cuadran. **La escritura con token bueno
no se probó**: habría dado de alta a alguien de verdad.
