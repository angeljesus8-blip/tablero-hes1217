-- ============================================================
--  EL CANDADO QUE LE FALTABA A LA VENTA Y A LOS APARTADOS
--  27-sep-2026 · PASO 1 de 2 — PENDIENTE DE APLICAR
-- ============================================================
--
--  Qué lo trae
--  -----------
--  La clave publicable va escrita en el HTML, y el repo es PÚBLICO. Con ella,
--  cualquiera puede llamar a las funciones de la base sin haber entrado a la
--  app. Casi todas se defienden con `escritura_ok_(p_store, p_token)`. Tres no:
--
--  1 · `venta_guardar` — nació el 4-ago como copia de la hoja («doble
--      escritura»), cuando la hoja era la verdad y esto era un extra. El 17-ago
--      la hoja dejó de recibir ventas y ESTA pasó a ser la única puerta, pero el
--      candado nunca se le puso. Cualquiera podía meter ventas: descontar stock,
--      mover el Assurant Attach y el concurso, y escribir en `vendedor` lo que
--      quisiera — y ese texto se pintaba tal cual en el leaderboard del tablero
--      de TODOS los celulares (v290 lo escapa, pero la puerta es ésta).
--      La copia de odemás lo cerró el 1-sep (ver su supabase_venta_grupo.sql);
--      aquí nunca llegó.
--
--  2 · `apartados_lista` — devuelve el NOMBRE y el TELÉFONO de cada cliente con
--      apartado. Mismo caso que las comisiones del 6-sep, pero con datos de
--      clientes, que además tienen ley (LFPDPPP).
--
--  3 · `tablero_todo` — lleva dentro `apartados_lista`, así que era la misma
--      fuga por otra puerta. El resto de lo que trae (inventario, promos, EOL,
--      avisos) sí es público a propósito y se sigue entregando sin token.
--
--  Por qué en DOS pasos
--  --------------------
--  Exigir el token de golpe dejaría sin apartados, y con las ventas en cola, a
--  cada celular que siga en v289 hasta que se actualice. Las ventas NO se
--  perderían —se quedan en la cola del teléfono y el token se pone al enviar—,
--  pero no hay por qué pasar por eso.
--
--  · PASO 1 (este archivo): las tres piden `p_token`. Un token EQUIVOCADO ya se
--    rechaza. Un token AUSENTE todavía se deja pasar, pero se CUENTA en
--    `candado_sin_token`, por función y por día.
--  · Se publica la app v290, que manda el token.
--  · PASO 2 (`supabase_candado_exigir.sql`): cuando el contador lleve un día de
--    venta en cero, se pega y el token ausente también se rechaza.
--
--  El contador es lo que decide cuándo, no el calendario: «ya pasó un día»
--  no dice nada de un celular que nadie abrió en ese día.
--
--  ⚠️ ORDEN — IMPORTA
--  -------------------
--  1. Primero este SQL.  2. Después la app v290.
--  Al revés, la app manda un `p_token` que la función aún no conoce, recibe
--  PGRST202 y deja de guardar ventas.
-- ============================================================


-- ── 1 · El contador de llamadas sin token ───────────────────
-- Una fila por tienda, función y día. Solo lo escribe `candado_ok_`; nadie lo
-- lee desde la app, así que RLS sin políticas: cerrado a anon y authenticated.
CREATE TABLE IF NOT EXISTS public.candado_sin_token (
  store_id text        NOT NULL,
  funcion  text        NOT NULL,
  dia      date        NOT NULL,
  n        integer     NOT NULL DEFAULT 0,
  ultimo   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, funcion, dia)
);
ALTER TABLE public.candado_sin_token ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.candado_sin_token FROM anon, authenticated;


-- ── 2 · La guarda ───────────────────────────────────────────
-- Envuelve a `escritura_ok_`, que es la misma de todas las demás escrituras.
-- VOLATILE (el defecto) y NO `STABLE`: escribe en el contador, y PostgREST corre
-- las STABLE en transacción de solo lectura — daría 25006 y la app lo pintaría
-- como «sin conexión». Lo mismo vale para las tres que la llaman.
--
-- Solo cuenta tiendas que existen: si no, cualquiera podría llenar la tabla
-- inventándose store_id.
CREATE OR REPLACE FUNCTION public.candado_ok_(p_store text, p_token text, p_funcion text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF coalesce(p_token, '') <> '' THEN
    RETURN public.escritura_ok_(p_store, p_token);
  END IF;

  IF EXISTS (SELECT 1 FROM public.tiendas t WHERE t.store_id = p_store) THEN
    INSERT INTO public.candado_sin_token AS c (store_id, funcion, dia, n, ultimo)
    VALUES (p_store, p_funcion, (now() AT TIME ZONE 'America/Mexico_City')::date, 1, now())
    ON CONFLICT (store_id, funcion, dia)
    DO UPDATE SET n = c.n + 1, ultimo = now();
  END IF;

  -- PASO 1: sin token todavía se deja pasar. El paso 2 cambia esta línea.
  RETURN true;
END $fn$;

REVOKE ALL ON FUNCTION public.candado_ok_(text,text,text) FROM public, anon, authenticated;


-- ── 3 · Fuera TODAS las versiones anteriores ────────────────
-- De `venta_guardar` hay cinco en los .sql del repo y de `apartados_lista`
-- tres. Si en la base sobreviviera cualquier firma vieja, seguiría abierta a
-- anon (Postgres da EXECUTE a PUBLIC al crear) y el candado no serviría de
-- nada. Por eso no se nombran firmas: se borran todas las que haya.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS firma
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('venta_guardar', 'apartados_lista', 'tablero_todo')
  LOOP
    EXECUTE 'DROP FUNCTION ' || r.firma;
  END LOOP;
END $$;


-- ── 4 · venta_guardar, con candado ──────────────────────────
-- El cuerpo es el de supabase_venta_capturado_por.sql (22-sep), sin cambios,
-- más la guarda al principio. `p_token` va antes de `p_quien`, en el mismo
-- sitio que en odemás, para que un port entre las dos no mueva nada.
CREATE FUNCTION public.venta_guardar(
  p_store      text,
  p_serie      text,
  p_sku        text    DEFAULT NULL,
  p_desc       text    DEFAULT NULL,
  p_precio     numeric DEFAULT NULL,
  p_vendedor   text    DEFAULT NULL,
  p_seguro     boolean DEFAULT NULL,
  p_fecha      text    DEFAULT NULL,
  p_hora       text    DEFAULT NULL,
  p_foto_url   text    DEFAULT NULL,
  p_captura_id text    DEFAULT NULL,
  p_de_exhibicion boolean DEFAULT false,
  p_grupo      text    DEFAULT NULL,
  -- DEFAULT NULL: la app v289 no lo manda y en el paso 1 tiene que seguir
  -- guardando. En el paso 2 una venta sin token vuelve «sin permiso» y se
  -- queda en la cola del teléfono hasta que la app se actualice.
  p_token      text    DEFAULT NULL,
  p_quien      text    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_cuando timestamptz;
  v_d int; v_m int; v_a int; v_h int := 12; v_min int := 0;
  m text[];
  nuevo bigint;
BEGIN
  -- Antes que nada: quien no trae la clave de la tienda, no escribe en ella.
  -- Mismo texto de error que odemás: la cola del cliente lo trata como
  -- reintentable, que es lo correcto — no es un problema de la venta.
  IF NOT public.candado_ok_(p_store, p_token, 'venta_guardar') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sin permiso de escritura');
  END IF;

  IF coalesce(trim(p_serie),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sin serie');
  END IF;

  m := regexp_match(coalesce(p_fecha,''), '^\s*(\d{1,2})/(\d{1,2})/(\d{4})\s*$');
  IF m IS NOT NULL THEN
    v_d := m[1]::int; v_m := m[2]::int; v_a := m[3]::int;
    m := regexp_match(coalesce(p_hora,''), '^\s*(\d{1,2}):(\d{2})\s*([ap])');
    IF m IS NOT NULL THEN
      v_h := m[1]::int; v_min := m[2]::int;
      IF lower(m[3]) = 'p' AND v_h < 12 THEN v_h := v_h + 12; END IF;
      IF lower(m[3]) = 'a' AND v_h = 12 THEN v_h := 0; END IF;
    END IF;
    v_cuando := make_timestamp(v_a, v_m, v_d, v_h, v_min, 0) AT TIME ZONE 'America/Mexico_City';
  ELSE
    v_cuando := now();
  END IF;

  INSERT INTO public.ventas
    (store_id, vendida_en, serie, sku, descripcion, precio, vendedor, con_seguro,
     foto_url, captura_id, de_exhibicion, grupo, capturado_por)
  VALUES (p_store, v_cuando, trim(p_serie), nullif(trim(coalesce(p_sku,'')),''),
          nullif(trim(coalesce(p_desc,'')),''), p_precio,
          coalesce(nullif(trim(coalesce(p_vendedor,'')),''), '(sin nombre)'),
          p_seguro, nullif(trim(coalesce(p_foto_url,'')),''),
          nullif(trim(coalesce(p_captura_id,'')),''),
          coalesce(p_de_exhibicion, false),
          nullif(trim(coalesce(p_grupo,'')),''),
          nullif(trim(coalesce(p_quien,'')),''))
  ON CONFLICT (store_id, serie, dia_venta) DO NOTHING
  RETURNING id INTO nuevo;

  IF nuevo IS NULL THEN
    -- Reintentar es seguro: la misma serie el mismo día ya está guardada.
    RETURN jsonb_build_object('ok', true, 'duplicada', true);
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', nuevo);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLSTATE || ': ' || left(SQLERRM, 140));
END $fn$;


-- ── 5 · Los apartados: las filas por un lado, la puerta por otro ──
-- `apartados_filas_` es el cuerpo de supabase_apartados_traspaso.sql (8-ago),
-- sin cambios, y NO se expone: la usan las dos puertas de abajo, cada una con
-- su candado. Así hay un solo sitio que diga qué es un apartado, y el contador
-- sabe por cuál de las dos entró la llamada.
CREATE OR REPLACE FUNCTION public.apartados_filas_(p_store text)
RETURNS TABLE (id bigint, sku text, cliente text, telefono text,
               piezas integer, con_seguro boolean, estatus text,
               vendedor text, creado_en timestamptz,
               color text, precio numeric, transaccion text,
               serie text, asignado_en timestamptz, entregado_en timestamptz,
               entregado_por text, venta_id bigint,
               tipo text, origen text, promesa date, dias_tarde integer,
               cupo integer, apartadas integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT a.id, a.sku, a.cliente, a.telefono, a.piezas, a.con_seguro,
         a.estatus, a.vendedor, a.creado_en,
         a.color, a.precio, a.transaccion,
         a.serie, a.asignado_en, a.entregado_en, a.entregado_por, a.venta_id,
         a.tipo, a.origen, a.promesa,
         -- Días de retraso, calculados aquí y no en el navegador: el celular
         -- puede tener la fecha mal y esto decide a qué cliente hay que llamar.
         CASE WHEN a.promesa IS NOT NULL AND a.estatus NOT IN ('Entregado','Cancelado')
              THEN ((now() AT TIME ZONE 'America/Mexico_City')::date - a.promesa)::int
              ELSE NULL END AS dias_tarde,
         pc.cupo,
         (SELECT coalesce(sum(x.piezas), 0)::int
            FROM public.apartados x
           WHERE x.store_id = a.store_id AND x.sku = a.sku
             AND x.estatus <> 'Cancelado') AS apartadas
  FROM public.apartados a
  LEFT JOIN public.preventa_cupo pc
         ON pc.store_id = a.store_id AND pc.sku = a.sku
  WHERE a.store_id = p_store
  ORDER BY a.creado_en DESC;
$$;

REVOKE ALL ON FUNCTION public.apartados_filas_(text) FROM public, anon, authenticated;

-- Sin permiso devuelve CERO filas, no un error: es una lectura, y quien no
-- tiene token no tiene nada que ver aquí. La app que sí lo tiene nunca cae en
-- este caso; la que no, ya enseña «Tu sesión es de antes» (tablero.html).
CREATE FUNCTION public.apartados_lista(p_store text, p_token text DEFAULT NULL)
RETURNS TABLE (id bigint, sku text, cliente text, telefono text,
               piezas integer, con_seguro boolean, estatus text,
               vendedor text, creado_en timestamptz,
               color text, precio numeric, transaccion text,
               serie text, asignado_en timestamptz, entregado_en timestamptz,
               entregado_por text, venta_id bigint,
               tipo text, origen text, promesa date, dias_tarde integer,
               cupo integer, apartadas integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF NOT public.candado_ok_(p_store, p_token, 'apartados_lista') THEN
    RETURN;
  END IF;
  RETURN QUERY SELECT * FROM public.apartados_filas_(p_store);
END $fn$;


-- ── 6 · tablero_todo: lo público sigue siéndolo, los apartados no ──
-- El cuerpo es el de supabase_funciones_lectura_resto.sql; cambia sólo la
-- línea de los apartados. `apartados_ok` es nuevo y existe para que la app
-- distinga «no hay apartados» de «no me dejaron verlos»: sin él, las dos cosas
-- llegarían como la misma lista vacía.
CREATE FUNCTION public.tablero_todo(p_store text, p_token text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_ok boolean;
BEGIN
  v_ok := public.candado_ok_(p_store, p_token, 'tablero_todo');
  RETURN jsonb_build_object(
    'inventario', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
                     FROM public.inventario_vivo(p_store) t),
    'eol',        (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
                     FROM public.eol_lista(p_store) t),
    'eol_venta',  (SELECT coalesce(jsonb_object_agg(t.sku, t.precio50), '{}'::jsonb)
                     FROM public.eol_precio_venta(p_store) t),
    'promos',     (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
                     FROM public.promos_vigentes(p_store) t),
    'bundles',    (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
                     FROM public.bundles_vigentes(p_store) t),
    'avisos',     (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
                     FROM public.avisos_vigentes(p_store) t),
    'apartados',  CASE WHEN v_ok
                    THEN (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
                            FROM public.apartados_filas_(p_store) t)
                    ELSE '[]'::jsonb END,
    'apartados_ok', v_ok,
    'ventas_hoy', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
                     FROM public.ventas_hoy(p_store) t)
  );
END $fn$;


-- ── 7 · Permisos ────────────────────────────────────────────
-- Los DROP de arriba se llevaron los GRANT; sin volver a darlos, las tres
-- existirían y nadie podría llamarlas (el fallo de v199).
REVOKE ALL ON FUNCTION public.venta_guardar(text,text,text,text,numeric,text,boolean,text,text,text,text,boolean,text,text,text) FROM public;
REVOKE ALL ON FUNCTION public.apartados_lista(text,text) FROM public;
REVOKE ALL ON FUNCTION public.tablero_todo(text,text)    FROM public;

GRANT EXECUTE ON FUNCTION public.venta_guardar(text,text,text,text,numeric,text,boolean,text,text,text,text,boolean,text,text,text)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apartados_lista(text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tablero_todo(text,text)    TO anon, authenticated;

-- Que PostgREST vea las firmas nuevas ya, y no al rato.
NOTIFY pgrst, 'reload schema';


-- ============================================================
--  COMPROBAR — pegar esto después y mirar las cuatro respuestas
-- ============================================================
--
--  1 · Queda UNA de cada una, y con p_token:
--
--      SELECT p.proname, pg_get_function_identity_arguments(p.oid)
--        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public'
--         AND p.proname IN ('venta_guardar','apartados_lista','tablero_todo')
--       ORDER BY 1;
--      -- Esperado: TRES filas. venta_guardar termina en «p_token text, p_quien
--      -- text»; apartados_lista y tablero_todo son «p_store text, p_token text».
--      -- Si sale una cuarta, es una firma vieja que sigue abierta: avísame.
--
--  2 · Los apartados siguen saliendo con la app de hoy (sin token, paso 1):
--
--      SELECT count(*) FROM public.apartados_lista('1217');
--      -- Esperado: el mismo número de apartados que ves en el tablero.
--
--  3 · Con un token inventado ya NO sale nada:
--
--      SELECT count(*) FROM public.apartados_lista('1217', 'token-inventado');
--      -- Esperado: 0.
--
--  4 · El contador está contando:
--
--      SELECT * FROM public.candado_sin_token ORDER BY dia DESC, funcion;
--      -- Esperado: filas de hoy (la consulta 2 cuenta una). Esto es lo que
--      -- hay que mirar ANTES del paso 2: con la app v290 ya en los teléfonos,
--      -- un día de venta entero en cero.
-- ============================================================
