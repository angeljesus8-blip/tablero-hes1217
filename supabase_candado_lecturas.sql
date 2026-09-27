-- ============================================================
--  EL CANDADO, TAMBIÉN EN LO QUE SE LEE DEL NEGOCIO
--  27-sep-2026 · PENDIENTE DE APLICAR — va DESPUÉS de supabase_candado.sql
-- ============================================================
--
--  Qué lo trae
--  -----------
--  `supabase_candado.sql` cerró la venta y los datos de clientes, pero dejó
--  abierto a propósito lo que se creía público: inventario, catálogo, promos,
--  EOL, combos y avisos. Ángel lo preguntó y la respuesta honesta es que no es
--  público: es el stock por SKU de una tienda (qué equipos caros hay hoy en
--  bodega, y cómo se mueven día a día) y el texto de las circulares internas.
--  Con la clave publicable del HTML lo podía leer cualquiera.
--
--  Siete funciones, y `tablero_todo`, que las junta:
--    inventario_vivo · catalogo_completo · promos_vigentes · eol_lista
--    avisos_vigentes · bundles_vigentes · eol_precio_venta
--
--  Cómo, sin copiar ningún cuerpo
--  ------------------------------
--  De `inventario_vivo` hay tres versiones en el repo, de `eol_precio_venta`
--  dos, de `avisos_vigentes` dos. Copiar «la última» a este archivo es apostar
--  a que la del repo es la de la base, y si no lo es, se pega una versión vieja
--  encima de la buena sin dar error. Por eso aquí NO se reescribe ninguna:
--
--  1 · La función viva se RENOMBRA a `<nombre>_filas_`. Su cuerpo, el de la
--      base, no se toca. Queda interna (sin permisos).
--  2 · Con el nombre de siempre se crea una PUERTA: pide `p_token`, pasa por
--      `candado_ok_` (el de supabase_candado.sql) y devuelve las filas de la
--      interna. Las columnas se copian de la función viva
--      (`pg_get_function_result`), no se escriben a mano.
--  3 · Toda función de la base que llamara a una de las siete por dentro
--      —`eol_precio_venta` llama a `inventario_vivo`, `tablero_todo` a todas—
--      se redirige a la interna. Si no, esa llamada entraría SIN token por la
--      puerta nueva: ensuciaría el contador y en el paso 2 se rompería. Se
--      buscan en la base, no en el repo: si hay alguna que el repo no conoce,
--      también se arregla.
--  4 · `tablero_todo` sin token válido ya no entrega nada.
--
--  Todo va dentro de UNA transacción: si algo falla, no queda nada a medias.
--  Si ya se pegó una vez, se detiene sin tocar nada (ver el primer RAISE).
--
--  ⚠️ ORDEN — IMPORTA
--  -------------------
--  1. Este SQL.   2. La app v291, que manda el token en estas lecturas.
--  Al revés, Captura y Admin mandarían `p_token` a funciones que no lo tienen,
--  recibirían PGRST202 y se quedarían sin catálogo ni promos.
--
--  Paso 2: el mismo `supabase_candado_exigir.sql` de siempre, que ahora cierra
--  también éstas. Se pega cuando `candado_sin_token` lleve un día de venta en
--  cero PARA TODAS (el contador ya separa por función).
-- ============================================================

BEGIN;

DO $do$
DECLARE
  nombres text[] := ARRAY['inventario_vivo', 'catalogo_completo', 'promos_vigentes',
                          'eol_lista', 'avisos_vigentes', 'bundles_vigentes',
                          'eol_precio_venta'];
  llamada text := '\m(inventario_vivo|catalogo_completo|promos_vigentes|eol_lista|'
               || 'avisos_vigentes|bundles_vigentes|eol_precio_venta)(\s*\()';
  n   text;
  k   int;
  sig text;
  res text;
  r   record;
BEGIN
  -- ── 1 · Cada una, a su interna ─────────────────────────────
  FOREACH n IN ARRAY nombres LOOP
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
                WHERE s.nspname = 'public' AND p.proname = n || '_filas_') THEN
      RAISE EXCEPTION '%_filas_ ya existe: este archivo ya se pegó. No se tocó nada.', n;
    END IF;

    SELECT count(*) INTO k FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
     WHERE s.nspname = 'public' AND p.proname = n;
    IF k <> 1 THEN
      RAISE EXCEPTION 'Esperaba UNA %, hay %. No se tocó nada: avísale a Claude.', n, k;
    END IF;

    SELECT pg_get_function_identity_arguments(p.oid) INTO sig
      FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
     WHERE s.nspname = 'public' AND p.proname = n;
    IF sig <> 'p_store text' THEN
      RAISE EXCEPTION '% tiene la firma (%), y esperaba (p_store text). No se tocó nada.', n, sig;
    END IF;

    EXECUTE format('ALTER FUNCTION public.%I(text) RENAME TO %I', n, n || '_filas_');
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(text) FROM public, anon, authenticated',
                   n || '_filas_');
  END LOOP;

  -- ── 2 · Quien las llamaba por dentro, a las internas ───────
  -- `pg_get_functiondef` devuelve el CREATE OR REPLACE completo, con su
  -- SECURITY DEFINER y su search_path; al volver a ejecutarlo se conservan los
  -- permisos y el dueño. Solo cambia `inventario_vivo(` por
  -- `inventario_vivo_filas_(`, y así con las siete. El nombre de la propia
  -- función no casa: ya termina en `_filas_`, y el patrón pide `(` detrás.
  FOR r IN
    SELECT p.oid, p.proname
      FROM pg_proc p
      JOIN pg_namespace s ON s.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
     WHERE s.nspname = 'public'
       AND l.lanname IN ('sql', 'plpgsql')
       AND p.prosrc ~ llamada
  LOOP
    EXECUTE regexp_replace(pg_get_functiondef(r.oid), llamada, '\1_filas_\2', 'g');
    RAISE NOTICE 'redirigida a las internas: %', r.proname;
  END LOOP;

  -- ── 3 · La puerta, con el nombre de siempre ────────────────
  -- Sin permiso devuelve CERO filas: la app que tiene el token nunca cae aquí,
  -- y la que no, ya enseña «Tu sesión es de antes».
  FOREACH n IN ARRAY nombres LOOP
    SELECT pg_get_function_result(p.oid) INTO res
      FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
     WHERE s.nspname = 'public' AND p.proname = n || '_filas_';
    IF res !~* '^(TABLE|SETOF)' THEN
      RAISE EXCEPTION '% devuelve % y no una tabla. No se tocó nada.', n, res;
    END IF;

    EXECUTE format($f$
      CREATE FUNCTION public.%I(p_store text, p_token text DEFAULT NULL)
      RETURNS %s
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
      AS $b$
      BEGIN
        IF NOT public.candado_ok_(p_store, p_token, %L) THEN
          RETURN;
        END IF;
        RETURN QUERY SELECT * FROM public.%I(p_store);
      END $b$
    $f$, n, res, n, n || '_filas_');

    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(text, text) FROM public', n);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(text, text) TO anon, authenticated', n);
  END LOOP;
END $do$;


-- ── 4 · tablero_todo: con token, todo; sin él, nada ─────────
-- Antes entregaba el inventario a cualquiera y sólo guardaba los apartados.
-- Ahora, sin token válido, contesta `{"ok": false}`: el tablero ve que no hay
-- inventario y se va por su camino de respaldo, que también pide el token.
-- Las siete se leen por sus internas: pasar por las puertas contaría la misma
-- llamada ocho veces en el contador.
CREATE OR REPLACE FUNCTION public.tablero_todo(p_store text, p_token text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF NOT public.candado_ok_(p_store, p_token, 'tablero_todo') THEN
    RETURN jsonb_build_object('ok', false, 'apartados_ok', false);
  END IF;
  RETURN jsonb_build_object(
    'inventario', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
                     FROM public.inventario_vivo_filas_(p_store) t),
    'eol',        (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
                     FROM public.eol_lista_filas_(p_store) t),
    'eol_venta',  (SELECT coalesce(jsonb_object_agg(t.sku, t.precio50), '{}'::jsonb)
                     FROM public.eol_precio_venta_filas_(p_store) t),
    'promos',     (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
                     FROM public.promos_vigentes_filas_(p_store) t),
    'bundles',    (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
                     FROM public.bundles_vigentes_filas_(p_store) t),
    'avisos',     (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
                     FROM public.avisos_vigentes_filas_(p_store) t),
    'apartados',  (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
                     FROM public.apartados_filas_(p_store) t),
    'apartados_ok', true,
    'ventas_hoy', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
                     FROM public.ventas_hoy(p_store) t)
  );
END $fn$;

NOTIFY pgrst, 'reload schema';

COMMIT;


-- ============================================================
--  COMPROBAR — pegar esto después y mirar las cuatro respuestas
-- ============================================================
--
--  1 · Cada una tiene su puerta (2 argumentos) y su interna (1):
--
--      SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
--             has_function_privilege('anon', p.oid, 'EXECUTE') AS anon
--        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public'
--         AND p.proname ~ '^(inventario_vivo|catalogo_completo|promos_vigentes|eol_lista|avisos_vigentes|bundles_vigentes|eol_precio_venta)(_filas_)?$'
--       ORDER BY 1;
--      -- Esperado: 14 filas. Las siete sin `_filas_` con «p_store text,
--      -- p_token text» y anon = true; las siete `_filas_` con «p_store text»
--      -- y anon = FALSE. Una interna con anon = true es una puerta abierta.
--
--  2 · Nadie llama ya a las puertas desde dentro de la base:
--
--      SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public'
--         AND p.prosrc ~ '\m(inventario_vivo|catalogo_completo|promos_vigentes|eol_lista|avisos_vigentes|bundles_vigentes|eol_precio_venta)\s*\(';
--      -- Esperado: CERO filas.
--
--  3 · Todo sigue saliendo con la app de hoy (sin token, paso 1):
--
--      SELECT count(*) FROM public.inventario_vivo('1217');
--      -- Esperado: el mismo número de SKUs de siempre (hoy, 244).
--      SELECT count(*) FROM public.eol_precio_venta('1217');
--      -- Esperado: el número de EOL con precio de venta (no un error).
--
--  4 · Con un token inventado, ya nada:
--
--      SELECT count(*) FROM public.inventario_vivo('1217', 'token-inventado');
--      -- Esperado: 0.
--      SELECT public.tablero_todo('1217', 'token-inventado');
--      -- Esperado: {"ok": false, "apartados_ok": false}
-- ============================================================
