# Migración completa a Supabase

Decidido el 2-ago-2026: se migra **todo**, incluidas las ventas. El Apps Script
y la hoja de cálculo dejan de ser el sistema.

Este documento existe para que se pueda revisar **antes** de que haya código, y
para saber en cada momento qué falta y qué se puede revertir.

---

## Qué queremos

Un solo sistema. Hoy hay dos verdades —la hoja y Supabase— y tres puertas: el
Apps Script con un token compartido, Supabase con RLS, y la hoja abierta a quien
tenga el enlace.

Lo que se gana, concreto:

- **Se acaba la cola.** Apps Script descarta en silencio las llamadas encimadas.
  Por eso el tablero las manda de una en una y `modo=todo` tarda ~4 s. En
  Supabase no hay cola ni descarte.
- **Seguridad de verdad.** Hoy el token es uno solo para toda la tienda: quien
  lo tiene, lo puede todo. Con RLS, cada quien ve lo suyo y el servidor lo
  impone, no la app.
- **Varias tiendas.** El esquema ya lleva `store_id` en las diez tablas.

## Qué se pierde, y hay que reponer

Esto no es efecto secundario: es trabajo del plan.

| Lo que hoy da la hoja | Cómo se repone |
|---|---|
| Editar una venta a mano en la hoja | Pantalla de edición en Admin |
| `autollenarSku_` llena desc y precio al teclear el SKU | Misma búsqueda, pero en la app |
| Consultar ventas del día | Ya está: panel de Captura de Series |
| Fotos de venta en Drive | Supabase Storage — **ver nota abajo** |

**Las fotos son más fáciles de lo que parecen:** `DIAS_RETENCION = 7`, se borran
solas a los 7 días. No hay histórico que mover; basta con que las nuevas vayan
a Storage y dejar que las viejas caduquen donde están.

## Lo delicado, por orden de riesgo

**1 · La fórmula del inventario.** `leerInventario_` no es una lectura: calcula
sobre dos cortes guardados en Propiedades del script (`ventaBaseline`,
`exhibBaseline`). Se verificó **contando cajas en piso** que On Hand NO incluye
la exhibición. Si esto se traduce mal, el tablero miente sobre el stock y nadie
lo nota hasta que falta mercancía. Los baselines hay que modelarlos como tabla,
no como propiedad suelta.

**2 · Las ventas.** Es el flujo que da de comer a la tienda y acaba de
estabilizarse tras perder capturas el 1-ago. Se migra con doble escritura, no de
un salto.

**3 · Las fechas.** La hoja guarda `2/8/2026` como texto; Postgres usa `date`.
Toda comparación que hoy es texto pasa a ser fecha real — mejor, pero hay que
convertir las ~200 existentes sin perder ninguna.

**4 · El precio EOL al 50%.** `leerEolVenta_` depende del inventario calculado.
Hereda el riesgo 1.

---

## Cómo se hará — cinco fases, cada una reversible

Ninguna fase avanza sin que la anterior esté comprobada. En todas, revertir es
volver una variable a su valor: el Apps Script sigue vivo hasta la fase 5.

### Fase 1 · Datos y paridad — sin tocar las apps
Cargar las ~838 filas a Supabase y escribir las funciones SQL equivalentes a
cada modo del GAS.

**La prueba:** para cada modo, pedir lo mismo al GAS y a Supabase y comparar las
respuestas. Mientras no sean idénticas, no se sigue.

Riesgo: ninguno. Las apps no se enteran.

**Se dio por cerrada el 2-ago y no lo estaba** *(revisado el 4-ago-2026)*.

Los datos sí quedaron cargados y responden: 215 SKUs, 117 promos, las ventas
históricas. Eso está bien. Lo que falló fue el criterio para darla por cerrada:
el commit dice *"las siete lecturas dan idéntico al Apps Script"*, y es verdad
—pero **las apps usan trece**. Se contaron las que se habían escrito, no las
que hacían falta. El inventario sale con un `grep` de los seis html en un
minuto; nadie lo hizo.

Faltaban: `todo` (el viaje único, que es de donde sale la velocidad),
`catalogo` (el autollenado de captura), `apartados` (la preventa), `eol_cloud`,
`comisiones` y `estado`. Escritas el 4-ago en
`supabase_funciones_lectura_resto.sql`.

**Aplicado en Supabase el 4-ago-2026**, y comprobado ahí mismo:

| Función | Devuelve | Cuadra con la fase 1 |
|---|---|---|
| `catalogo_completo` | 215 filas | 215 SKUs unificados ✓ |
| `eol_lista` | 133 | 133 EOL ✓ |
| `apartados_lista` | 9 | 9 apartados ✓ |
| `comisiones_lista` | 4 | 4 personas ✓ |
| `estado_datos` | 1 | — |
| `tablero_todo` | las 8 claves | — |

**El viaje único, medido: 0.32 s.** Contra los ~4 s del `modo=todo` del Apps
Script, que van casi enteros en la cola de 1.5 s que hace falta porque el GAS
descarta las llamadas encimadas. Ese número es la razón de la fase 2.

Queda **correr el comparador** (`MIGRACION_comparar.js`) y que las trece den
igual. Va desde el navegador con la sesión abierta, porque desde el 4-ago el
endpoint del GAS exige token.

### Resultado del comparador — 4-ago-2026, 01:40

Las trece, contra el GAS con la sesión abierta:

| | Lecturas |
|---|---|
| **IGUAL (8)** | catálogo · eol_cloud · apartados · promos · eol_venta · bundles · avisos · `todo` |
| **DISTINTO (5)** | inventario · ventas_hoy · ventas_detalle · comisiones · estado |

**Ninguna de las cinco difiere por la lógica. Las cinco son el mismo desfase.**
Supabase está congelado en el 2-ago y el GAS siguió recibiendo:

    catálogo subido    GAS 3-ago 17:41   ·   SB 2-ago 23:52
    SKUs vigentes      GAS 64            ·   SB 71
    ventas del 3-ago   GAS 8             ·   SB 0
    comisiones         GAS 4-ago         ·   SB 3-ago

Lo prueba comisiones mejor que nada: el GAS trae venta 62.503 y alcance 9,62 %
—agosto, cuatro días— y Supabase 474.255 y 68,74 % —julio cerrado—. **Cambió el
mes.** Las 21 diferencias de inventario son lo mismo: un On Hand reemplazado y
dos días de ventas que Supabase no vio.

Y el número que justifica todo esto, ya medido con datos reales:

**`todo`: Apps Script 8.255 ms · Supabase 373 ms. Veintidós veces.**

### FASE 1 CERRADA — 4-ago-2026, 03:10, con datos del mismo momento

Resincronizado con `resincronizar('1217')` y comparado enseguida:

| Lectura | |
|---|---|
| inventario | **IGUAL** · 215/215, cero diferencias de stock |
| catálogo · eol_cloud · eol_venta · promos | IGUAL |
| apartados · comisiones · ventas_hoy · ventas_detalle | IGUAL |
| bundles · avisos · `todo` | IGUAL |
| estado | difiere en promoCount — **y el que se equivoca es el GAS** |

Que **inventario dé idéntico** es lo que importaba: es la función que se
verificó contando cajas en piso y la que, mal traducida, haría que el tablero
mienta sobre el stock. 215 SKUs, ni una diferencia en onhand, vendido, stock ni
exhibición.

**Lo de `estado` no es un fallo de la migración, es uno que la migración
destapa.** El GAS reporta `promoCount = 141`, pero su propio `modo=promos`
devuelve **117**: el contador vive en Propiedades del script, se escribe a mano
en cada subida y se quedó viejo. Supabase cuenta las filas, así que el número
no puede desincronizarse de los datos porque *es* los datos.

**El viaje único, otra vez medido:** GAS 5.075 ms · Supabase 182 ms.

### Lo que esto enseña: la comparación caduca

Este plan decía "comparar cada modo hasta que den idéntico" y no decía lo más
importante: **la comparación vale para el instante en que se hace.** Los datos
se cargaron el 2-ago y se comparó el 4: cualquier diferencia se confunde con un
error de traducción, y estuvo a punto de parecerlo justo en la parte más
delicada, el inventario.

Mientras la carga sea un evento único y manual, la fase 1 no se puede cerrar de
forma estable: caduca en horas, en cuanto se sube el Excel del día.

**Lo que hay que hacer antes de darla por cerrada:** que la carga sea
repetible —volver a correrla cuando se quiera, sin romper nada— y comparar
inmediatamente después, el mismo día. Sin eso, cerrar la fase 1 es cuestión de
suerte con la hora a la que se mire.

Las dudas que quedaban de la carga sí se resolvieron: `bundles` y `avisos` dan
0 en los **dos** lados, así que las vigencias están vencidas y no era un fallo
de carga.

### Fase 2 · Lecturas
Las apps leen de Supabase. Si falla, caen al Apps Script solas.

Riesgo bajo, y es donde se cobra casi todo el beneficio de velocidad.

### Fase 3 · Ventas — doble escritura
Cada venta se guarda en los dos lados. Se comparan un par de días. Cuando
cuadren sin diferencias, se apaga la escritura al GAS.

Es la fase larga a propósito. No se acorta.

**Bloqueante, correr antes:** `supabase_ventas_devolucion.sql`. El esquema traía
`UNIQUE (store_id, serie)` — "una serie no se vende dos veces" — y es falso: si
un cliente devuelve un equipo y se revende, sale dos veces. Pasó el 8-jul y el
19-jul. Confirmado con Ángel el 4-ago que es normal.

Con la restricción vieja, la primera reventa haría fallar el `INSERT` **con el
cliente delante**, y los dos lados dejarían de cuadrar justo en la comparación
que decide si se apaga el GAS. La regla nueva —misma serie sí en días
distintos, no dos veces el mismo día— separa esa devolución de la doble captura
del 1-ago, que sí era un error.

Y en la app: cuando ese `INSERT` falle, la captura tiene que **decirlo**. Un
error que se calla ahí es una venta que nadie sabe si entró, que es exactamente
lo que costó un día de ventas el 1-ago.

### Fase 4 · Fotos, autollenado y edición
Storage para las nuevas fotos; el autollenado y la edición de ventas se
reconstruyen en Admin. Aquí es cuando la hoja deja de hacer falta.

### Fase 5 · Retirar el Apps Script
Solo cuando las cuatro anteriores lleven días estables. La hoja se queda como
respaldo de solo lectura, sin nada que dependa de ella.

---

## Qué resultados dará

- El tablero abre sin los ~4 s de espera y sin llamadas descartadas
- Un solo lugar donde está la verdad
- Cada persona ve lo que le toca, impuesto por el servidor
- Listo para una segunda tienda sin duplicar nada

## Qué implica

- Es la cirugía más grande que se le ha hecho al sistema
- Toca el flujo de ventas, que es el que no puede fallar
- La hoja deja de ser herramienta: lo que hoy se hace ahí, se hará en Admin
- No se hace en una sesión

## Antes de empezar la fase 1

Cerrar el candado (bloque B). Migrar dejando el endpoint viejo abierto es
quedarse con dos puertas al mismo dato — justo lo que esta migración viene a
resolver.

---

_Odemás · Grupo Gigante — uso interno HES 1217_
