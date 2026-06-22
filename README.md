# Tablero del Equipo — HES 1217 Angelópolis

App móvil para que los vendedores consulten en su celular, en un solo lugar:
🔥 Promociones vigentes · 🏷️ EOL/última pieza al 50% · 📦 Mercancía nueva · 📊 Inventario · 📢 Avisos.

Acceso por **link + QR** (sin instalar nada). Buscador y filtros por categoría.

## Archivos
- `index.html` — la app (diseño + lógica). **No se toca normalmente.**
- `datos.js` — **aquí vive toda la información.** Esto es lo que se actualiza.
- `logo_odemas.png` — branding Odemás.
- `deploy.ps1` — sube los cambios a Netlify.

## Cómo se actualiza (flujo con Claude)
1. Ángel comparte el comunicado (PDF/imagen) o el export de inventario del día.
2. Claude lo digiere y actualiza `datos.js` (y la fecha de "Actualizado").
3. Se ejecuta `deploy.ps1` → la página queda al día. **El link y el QR NO cambian.**

## Actualizar a mano (opcional)
Editar `datos.js`. Cada bloque (`promos`, `eol`, `novedades`, `inventario`, `avisos`)
es una lista de tarjetas. Copiar una entrada existente y cambiar los textos.
- Fechas: formato `AAAA-MM-DD`.
- `prioridad: "alta"` resalta la tarjeta.
- Inventario: `stock` 0 = rojo, 1-3 = naranja, 4+ = verde (semáforo automático).

## Deploy
```powershell
./deploy.ps1
```
Después del primer deploy, generar el QR del link que devuelva Netlify y pegarlo en cajas/trastienda.
