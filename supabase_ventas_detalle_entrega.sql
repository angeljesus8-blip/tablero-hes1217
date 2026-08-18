-- ============================================================
--  DISTINGUIR LAS ENTREGAS EN «VENTAS DEL DÍA»
--  17-ago-2026  ·  ampliado el mismo dia con `cobrado_en`
-- ============================================================
--
--  En la lista de Ventas del día, una entrega de preventa o de traspaso se ve
--  hoy exactamente igual que una venta normal. Y no lo es:
--
--    · el cliente PAGÓ semanas antes — el ticket del POS es de otro día, y a
--      menudo de otro MES (ya está en el MAPA, cadena 6-ter)
--    · NO cuenta para el Assurant del día ni descuenta stock, porque ambas
--      cosas ya pasaron el día del apartado
--    · NO se puede corregir con el ✏️: la venta la creó `apartado_entregar` y
--      el apartado la sigue apuntando
--
--  O sea que quien cuadra la caja contra el POS ve renglones que no va a
--  encontrar, sin ninguna pista de por qué. La distinción no es decorativa: es
--  la explicación de las tres cosas de arriba.
--
--  Se añade `entrega` a `ventas_detalle`: NULL para una venta normal,
--  'preventa' o 'traspaso' para las que salen de un apartado.
--
--  ------------------------------------------------------------
--  POR QUÉ HAY QUE DROPEAR
--  ------------------------------------------------------------
--  Cambia el RETURNS TABLE, y Postgres no deja reemplazar el tipo de retorno de
--  una función con `CREATE OR REPLACE`. Sin el DROP, el pegado falla con
--  "cannot change return type of existing function" — que al menos avisa; lo
--  peligroso sería una firma distinta, que crearía una sobrecarga y PostgREST
--  respondería PGRST203.
--
--  Se pega completo en el SQL Editor. Es idempotente.
-- ============================================================


DROP FUNCTION IF EXISTS public.ventas_detalle(text, date);

CREATE FUNCTION public.ventas_detalle(p_store text, p_fecha date DEFAULT NULL)
RETURNS TABLE (serie text, sku text, descripcion text, precio numeric,
               vendedor text, con_seguro boolean, vendida_en timestamptz,
               captura_id text, tiene_foto boolean,
               -- NULL = venta normal. 'preventa' / 'traspaso' = sale de un apartado.
               entrega text,
               -- Cuando se COBRO el apartado. NULL en una venta normal, porque
               -- ahi cobro y entrega son el mismo momento y ya lo dice vendida_en.
               cobrado_en timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT v.serie, v.sku, v.descripcion, v.precio, v.vendedor, v.con_seguro,
         v.vendida_en, v.captura_id,
         EXISTS (SELECT 1 FROM public.venta_fotos f
                  WHERE f.store_id = v.store_id AND f.captura_id = v.captura_id),
         /* El tipo del apartado que generó esta venta, si lo hay. Es el MISMO
            vínculo que usan `inventario_vivo`, `ventas_hoy`, `cargar_cortes` y
            `comparar_ventas` para excluirlas: `a.venta_id = v.id`. Aquí no se
            excluye nada — se enseña, que es justo lo que faltaba. */
         (SELECT a.tipo      FROM public.apartados a WHERE a.venta_id = v.id LIMIT 1),
         /* La fecha del cobro. Es la que dice en QUE CORTE esta el ticket: el
            cliente pago semanas antes, a veces en otro mes, asi que buscarlo en
            el de hoy es no encontrarlo. Sale del apartado, no de la venta —
            `vendida_en` es el dia de la ENTREGA. */
         (SELECT a.creado_en FROM public.apartados a WHERE a.venta_id = v.id LIMIT 1)
  FROM public.ventas v
  WHERE v.store_id = p_store
    AND (v.vendida_en AT TIME ZONE 'America/Mexico_City')::date
        = coalesce(p_fecha, (now() AT TIME ZONE 'America/Mexico_City')::date)
  ORDER BY v.vendida_en;
$$;

REVOKE ALL ON FUNCTION public.ventas_detalle(text,date) FROM public;
GRANT EXECUTE ON FUNCTION public.ventas_detalle(text,date) TO anon, authenticated;

COMMENT ON FUNCTION public.ventas_detalle(text,date) IS
  'Las ventas de un dia para el panel de Captura. `entrega` distingue las que '
  'salen de un apartado (preventa/traspaso): esas se cobraron semanas antes, no '
  'cuentan para el Assurant del dia ni descuentan stock, y no se pueden corregir '
  'con el lapiz.';


-- ============================================================
--  COMPROBAR
-- ============================================================
--
--  1) Un día con entregas — las de apartado traen `entrega` y `cobrado_en`;
--     las ventas normales, ninguno de los dos:
--       select serie, vendedor, entrega, cobrado_en
--         from public.ventas_detalle('1217','2026-08-16');
--
--  2) Que cuadre con los apartados entregados de ese día:
--       select a.tipo, count(*) from public.apartados a
--         join public.ventas v on v.id = a.venta_id
--        where a.store_id = '1217'
--          and (v.vendida_en at time zone 'America/Mexico_City')::date = '2026-08-16'
--        group by a.tipo;
--
--     Los totales por tipo tienen que coincidir con lo que devuelve la 1.
--
-- ============================================================
--  Odemás · Grupo Gigante — uso interno HES 1217
-- ============================================================
