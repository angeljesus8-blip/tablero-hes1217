-- ============================================================
-- Fase 1 · Carga de datos — APLICADO el 2-ago-2026
-- ============================================================
--
-- Cómo se mueven los datos, y por qué así
-- ---------------------------------------
-- La hoja está en Google y Supabase no puede leerla. Exportar a CSV y volver a
-- importar es manual, se hace mal y no se puede repetir.
--
-- En vez de eso, **Postgres llama al Apps Script él mismo** con la extensión
-- `http`. El GAS ya devuelve JSON y responde con Access-Control-Allow-Origin:*,
-- así que sirve igual a una app que a la base de datos.
--
-- Lo bueno de este camino:
--   · el token sale de public.tiendas y no pasa por ningún lado
--   · se puede repetir tantas veces como haga falta, es idempotente
--   · no hay archivos intermedios que se puedan quedar viejos
--
-- Requisitos (ya aplicados):
--   CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;
--
-- OJO con el timeout: la extensión corta a los 5 s por defecto y `modo=todo`
-- tarda más. Hay que subirlo EN LA MISMA SESIÓN de la llamada:
--   SELECT extensions.http_set_curlopt('CURLOPT_TIMEOUT','60');
-- No se guarda entre sesiones.
--
-- ============================================================

-- ------------------------------------------------------------
-- 1 · CATÁLOGO  ←  modo=catalogo
-- ------------------------------------------------------------
-- Devuelve {upc: {s,d,o,p}} indexado por UPC. Dos consecuencias:
--   · un SKU con dos códigos de barras sale DOS VECES → hay que deduplicar o
--     el INSERT truena con "ON CONFLICT cannot affect row a second time"
--   · los que vienen de Catalogo_ref llegan con o y p vacíos: son los agotados
--     que el cliente sigue pidiendo → vigente = false
CREATE OR REPLACE FUNCTION public.cargar_catalogo(p_store text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE cuerpo jsonb; n int; dups int;
BEGIN
  SELECT r.content::jsonb INTO cuerpo
  FROM public.tiendas t,
       LATERAL extensions.http_get(t.gas_url || '?modo=catalogo&t=' || t.gas_token) r
  WHERE t.store_id = p_store;

  IF cuerpo IS NULL OR cuerpo ? 'error' THEN RETURN 'la nube no devolvio catalogo'; END IF;

  WITH plano AS (
    SELECT trim(j.value->>'s') AS sku
    FROM jsonb_each(cuerpo) j WHERE trim(coalesce(j.value->>'s','')) <> ''
  )
  SELECT count(*) - count(DISTINCT sku) INTO dups FROM plano;

  INSERT INTO public.catalogo (store_id, sku, descripcion, upc, precio, vigente)
  SELECT p_store, u.sku, u.descripcion, u.upc, u.precio, u.vigente
  FROM (
    SELECT DISTINCT ON (sku) * FROM (
      SELECT trim(j.value->>'s') AS sku,
             coalesce(j.value->>'d','') AS descripcion,
             nullif(trim(j.key),'') AS upc,
             nullif(regexp_replace(coalesce(j.value->>'p',''),'[^0-9.]','','g'),'')::numeric AS precio,
             (coalesce(nullif(trim(j.value->>'o'),''),'') <> '') AS vigente
      FROM jsonb_each(cuerpo) j
      WHERE trim(coalesce(j.value->>'s','')) <> ''
    ) p ORDER BY sku, vigente DESC, precio DESC NULLS LAST, upc
  ) u
  ON CONFLICT (store_id, sku) DO UPDATE
    SET descripcion = excluded.descripcion,
        upc         = coalesce(excluded.upc, public.catalogo.upc),
        precio      = coalesce(excluded.precio, public.catalogo.precio),
        vigente     = public.catalogo.vigente OR excluded.vigente,
        updated_at  = now();

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n || ' SKUs cargados · ' || dups || ' duplicados por UPC descartados';
EXCEPTION WHEN OTHERS THEN
  -- sin la URL: lleva el token dentro
  RETURN 'ERROR ' || SQLSTATE || ': ' || left(regexp_replace(SQLERRM,'https?://[^ ]+','<url>','g'), 160);
END $fn$;

-- ------------------------------------------------------------
-- 2 · EL RESTO  ←  modo=todo (un solo viaje)
-- ------------------------------------------------------------
-- CUIDADO: modo=todo devuelve bundles y avisos YA FILTRADOS por vigencia. Si
-- llegan vacíos no es que falle la carga: es que hoy no hay ninguno vigente.
-- Los vencidos no se pueden recuperar por esta vía — el GAS no los expone.
CREATE OR REPLACE FUNCTION public.cargar_resto(p_store text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE d jsonb; a int; b int; c int; e int; f int;
BEGIN
  SELECT r.content::jsonb INTO d
  FROM public.tiendas t,
       LATERAL extensions.http_get(t.gas_url || '?modo=todo&t=' || t.gas_token) r
  WHERE t.store_id = p_store;
  IF d IS NULL OR d ? 'error' THEN RETURN 'la nube no devolvio datos'; END IF;

  -- Solo se toman o (on hand) y e (exhibición). v y ev son calculados: aquí los
  -- vuelve a sacar inventario_vivo a partir de inventario_corte.
  INSERT INTO public.inventario (store_id, sku, onhand, exhibicion)
  SELECT p_store, j.key,
         greatest(0, coalesce((j.value->>'o')::int, 0)),
         greatest(0, coalesce((j.value->>'e')::int, 0))
  FROM jsonb_each(d->'inventario') j
  WHERE trim(j.key) <> ''
    AND EXISTS (SELECT 1 FROM public.catalogo c WHERE c.store_id=p_store AND c.sku=j.key)
  ON CONFLICT (store_id, sku) DO UPDATE
    SET onhand = excluded.onhand, exhibicion = excluded.exhibicion, updated_at = now();
  GET DIAGNOSTICS a = ROW_COUNT;

  INSERT INTO public.promos (store_id, sku, producto, precio_reg, precio_pro, estatus, msi, vigente_desde, vigente_hasta)
  SELECT p_store, j.key, coalesce(j.value->>'d',''),
         nullif(regexp_replace(coalesce(j.value->>'pr',''),'[^0-9.]','','g'),'')::numeric,
         nullif(regexp_replace(coalesce(j.value->>'pp',''),'[^0-9.]','','g'),'')::numeric,
         nullif(j.value->>'est',''), nullif(j.value->>'msi',''),
         nullif(j.value->>'d1','')::date, nullif(j.value->>'d2','')::date
  FROM jsonb_each(d->'promos') j
  WHERE trim(j.key) <> '' AND nullif(j.value->>'d2','') IS NOT NULL
  ON CONFLICT (store_id, sku) DO UPDATE
    SET producto=excluded.producto, precio_reg=excluded.precio_reg, precio_pro=excluded.precio_pro,
        estatus=excluded.estatus, msi=excluded.msi, vigente_desde=excluded.vigente_desde,
        vigente_hasta=excluded.vigente_hasta, updated_at=now();
  GET DIAGNOSTICS b = ROW_COUNT;

  INSERT INTO public.eol (store_id, sku, precio)
  SELECT DISTINCT ON (x->>'sku') p_store, x->>'sku',
         nullif(regexp_replace(coalesce(x->>'precio',''),'[^0-9.]','','g'),'')::numeric
  FROM jsonb_array_elements(d->'eol') x
  WHERE trim(coalesce(x->>'sku','')) <> ''
  ORDER BY x->>'sku'
  ON CONFLICT (store_id, sku) DO UPDATE SET precio=excluded.precio, updated_at=now();
  GET DIAGNOSTICS c = ROW_COUNT;

  -- skus llega como "a,b,c" y aquí es text[] de verdad
  DELETE FROM public.bundles WHERE store_id = p_store;
  INSERT INTO public.bundles (store_id, nombre, skus, precio, vigente_desde, vigente_hasta, activo)
  SELECT p_store, x->>'nombre',
         string_to_array(regexp_replace(coalesce(x->>'skus',''), '\s', '', 'g'), ','),
         nullif(regexp_replace(coalesce(x->>'precio',''),'[^0-9.]','','g'),'')::numeric,
         nullif(x->>'d1','')::date, nullif(x->>'d2','')::date, true
  FROM jsonb_array_elements(d->'bundles') x
  WHERE nullif(x->>'d2','') IS NOT NULL AND nullif(x->>'precio','') IS NOT NULL;
  GET DIAGNOSTICS e = ROW_COUNT;

  DELETE FROM public.avisos WHERE store_id = p_store;
  INSERT INTO public.avisos (store_id, titulo, detalle, prioridad, vigente_hasta)
  SELECT p_store, x->>'titulo', nullif(x->>'detalle',''),
         coalesce(nullif(x->>'prioridad',''),'normal'), nullif(x->>'d2','')::date
  FROM jsonb_array_elements(d->'avisos') x
  WHERE trim(coalesce(x->>'titulo','')) <> '';
  GET DIAGNOSTICS f = ROW_COUNT;

  RETURN 'inventario=' || a || ' promos=' || b || ' eol=' || c || ' bundles=' || e || ' avisos=' || f;
EXCEPTION WHEN OTHERS THEN
  RETURN 'ERROR ' || SQLSTATE || ': ' || left(regexp_replace(SQLERRM,'https?://[^ ]+','<url>','g'), 170);
END $fn$;

-- ------------------------------------------------------------
-- Cómo se corre
-- ------------------------------------------------------------
--   SELECT extensions.http_set_curlopt('CURLOPT_TIMEOUT','60');
--   SELECT public.cargar_catalogo('1217');
--   SELECT public.cargar_resto('1217');

/* ============================================================
   Resultado del 2-ago-2026

     catálogo    214 SKUs  (1 duplicado por UPC descartado)
     inventario  214
     promos      117   ← las mismas 117 de la hoja
     eol         133   ← las mismas 133
     bundles       0
     avisos        0

   Los ceros NO son un fallo: se comprobó pidiéndole a `modo=todo` sus propios
   conteos y el Apps Script también devuelve 0 y 0. **Los 20 combos de la hoja
   están todos vencidos**, así que hoy el equipo no ve ninguno en el tablero.
   Eso es un asunto de la tienda, no de la migración.

   El GAS reporta 215 SKUs de inventario y aquí hay 214: la diferencia es el
   producto que está con dos códigos de barras.

   FALTA:
     · ventas — no hay modo que las devuelva todas; ventas_detalle da un día
       por llamada. Hace falta un modo de exportación en el Apps Script.
     · apartados (9) y comisiones (4)
     · inventario_corte — depende de las ventas: el corte es
       (ventas totales del SKU − lo vendido desde el corte), y sin ventas
       cargadas no se puede calcular.
   ============================================================ */
