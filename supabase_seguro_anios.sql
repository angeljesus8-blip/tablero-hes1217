-- ============================================================
--  LOS AÑOS DEL SEGURO
--  24-nov-2026
-- ============================================================
--
--  El tablero enseña cuánto va vendido en seguros hoy. El PRECIO vive en el
--  tablero (tabla SEGUROS); lo único que faltaba en la base era si la venta
--  llevó 1 o 2 años. Aquí no se guarda ningún importe.
--
--  ⚠️ ORDEN: primero este SQL, después la app. Al revés, la app manda un
--  parámetro que la función no tiene (PGRST202) y deja de guardar ventas.
--  Con el SQL puesto, la app de hoy sigue guardando igual: todo lo nuevo
--  lleva DEFAULT NULL.
--
--  Cómo lo hace: NO reescribe las funciones. Toma la que está viva en la base
--  y le agrega lo nuevo; si algo no está donde se espera, se detiene y no
--  cambia nada (todo va en una transacción). Se puede pegar dos veces.
--
--  NULL = no se sabe cuántos años (ventas de antes). No se rellena.
-- ============================================================

BEGIN;

ALTER TABLE public.ventas    ADD COLUMN IF NOT EXISTS seguro_anios smallint
  CHECK (seguro_anios IN (1, 2));
ALTER TABLE public.apartados ADD COLUMN IF NOT EXISTS seguro_anios smallint
  CHECK (seguro_anios IN (1, 2));

-- ── 1 · Guardar, corregir, apartar y el detalle del día ─────
DO $do$
DECLARE
  -- función, patrón, reemplazo, cuántas veces tiene que aparecer
  cambios text[][] := ARRAY[
    ['venta_guardar', '(p_quien text DEFAULT NULL::text)\)', '\1, p_seguro_anios integer DEFAULT NULL::integer)', '1'],
    ['venta_guardar', '\mgrupo, capturado_por\)', 'grupo, capturado_por, seguro_anios)', '1'],
    ['venta_guardar', '(nullif\(trim\(coalesce\(p_quien,''''\)\),''''\))\)', '\1, CASE WHEN p_seguro AND p_seguro_anios IN (1,2) THEN p_seguro_anios END)', '1'],

    ['venta_editar', '(p_quien text DEFAULT NULL::text)\)', '\1, p_seguro_anios integer DEFAULT NULL::integer)', '1'],
    -- Una app vieja no manda los años: se conservan los que había.
    ['venta_editar', '(con_seguro\s*=\s*p_seguro,)', '\1 seguro_anios = CASE WHEN p_seguro THEN coalesce(CASE WHEN p_seguro_anios IN (1,2) THEN p_seguro_anios END, seguro_anios) END,', '1'],
    ['venta_editar', '(''con_seguro'', v\.con_seguro,)', '\1 ''seguro_anios'', v.seguro_anios,', '2'],

    ['apartado_guardar', '(p_promesa date DEFAULT NULL::date)\)', '\1, p_seguro_anios integer DEFAULT NULL::integer)', '1'],
    ['apartado_guardar', '(precio, con_seguro,)', '\1 seguro_anios,', '1'],
    ['apartado_guardar', '(coalesce\(p_seguro, false\),)', '\1 CASE WHEN p_seguro AND p_seguro_anios IN (1,2) THEN p_seguro_anios END,', '1'],

    ['ventas_detalle', '(capturado_por text)\)', '\1, seguro_anios smallint)', '1'],
    ['ventas_detalle', '(\n\s+v\.capturado_por)(\s)', '\1, v.seguro_anios\2', '1'],
    ['ventas_detalle', '(''a'' \|\| a\.id::text, NULL::text)', '\1, a.seguro_anios', '1'],
    ['ventas_detalle', '(\n\s+t\.capturado_por)(\s)', '\1, t.seguro_anios\2', '1']
  ];
  f text; k int; i int; def text; firma text; v_veces int;
BEGIN
  FOREACH f IN ARRAY ARRAY['venta_guardar','venta_editar','apartado_guardar','ventas_detalle'] LOOP
    SELECT count(*) INTO k FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = f;
    IF k <> 1 THEN
      RAISE EXCEPTION 'Esperaba UNA %, hay %. No se tocó nada: avísale a Claude.', f, k;
    END IF;

    SELECT replace(pg_get_functiondef(p.oid), chr(13), ''), p.oid::regprocedure::text
      INTO def, firma
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = f;

    IF position('seguro_anios' IN def) > 0 THEN
      RAISE NOTICE '% ya tenía los años: se deja igual', f;
      CONTINUE;
    END IF;

    FOR i IN 1 .. array_length(cambios, 1) LOOP
      CONTINUE WHEN cambios[i][1] <> f;
      SELECT count(*) INTO v_veces FROM regexp_matches(def, cambios[i][2], 'g');
      IF v_veces <> cambios[i][4]::int THEN
        RAISE EXCEPTION '%: el cambio % aparece % veces y esperaba %. No se tocó nada: avísale a Claude.',
          f, i, v_veces, cambios[i][4];
      END IF;
      def := regexp_replace(def, cambios[i][2], cambios[i][3], 'g');
    END LOOP;

    -- Fuera la firma vieja: dos versiones vivas dejan a PostgREST sin saber cuál.
    EXECUTE 'DROP FUNCTION ' || firma;
    EXECUTE def;
    SELECT p.oid::regprocedure::text INTO firma
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = f;
    EXECUTE 'REVOKE ALL ON FUNCTION ' || firma || ' FROM public';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ' || firma || ' TO anon, authenticated';
  END LOOP;
END $do$;


-- ── 2 · ventas_hoy: los mismos conteos, y qué seguros fueron ──
-- El cuerpo es el de supabase_attach_apartados.sql; el porcentaje no cambia.
-- `seguros` es una lista de {sku, anios}: el tablero le pone el precio.
DROP FUNCTION IF EXISTS public.ventas_hoy(text);

CREATE FUNCTION public.ventas_hoy(p_store text)
RETURNS TABLE (vendedor text, con_seguro bigint, sin_seguro bigint, seguros jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH hoy AS (
    SELECT v.vendedor, v.con_seguro, v.sku, v.seguro_anios
    FROM public.ventas v
    WHERE v.store_id = p_store
      AND v.con_seguro IS NOT NULL
      AND (v.vendida_en AT TIME ZONE 'America/Mexico_City')::date
          = (now() AT TIME ZONE 'America/Mexico_City')::date
      AND NOT EXISTS (SELECT 1 FROM public.apartados a WHERE a.venta_id = v.id)

    UNION ALL

    SELECT a.vendedor, a.con_seguro, a.sku, a.seguro_anios
    FROM public.apartados a
    WHERE a.store_id = p_store
      AND a.estatus <> 'Cancelado'
      AND a.vendedor IS NOT NULL
      AND (a.creado_en AT TIME ZONE 'America/Mexico_City')::date
          = (now() AT TIME ZONE 'America/Mexico_City')::date
  )
  SELECT h.vendedor,
         count(*) FILTER (WHERE h.con_seguro)     AS con_seguro,
         count(*) FILTER (WHERE NOT h.con_seguro) AS sin_seguro,
         coalesce(jsonb_agg(jsonb_build_object('sku', h.sku, 'anios', h.seguro_anios))
                  FILTER (WHERE h.con_seguro), '[]'::jsonb) AS seguros
  FROM hoy h
  GROUP BY h.vendedor;
$$;

REVOKE ALL ON FUNCTION public.ventas_hoy(text) FROM public;
GRANT EXECUTE ON FUNCTION public.ventas_hoy(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;


-- ============================================================
--  COMPROBAR — pegar esto después
-- ============================================================
--  1 · Cinco filas, todas con  una = 1  y  anios = true:
--
--      SELECT p.proname, count(*) AS una,
--             bool_and(pg_get_functiondef(p.oid) LIKE '%seguro_anios%') AS anios
--        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public'
--         AND p.proname IN ('venta_guardar','venta_editar','apartado_guardar',
--                           'ventas_detalle','ventas_hoy')
--       GROUP BY 1 ORDER BY 1;
--
--  2 · Los mismos conteos que el tablero, con la columna `seguros`:
--
--      SELECT * FROM public.ventas_hoy('1217');
-- ============================================================
