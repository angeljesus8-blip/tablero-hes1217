# Fase 1 · Lo que no va a entrar tal cual

Cotejo de las 855 filas de la hoja contra el esquema nuevo, 2-ago-2026.

El esquema de Supabase es mucho más estricto que la hoja: serie única, fecha de
vigencia obligatoria, precio promo menor que el regular, llave primaria por SKU.
La hoja no impone nada de eso. Esto es lo que aparece al comparar, **antes** de
mover un solo dato.

Casi todo está limpio. Lo que no, no es problema de la migración: son descuadres
que ya existen hoy y que la hoja nunca señaló.

---

## 1 · Cinco ventas sin SKU — el inventario está inflado

| Fila | Fecha |
|---|---|
| 59 | 4/7/2026 |
| 90 | 9/7/2026 |
| 96 | 11/7/2026 |
| 114 | 12/7/2026 |
| 178 | 25/7/2026 |

`leerInventario_` descuenta contando ventas **por SKU**. Sin SKU, esas cinco
ventas no descuentan nada: **el tablero muestra 5 piezas más de las que hay.**

Llevan así desde julio. No lo causa la migración; la migración lo destapó
porque `ventas.sku` es `NOT NULL`.

Para arreglarlo hay que ponerles el SKU a mano, mirando la serie o la foto —
177 de las 223 ventas tienen foto, así que probablemente se pueda.

## 2 · Dos series repetidas, y no son el mismo caso

El esquema nuevo tiene `UNIQUE (store_id, serie)`: una serie no se vende dos
veces. Hay dos que sí aparecen dos veces.

**Serie terminada en 4925** — filas 88 y 147, del **8-jul y el 19-jul**, once
días de diferencia, mismo SKU, precio y vendedor.
Tiene toda la pinta de una **devolución y reventa**: se vendió, la regresaron,
se volvió a vender. Es legítimo, y el esquema con `UNIQUE` no lo permitiría.

**Serie terminada en 3098** — filas 209 y 218, **las dos del 1-ago**, mismo SKU,
precio y vendedor.
Esto parece **doble captura del mismo equipo**, no dos ventas. Y el 1-ago fue
justo el día en que la app decía que guardaba sin guardar y se recapturó a mano.

Si es doble captura, hoy el inventario está descontando 2 piezas donde se vendió
1 — al revés del punto anterior.

**Hay que decidir dos cosas:**
- Si la del 1-ago es duplicado, se borra una y el inventario se corrige.
- Si las devoluciones son normales, `UNIQUE (store_id, serie)` está mal pensado
  y debe ser `UNIQUE (store_id, serie, vendida_en::date)` o llevar un estado de
  devolución. Mejor decidirlo ahora que después de migrar.

## 3 · 111 de 133 EOL no tienen precio en ningún lado

Ni propio en `EOL_cloud`, ni en el catálogo. Se comprobó cruzando las dos hojas.

`leerEolVenta_` calcula el 50% sobre el precio del EOL, y si no hay, sobre el
del catálogo. Sin ninguno de los dos, descarta el SKU: **esos 111 nunca van a
mostrar precio de remate** si llegan a quedarse solo con la pieza de exhibición.

Hoy no se nota porque solo aplica a los que están en estado "listo". Pero es un
precio que la tienda no puede cobrar.

## 4 · El catálogo se unifica en 215 SKUs

`Catalogo` (71) y `Catalogo_ref` (214) comparten **70 SKUs**. En el esquema
nuevo son una sola tabla con `vigente boolean`:

- 71 vigentes (los del Excel del día, con On Hand y precio)
- 144 no vigentes (los agotados que el cliente sigue pidiendo)
- 215 en total

No hay SKU repetido dentro de ninguna de las dos, así que la fusión es directa.

---

## Lo que sí está limpio

| Hoja | Filas | Resultado |
|---|---|---|
| Promos | 117 | sin repetidos, todas con fecha de fin, ningún precio promo ≥ regular |
| Bundles | 20 | todos con fecha, precio y SKUs |
| Exhibición | 64 | sin repetidos, sin negativos |
| Apartados | 9 | todos con SKU y cliente |
| Comisiones | 4 | todos con nombre |
| Avisos | 1 | — |
| Catálogo | 71 | sin SKU vacío ni repetido |

Que Promos salga limpia es notable: es la hoja que más ha dado problemas, y hoy
las 117 tienen fecha de fin. El arreglo del 1-ago quedó bien.

---

## Antes de cargar nada

1. **Decidir qué pasa con la venta del 1-ago** (¿duplicado o no?)
2. **Decidir si `UNIQUE (store_id, serie)` es correcto** o hay que permitir
   devoluciones
3. **Poner SKU a las cinco ventas** de julio, o cargarlas con un SKU marcador
   tipo `SIN-SKU` para no perderlas

Los puntos 1 y 2 son decisiones de Ángel. El 3 se puede hacer con las fotos.

Nada de esto se arregla migrando: son datos que hay que tocar a mano una vez.

---

_Odemás · Grupo Gigante — uso interno HES 1217_
