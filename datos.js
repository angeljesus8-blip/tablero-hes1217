/* ============================================================
   TABLERO DEL EQUIPO — HES 1217 Angelópolis
   Archivo de DATOS. Ángel me comparte los comunicados / inventario
   y yo actualizo este archivo. La app lee de aquí automáticamente.

   Fechas en formato AAAA-MM-DD.  prioridad: "alta" resalta la tarjeta.
   ============================================================ */

window.DATOS = {
  // Se muestra como "Actualizado: ..." en la app
  actualizado: "2026-06-22 15:30",

  // 🔥 PROMOCIONES VIGENTES
  promos: [
    {
      titulo: "Watch Fit 5 — $300 de descuento",
      detalle: "Aplica en todas las correas. Precio final $2,699. Mencionar en cada demo de wearables.",
      precio: "$2,699",
      vigencia: "2026-06-30",
      prioridad: "alta"
    },
    {
      titulo: "FreeBuds 6 + estuche gratis",
      detalle: "Regalo de estuche protector con la compra. Stock limitado.",
      precio: "$2,499",
      vigencia: "2026-06-28",
      prioridad: "normal"
    },
    {
      titulo: "Pura 80 — 18 MSI",
      detalle: "18 meses sin intereses con tarjetas participantes. Ideal para ticket alto.",
      precio: "Desde $18,999",
      vigencia: "2026-07-15",
      prioridad: "normal"
    }
  ],

  // 🏷️ EOL / ÚLTIMA PIEZA EXHIBIDA AL 50%
  eol: [
    {
      titulo: "Mate XT (última pieza exhibida)",
      detalle: "Única pieza de piso. Autorizado vender al 50%. Revisar estética antes de cerrar.",
      precioAntes: "$59,999",
      precioAhora: "$29,999",
      sku: "MATEXT-001",
      prioridad: "alta"
    },
    {
      titulo: "Watch 5 44mm (descontinuado)",
      detalle: "Pieza de exhibición, sin caja original. 50% de descuento autorizado.",
      precioAntes: "$8,499",
      precioAhora: "$4,249",
      sku: "WATCH5-44",
      prioridad: "normal"
    }
  ],

  // 📦 MERCANCÍA QUE ENTRA / NOVEDADES
  novedades: [
    {
      titulo: "Nova 15 Max — ya en piso",
      detalle: "Nuevo ingreso. Revisar battle card en Capacitación antes de demostrar.",
      fecha: "2026-06-21",
      prioridad: "normal"
    },
    {
      titulo: "Watch Kids X1 — llega esta semana",
      detalle: "Ingreso programado. Enfocar a clientes con hijos pequeños.",
      fecha: "2026-06-25",
      prioridad: "normal"
    }
  ],

  // 📊 INVENTARIO / EXISTENCIAS (lo actualizo con el export diario)
  inventario: [
    { producto: "Watch Fit 5 Negro",        sku: "WF5-BLK",   stock: 8,  exhibe: 1 },
    { producto: "Watch Fit 5 Blanco",       sku: "WF5-WHT",   stock: 3,  exhibe: 1 },
    { producto: "FreeBuds 6",               sku: "FB6",       stock: 12, exhibe: 1 },
    { producto: "Pura 80 512GB",            sku: "PURA80-512",stock: 2,  exhibe: 1 },
    { producto: "Nova 15 Max",              sku: "NOVA15MAX", stock: 6,  exhibe: 1 },
    { producto: "Watch 5 44mm",             sku: "WATCH5-44", stock: 0,  exhibe: 1 },
    { producto: "Mate XT",                  sku: "MATEXT-001",stock: 0,  exhibe: 1 }
  ],

  // 📢 AVISOS GENERALES / META DEL DÍA
  avisos: [
    {
      titulo: "Meta Assurant Attach: >25%",
      detalle: "Ofrecer garantía Assurant en CADA venta de smartphone y wearable. Es el KPI crítico.",
      fecha: "2026-06-22",
      prioridad: "alta"
    },
    {
      titulo: "Cierre de caja a las 21:00",
      detalle: "Recordar cuadre de inventario de piso antes de cerrar.",
      fecha: "2026-06-22",
      prioridad: "normal"
    }
  ]
};
