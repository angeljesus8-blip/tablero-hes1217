# Modos del Apps Script que usa el tablero

El GAS ("tablero 1217", vinculado a la hoja *ventas laura*) **no está en este
repositorio** — vive en Google, y ese es un riesgo abierto: si se borra, se pierde
entero (923 líneas). No hay copia en ningún otro lado. Esta nota deja registro de qué le pide la app y de
los dos modos añadidos el 28-jul-2026.

URL base: `CLOUD_URL` en `tablero.html` · se consulta como `…/exec?modo=<nombre>`

## Modos que consume el tablero

| Modo | Devuelve | Para qué |
|---|---|---|
| `todo` | objeto con las 6 secciones + `ventas_hoy` | **Arranque normal** — un solo viaje |
| `inventario` | `{sku:{o,v,e,ev,d,p}}` | stock en vivo |
| `eol_cloud` | `[{sku,precio}]` | EOL para el 50% |
| `promos` | `{sku:{d,pr,pp,d1,d2}}` | promos vigentes |
| `bundles` | `[{id,nombre,skus,precio,d1,d2}]` | combos |
| `avisos_cloud` | `[{titulo,detalle,d2,…}]` | avisos |
| `apartados` | `[{id,sku,cliente,…}]` | cupo de preventa |
| `ventas_hoy` | `{fecha, vend:{nombre:{c,s}}}` | leaderboard Assurant |
| `ventas_detalle` | `{fecha, ventas:[{serie,sku,desc,precio,vend,seguro}]}` | las series del dia, para copiarlas una por una |

Los seis del medio siguen existiendo: son el **respaldo** si `modo=todo` no está
disponible (otra tienda con un GAS más viejo).

## Los dos modos añadidos

**`ventas_hoy`** — cuenta las ventas de hoy por vendedor separando con seguro (`c`)
y sin seguro (`s`), leyendo la hoja `Ventas`. Sin esto, el leaderboard solo veía las
capturas del propio celular.

**`todo`** — junta las seis lecturas en una respuesta. Medido: **4 s y 42 KB**,
contra ~20 s cuando van por separado (van de una en una porque Apps Script descarta
en silencio las llamadas encimadas).

**`ventas_detalle`** (2-ago-2026) — devuelve las series del dia con su
descripcion y precio. Laura las sube una por una a otra plataforma; `ventas_hoy`
no le sirve porque solo cuenta ventas por vendedor. Lo consume el panel "Ventas
del dia" de Captura de Series.

## Tres detalles de la hoja `Ventas` que hay que respetar

1. La fecha se guarda como **texto `28/7/2026`**, sin ceros a la izquierda
   (`guardarVenta_` antepone `'`). Comparar contra `dd/MM/yyyy` nunca coincide.
   Por eso `leerVentasHoy_` reutiliza `fmtFecha_`, que ya normaliza texto y Date.
2. La columna del vendedor es **`Vendedor`** (col. G), no `vend`.
3. **`Seguro`** (col. J) guarda `Si` / `No`, y está **vacía** en las ventas
   anteriores a julio-2026 (124 de 195 filas). Esas se ignoran: contarlas como
   "sin seguro" hundiría el attach sin razón.

## Al tocar el GAS

- Es **una sola pieza para todas las apps**: tablero, Captura de Series y Admin.
- `doGet` (lecturas) y `doPost` (guardar ventas) tienen ambos una rama que compara
  contra `'comisiones'`. Al insertar código por búsqueda de texto es fácil caer en
  el `doPost` por error — pasó al implementar esto. Verificar siempre en cuál de
  las dos funciones quedó.
- Un `modo` desconocido **no da error**: cae al `else` final y devuelve la lista
  completa de ventas. Por eso el tablero valida la *forma* de lo que recibe antes
  de usarla.
- Después de guardar hay que **volver a desplegar**: Implementar → Administrar
  implementaciones → ✏️ → Versión: Nueva. Editando la que ya existe, **nunca
  creando una nueva** (cambiaría la URL `/exec` y las tres apps dejarían de servir).

---

_Odemás · Grupo Gigante — uso interno HES 1217_
