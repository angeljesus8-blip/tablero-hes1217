/* ============================================================
   COMISIONES Y EXTRACOBERTURAS — por tienda (store_id como llave)
   Fuente: Sonar by Office Depot (odm-cloud.uc.r.appspot.com)
     · Reporte "Comisiones HES" → tabla "Detalle de comisiones por empleado"
     · Reporte "Attach" → "Garantías por fechas", desglosado a nivel empleado
   Cada gerente comparte captura del reporte de su propia tienda y se
   actualiza a mano bajo su store_id (Sonar no tiene API pública ni
   exporta a un link estable). NUNCA mezclar datos de distintas tiendas
   bajo la misma llave.
   ============================================================ */

window.COMISIONES = {
  "1217": {
    actualizado: "2026-07-06",
    periodoComisiones: "jul 2026 (mes a la fecha)",
    periodoGarantias: "1–5 jul 2026 (semana a la fecha)",

    empleados: [
      {
        nombre: "Miguel Ángel García Gutiérrez",
        puesto: "Subgerente de Tienda",
        venta: 184665.58,
        pptoPct: 20,
        alcance: 50.42,
        garantiaPct: 66.67,
        garantiaPzas: 2,
        garantiaElegible: 3,
        garantiaMonto: 2894.82
      },
      {
        nombre: "Arnulfo González Arrieta",
        puesto: "Asesor de Tienda",
        venta: 421704.54,
        pptoPct: 35,
        alcance: 65.8,
        garantiaPct: 39.13,
        garantiaPzas: 9,
        garantiaElegible: 23,
        garantiaMonto: 8319.81
      },
      {
        nombre: "Arturo Aguilar Rosete",
        puesto: "Asesor de Tienda",
        venta: 370071.23,
        pptoPct: 35,
        alcance: 57.74,
        garantiaPct: 50,
        garantiaPzas: 6,
        garantiaElegible: 12,
        garantiaMonto: 6184.48
      },
      {
        nombre: "Ángel de J. (Gerente)",
        puesto: "Gerente de Tienda",
        venta: 12195.45,
        pptoPct: 10,
        alcance: 54.55,
        garantiaPct: null,
        garantiaPzas: null,
        garantiaElegible: null,
        garantiaMonto: null
      }
    ]
  }
};
