-- ============================================================
--  EXPORTAR AL EXCEL REGIONAL DE COMISIONES
--  18-ago-2026
-- ============================================================
--
--  El reporte es `Registro_Ventas_MrFix_Odemas_2026.xlsx` en SharePoint: 128
--  hojas (tienda x mes). La de la tienda este mes es «1217 AGOS 26» — agosto
--  va ABREVIADO, y ese detalle basta para pegar en la hoja equivocada.
--
--  ------------------------------------------------------------
--  LA HOJA ESTA PROTEGIDA Y SOLO 7 COLUMNAS SE PUEDEN ESCRIBIR
--  ------------------------------------------------------------
--  Leido del archivo, no supuesto:
--
--    B  DIA                     <- se escribe (numero del dia: 1, 2, 3...)
--    C  TIENDA                     formula  =IF($G6="","",1217)
--    D  # TICKET                <- se escribe
--    E  SKU                     <- se escribe
--    F  NOMBRE DEL PRODUCTO     <- se escribe
--    G  CANTIDAD                <- se escribe
--    H  PRECIO UNITARIO         <- se escribe
--    I  PRECIO SIN IVA             formula  =$H6/1.16
--    J  TOTAL                      formula  =$H6*$G6
--    K  TOTAL S/IVA                formula  =$I6*$G6
--    L  COMISION                   formula  =$K6*0.03
--    M  PUESTO                     formula  INDEX/MATCH sobre el equipo
--    N  NOMBRE DEL EMPLEADO     <- se escribe
--
--  Los datos empiezan en la FILA 6 (los titulos estan en la 5).
--
--  ------------------------------------------------------------
--  EL NOMBRE TIENE QUE COINCIDIR LETRA POR LETRA
--  ------------------------------------------------------------
--  La columna M no se escribe: la deduce una formula que BUSCA el nombre del
--  empleado en la lista del equipo (P:Q). Si no coincide exacto, el puesto sale
--  vacio y la comision no se suma a nadie — sin dar ningun error.
--
--  Y no coincide sola. En el Excel los nombres van APELLIDOS primero, en
--  mayusculas y sin acentos, y encima uno esta escrito distinto:
--
--    en la app                        en el Excel
--    Arturo Aguilar rosette      ->   AGUILAR ROSETE ARTURO      (rosette/ROSETE)
--    Angel de Jesus Perea Arias  ->   PEREA ARIAS ANGEL DE JESUS
--
--  Por eso el mapeo es EXPLICITO por numero de empleado. Convertirlo con una
--  regla («voltea apellidos y quita acentos») acertaria hoy y fallaria el dia
--  que entre alguien con dos nombres o un apellido compuesto, y ese fallo se
--  ve un mes despues, cuando la region revisa.
--
--  Se pega completo en el SQL Editor. Es idempotente.
-- ============================================================


-- ── 1 · El nombre tal como lo espera el reporte ─────────────
ALTER TABLE public.empleados ADD COLUMN IF NOT EXISTS nombre_reporte text;

COMMENT ON COLUMN public.empleados.nombre_reporte IS
  'El nombre EXACTO que lleva el Excel regional de comisiones (APELLIDOS '
  'NOMBRE, mayusculas, sin acentos). Si no coincide letra por letra, la '
  'formula del PUESTO no lo encuentra y la comision no se suma a nadie.';

UPDATE public.empleados SET nombre_reporte = v.n
  FROM (VALUES ('749608','PEREA ARIAS ANGEL DE JESUS'),
               ('973345','GARCIA GUTIERREZ MIGUEL ANGEL'),
               ('747851','AGUILAR ROSETE ARTURO'),
               ('747854','GONZALEZ ARRIETA ARNULFO'),
               ('11857', 'BONILLA GALAN LAURA')) AS v(e, n)
 WHERE empleados.store_id = '1217' AND empleados.empno = v.e;


/* Sin la extension `unaccent` instalada: quita los acentos a mano. Hace falta
   porque la app guarda «Angel de Jesus» con acentos y la tabla de empleados
   tambien, pero no siempre igual escritos. */
CREATE OR REPLACE FUNCTION public.unaccent_(t text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT translate(coalesce(t,''),
                   'áéíóúüñÁÉÍÓÚÜÑ',
                   'aeiouunAEIOUUN');
$$;


-- ── 2 · Las filas listas para pegar ─────────────────────────
--
-- Devuelve exactamente lo que va en cada columna escribible, en el orden del
-- Excel. Sin formulas y sin las columnas bloqueadas: pegarlas encima falla
-- porque la hoja esta protegida.
--
-- `sin_nombre` avisa de las ventas cuyo vendedor no tiene nombre de reporte.
-- Se devuelven IGUAL, con el nombre de la app, para que se vean y se puedan
-- arreglar — esconderlas seria entregar el reporte corto sin saberlo.
CREATE OR REPLACE FUNCTION public.accesorios_reporte(
  p_store text,
  p_anio  integer DEFAULT NULL,
  p_mes   integer DEFAULT NULL
) RETURNS TABLE (
  dia integer, ticket text, sku text, producto text,
  cantidad integer, precio numeric, empleado text, sin_nombre boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH r AS (
    SELECT coalesce(p_anio, extract(year  from (now() AT TIME ZONE 'America/Mexico_City'))::int) AS a,
           coalesce(p_mes,  extract(month from (now() AT TIME ZONE 'America/Mexico_City'))::int) AS m
  )
  SELECT extract(day from v.dia)::int,
         v.ticket, v.sku, v.producto, v.cantidad, v.precio,
         coalesce(e.nombre_reporte, v.vendedor),
         (e.nombre_reporte IS NULL)
  FROM public.accesorios_ventas v, r
  -- Por nombre y no por empno: `vendedor` guarda a quien ATENDIO, que puede no
  -- ser quien capturo. Es el mismo criterio que el ticket.
  LEFT JOIN public.empleados e
         ON e.store_id = v.store_id
        AND upper(unaccent_(e.nombre)) = upper(unaccent_(v.vendedor))
  WHERE v.store_id = p_store
    AND extract(year  from v.dia)::int = r.a
    AND extract(month from v.dia)::int = r.m
  ORDER BY v.dia, v.vendida_en;
$$;

REVOKE ALL ON FUNCTION public.accesorios_reporte(text,integer,integer) FROM public;
GRANT EXECUTE ON FUNCTION public.accesorios_reporte(text,integer,integer) TO anon, authenticated;


-- ============================================================
--  COMPROBAR
-- ============================================================
--
--  1) Que los cinco tengan nombre de reporte. Si alguno sale vacio, su
--     comision no se sumaria en el Excel:
--       select empno, nombre, nombre_reporte from public.empleados
--        where store_id='1217' order by activo desc, nombre;
--
--  2) El reporte del mes en curso:
--       select * from public.accesorios_reporte('1217');
--
--  3) LO QUE HAY QUE MIRAR: ninguna fila con sin_nombre = true.
--       select count(*) from public.accesorios_reporte('1217') where sin_nombre;
--     Si sale mayor que cero, esas ventas entrarian al Excel con un nombre que
--     la formula del PUESTO no reconoce, y su comision no se sumaria a nadie.
--
-- ============================================================
--  Odemas · Grupo Gigante — uso interno HES 1217
-- ============================================================
