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
      ↓ devuelve store_id, nombre, gas_url, vendedores, gas_token
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

**Si cambias el token:** todos deben cerrar sesión y volver a entrar. Lo
guardado en `hes_store` no se actualiza solo.

---

## Cadena 2 · Escrituras al Apps Script

```
tablero.html      → apartado_add, eol_add      (mandan pin=TIENDA_ID)
captura_series    → guardar y eliminar venta   (POST)
admin.html        → comisiones, bundles, avisos, notificar
actualizar_datos  → catalogo, catalogo_ref, exhibicion, promos
```

**`ADMIN_PIN` en Propiedades del script DEBE ser `1217`.** El tablero manda el
número de tienda como PIN. Cambiarlo tumba **guardar en preventa** y marcar EOL.
No es inseguro: `accesoPermitido_(token)` corre **antes** que `checkPin_`.
*(1-ago-2026: se cambió y se cayó la preventa.)*

**`GAS_ESTRICTO` solo se pone en `true` cuando:** todos volvieron a entrar (para
tener token) **y** las apps saben avisar si las rechazan. *(1-ago-2026: se activó
antes de tiempo y se perdió un día de ventas sin que nadie se enterara.)*

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

## Lo que todavía puede fallar callando

26 `catch` vacíos repartidos en los seis html — `verificar.py` los lista. Son
los lugares donde la app puede fallar sin decir nada, que es lo que hizo que
todos los errores del 1-ago tardaran horas en verse en vez de minutos.
