-- ============================================================
--  CORREGIR O BORRAR UN TICKET DE MR FIX
--  6-sep-2026
-- ============================================================
--
--  Pedido en piso: «cuando suben un ticket mal del de Mr Fix no se puede
--  borrar, no se puede modificar». Y a elección: unas veces sobra el ticket
--  entero y otras solo está mal un campo.
--
--  ------------------------------------------------------------
--  LO QUE HABÍA, QUE NO ERA NADA UTILIZABLE
--  ------------------------------------------------------------
--  `accesorio_eliminar` existía desde el 18-ago, pero:
--    · ninguna pantalla la llamaba — no hay dónde ver un ticket ya guardado;
--    · no pedía `p_quien`, así que no distinguía gerente de asesor;
--    · dejaba la FOTO huérfana en `venta_fotos`, que es la evidencia del corte;
--    · y no dejaba rastro de nada.
--  De reparaciones no había ni eso.
--
--  Se rehace entera y se le suman editar y borrar para los dos.
--
--  ------------------------------------------------------------
--  LO QUE MUEVE CADA CAMPO — leer antes de tocar esto
--  ------------------------------------------------------------
--  ACCESORIOS (`accesorios_ventas`) -> van al Excel REGIONAL de Mr Fix, que
--  comparten diez tiendas:
--    producto  -> la línea del reporte, y con ella la comisión
--    vendedor  -> A QUIÉN se le paga. Es «Atendido por» del ticket, NO el
--                 número del final, que es quien cobró en caja
--    precio · cantidad · importe -> el dinero. `precio × cantidad = importe`
--                 es la red que dice EN QUÉ LÍNEA falla, y se sigue exigiendo
--    sku       -> la columna E del Excel. No todo es 43739: OFFICE va con el suyo
--    ticket    -> choca con UNIQUE (store_id, ticket, producto)
--    fecha     -> el mes del corte. Cambiarla puede mudar la línea de hoja
--
--  REPARACIONES (`reparaciones`) -> NO van al Excel. Son del técnico externo:
--    importe   -> lo que se le cobra al técnico en su corte mensual
--    ticket    -> choca con UNIQUE (store_id, ticket)
--
--  ⚠️ EL TIPO NO SE PUEDE CAMBIAR. Un accesorio no se convierte en reparación
--  editando: son dos tablas, y esa separación es lo único que impide que una
--  reparación acabe en el Excel regional moviendo comisiones de todo el equipo
--  (ver MAPA, «Un solo botón: Mr Fix»). Si se capturó del tipo equivocado se
--  borra y se recaptura, que la app deshace bien las dos cosas. Es el mismo
--  criterio por el que `venta_editar` no cambia la procedencia de una venta.
--
--  ------------------------------------------------------------
--  QUÉ IMPONE ESTO Y QUÉ NO — sin adornos
--  ------------------------------------------------------------
--  Igual que en `venta_editar`: `escritura_ok_` valida el token de tienda, que
--  es el mismo para todos, así que la barrera de verdad es `p_quien` contra el
--  puesto de la tabla `empleados`. El gerente dueño entra con el correo y no
--  tiene ficha, así que `p_quien` vacío sigue pasando, y quien manipule la
--  llamada a mano puede mandarlo vacío.
--
--  Lo que de verdad protege aquí es que TODO queda en `mrfix_ediciones` con el
--  antes y el después. Esto toca dinero de gente de OTRAS tiendas: una línea
--  borrada sin rastro no se puede ni detectar ni deshacer.
--
--  Se pega completo en el SQL Editor. Es idempotente.
-- ============================================================


-- ── 1 · El rastro ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mrfix_ediciones (
  id         bigserial   PRIMARY KEY,
  store_id   text        NOT NULL REFERENCES public.tiendas(store_id) ON DELETE CASCADE,
  -- 'accesorio' | 'reparacion' — de qué tabla salía la fila
  tipo       text        NOT NULL,
  -- 'editar' | 'borrar'
  accion     text        NOT NULL,
  fila_id    bigint,
  captura_id text,
  quien      text,                    -- empno, o vacío si fue por sesión de gerente
  editado_en timestamptz NOT NULL DEFAULT now(),
  antes      jsonb       NOT NULL,
  despues    jsonb                    -- NULL en un borrado: no hay después
);

ALTER TABLE public.mrfix_ediciones ENABLE ROW LEVEL SECURITY;
-- Sin políticas: no se llega por REST. Solo escriben las funciones, que son DEFINER.

CREATE INDEX IF NOT EXISTS mrfix_ediciones_dia
  ON public.mrfix_ediciones (store_id, editado_en DESC);

COMMENT ON TABLE public.mrfix_ediciones IS
  'Auditoria de correcciones y borrados de Mr Fix, con el antes y el despues '
  'completos. Los accesorios van al Excel regional que comparten diez tiendas: '
  'sin este rastro, una linea borrada no se puede ni detectar ni deshacer.';


-- ── 2 · Lo capturado en un día, para poder tocarlo ──────────
-- Las dos tablas en una sola lista, que es como llega el papel: el asesor tiene
-- un ticket en la mano y no piensa en qué tabla cayó.
--
-- Lleva `p_token` como todo lo de Mr Fix. Sin él devuelve vacío y no error: la
-- pantalla enseña «no hay nada capturado hoy», que es lo mismo que vería si de
-- verdad no lo hubiera... por eso la app comprueba el token ANTES de pintar.
CREATE OR REPLACE FUNCTION public.mrfix_dia(
  p_store text, p_token text, p_fecha date DEFAULT NULL
) RETURNS TABLE (tipo text, id bigint, dia date, ticket text, producto text,
                 sku text, cantidad integer, precio numeric, importe numeric,
                 vendedor text, captura_id text, tiene_foto boolean,
                 capturado_por text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE d date;
BEGIN
  IF NOT public.escritura_ok_(p_store, p_token) THEN RETURN; END IF;
  d := coalesce(p_fecha, (now() AT TIME ZONE 'America/Mexico_City')::date);

  RETURN QUERY
    SELECT 'accesorio'::text, a.id, a.dia, a.ticket, a.producto, a.sku,
           a.cantidad, a.precio, a.importe, a.vendedor, a.captura_id,
           EXISTS (SELECT 1 FROM public.venta_fotos f
                    WHERE f.store_id = a.store_id AND f.captura_id = a.captura_id),
           a.capturado_por
    FROM public.accesorios_ventas a
    WHERE a.store_id = p_store AND a.dia = d

    UNION ALL

    /* Una reparación no lleva producto, ni vendedor, ni piezas: es del técnico
       y la tienda no cobra comisión por ella. Se devuelven NULL y no cadenas
       vacías, para que la pantalla pueda decir «no aplica» en vez de dejar un
       hueco que parece un dato que falta. */
    SELECT 'reparacion'::text, r.id, r.dia, r.ticket, NULL::text, NULL::text,
           NULL::integer, NULL::numeric, r.importe, NULL::text, r.captura_id,
           EXISTS (SELECT 1 FROM public.venta_fotos f
                    WHERE f.store_id = r.store_id AND f.captura_id = r.captura_id),
           r.capturado_por
    FROM public.reparaciones r
    WHERE r.store_id = p_store AND r.dia = d

    ORDER BY 3, 4;
END $fn$;


-- ── 3 · ¿Quién puede corregir? ──────────────────────────────
-- `puede_gestionar_` ya existe (supabase_venta_editar.sql) y comprueba puesto y
-- alta contra `empleados`. Se reutiliza a propósito: dos ideas de «quién manda»
-- acaban separándose, y aquí separarse significa que alguien mueva el Excel de
-- diez tiendas. Este helper solo añade el caso del gerente sin ficha.
CREATE OR REPLACE FUNCTION public.mrfix_puede_(p_store text, p_quien text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT coalesce(trim(p_quien),'') = ''            -- gerente dueño, sin ficha
      OR public.puede_gestionar_(p_store, trim(p_quien));
$$;

REVOKE ALL ON FUNCTION public.mrfix_puede_(text,text) FROM public, anon, authenticated;


-- ── 4 · Corregir un accesorio ───────────────────────────────
CREATE OR REPLACE FUNCTION public.accesorio_editar(
  p_store    text,
  p_token    text,
  p_id       bigint,
  p_ticket   text,
  p_producto text,
  p_sku      text,
  p_cantidad integer,
  p_precio   numeric,
  p_importe  numeric,
  p_vendedor text,
  p_fecha    date,
  p_quien    text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_antes jsonb; v_despues jsonb; v_cap text;
BEGIN
  IF NOT public.escritura_ok_(p_store, p_token) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_autorizado');
  END IF;
  IF NOT public.mrfix_puede_(p_store, p_quien) THEN
    RETURN jsonb_build_object('ok', false,
      'error', 'solo el gerente o el subgerente pueden corregir un ticket');
  END IF;

  SELECT to_jsonb(a), a.captura_id INTO v_antes, v_cap
    FROM public.accesorios_ventas a
   WHERE a.store_id = p_store AND a.id = p_id;
  IF v_antes IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ese ticket ya no existe');
  END IF;

  IF coalesce(trim(p_ticket),'')   = '' THEN RETURN jsonb_build_object('ok',false,'error','falta el ticket'); END IF;
  IF coalesce(trim(p_producto),'') = '' THEN RETURN jsonb_build_object('ok',false,'error','falta el producto'); END IF;
  IF coalesce(trim(p_vendedor),'') = '' THEN RETURN jsonb_build_object('ok',false,'error','falta el vendedor'); END IF;
  IF coalesce(p_cantidad,0) < 1 THEN RETURN jsonb_build_object('ok',false,'error','la cantidad no puede ser cero'); END IF;
  IF coalesce(p_precio,-1) < 0 OR coalesce(p_importe,-1) < 0 THEN
    RETURN jsonb_build_object('ok',false,'error','el precio y el importe no pueden ser negativos');
  END IF;

  /* La misma red que en la captura: `precio × cantidad = importe`. Se comprueba
     también al corregir, porque corregir es justo cuando se teclea a mano y
     nadie vuelve a mirar el papel. El centavo de holgura es por el redondeo del
     POS, que imprime el unitario con tres decimales. */
  IF abs(round(p_precio * p_cantidad, 2) - round(p_importe, 2)) > 0.01 THEN
    RETURN jsonb_build_object('ok', false,
      'error', 'precio x cantidad no da el importe: ' ||
               to_char(round(p_precio * p_cantidad, 2), 'FM999999990.00') ||
               ' contra ' || to_char(round(p_importe, 2), 'FM999999990.00'));
  END IF;

  UPDATE public.accesorios_ventas
     SET ticket   = trim(p_ticket),
         producto = trim(p_producto),
         sku      = coalesce(nullif(trim(p_sku),''), '43739'),
         cantidad = p_cantidad,
         precio   = p_precio,
         importe  = p_importe,
         vendedor = trim(p_vendedor),
         /* Se mueve `vendida_en` y el trigger recalcula `dia`. Ponerlo a mano
            los desincroniza y el UNIQUE dejaría de proteger sin avisar — mismo
            motivo por el que `dia` es derivado desde el principio.

            ⚠️ El `AT TIME ZONE` FINAL no sobra. Sin él se arma un timestamp sin
            zona y Postgres lo mete en la del servidor (UTC): un ticket de las
            00:30 de México se guardaría como 00:30 UTC, que allá son las 18:30
            del DÍA ANTERIOR. El trigger derivaría `dia` de eso y la línea se
            mudaría de día sola — y en un ticket del día 1, de MES, o sea de
            hoja del Excel. Se conserva la hora original y solo se cambia la
            fecha, que es lo que se está corrigiendo. */
         vendida_en = ((coalesce(p_fecha, (vendida_en AT TIME ZONE 'America/Mexico_City')::date)
                        + (vendida_en AT TIME ZONE 'America/Mexico_City')::time)
                       AT TIME ZONE 'America/Mexico_City')
     WHERE store_id = p_store AND id = p_id;

  SELECT to_jsonb(a) INTO v_despues
    FROM public.accesorios_ventas a WHERE a.store_id = p_store AND a.id = p_id;

  INSERT INTO public.mrfix_ediciones (store_id, tipo, accion, fila_id, captura_id,
                                      quien, antes, despues)
  VALUES (p_store, 'accesorio', 'editar', p_id, v_cap,
          nullif(trim(coalesce(p_quien,'')),''), v_antes, v_despues);

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false,
      'error', 'ya hay una captura de ese ticket con ese mismo producto');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLSTATE || ': ' || left(SQLERRM, 140));
END $fn$;


-- ── 5 · Borrar un accesorio ─────────────────────────────────
--  Se REHACE la que existía (18-ago): no pedía quién, dejaba la foto huérfana y
--  no dejaba rastro. Se dropea porque cambia la firma y NADIE la llamaba —
--  comprobado con grep sobre las cuatro pantallas.
DROP FUNCTION IF EXISTS public.accesorio_eliminar(text,text,bigint);

CREATE FUNCTION public.accesorio_eliminar(
  p_store text, p_token text, p_id bigint, p_quien text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_antes jsonb; v_cap text; n int;
BEGIN
  IF NOT public.escritura_ok_(p_store, p_token) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_autorizado');
  END IF;
  IF NOT public.mrfix_puede_(p_store, p_quien) THEN
    RETURN jsonb_build_object('ok', false,
      'error', 'solo el gerente o el subgerente pueden borrar un ticket');
  END IF;

  SELECT to_jsonb(a), a.captura_id INTO v_antes, v_cap
    FROM public.accesorios_ventas a
   WHERE a.store_id = p_store AND a.id = p_id;
  IF v_antes IS NULL THEN
    -- No es un error: pudo borrarlo otro, o ser un reintento de red.
    RETURN jsonb_build_object('ok', true, 'borradas', 0);
  END IF;

  DELETE FROM public.accesorios_ventas WHERE store_id = p_store AND id = p_id;
  GET DIAGNOSTICS n = ROW_COUNT;

  /* La foto se va con la fila, pero SOLO si no la comparte otra captura. Un
     ticket de varios artículos son varias filas con el MISMO `captura_id` y una
     sola foto: borrarla al quitar la primera dejaría a las demás sin evidencia
     justo cuando se cotejan, y la evidencia es el motivo de guardarlas 31 días. */
  IF v_cap IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.accesorios_ventas a
        WHERE a.store_id = p_store AND a.captura_id = v_cap)
     AND NOT EXISTS (
       SELECT 1 FROM public.reparaciones r
        WHERE r.store_id = p_store AND r.captura_id = v_cap) THEN
    DELETE FROM public.venta_fotos WHERE store_id = p_store AND captura_id = v_cap;
  END IF;

  INSERT INTO public.mrfix_ediciones (store_id, tipo, accion, fila_id, captura_id,
                                      quien, antes, despues)
  VALUES (p_store, 'accesorio', 'borrar', p_id, v_cap,
          nullif(trim(coalesce(p_quien,'')),''), v_antes, NULL);

  RETURN jsonb_build_object('ok', true, 'borradas', n);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLSTATE || ': ' || left(SQLERRM, 140));
END $fn$;


-- ── 6 · Corregir una reparación ─────────────────────────────
CREATE OR REPLACE FUNCTION public.reparacion_editar(
  p_store   text,
  p_token   text,
  p_id      bigint,
  p_ticket  text,
  p_importe numeric,
  p_fecha   date,
  p_quien   text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_antes jsonb; v_despues jsonb; v_cap text;
BEGIN
  IF NOT public.escritura_ok_(p_store, p_token) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_autorizado');
  END IF;
  IF NOT public.mrfix_puede_(p_store, p_quien) THEN
    RETURN jsonb_build_object('ok', false,
      'error', 'solo el gerente o el subgerente pueden corregir un ticket');
  END IF;

  SELECT to_jsonb(r), r.captura_id INTO v_antes, v_cap
    FROM public.reparaciones r WHERE r.store_id = p_store AND r.id = p_id;
  IF v_antes IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'esa reparación ya no existe');
  END IF;

  IF coalesce(trim(p_ticket),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'falta el ticket');
  END IF;
  IF coalesce(p_importe,-1) < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'el importe no puede ser negativo');
  END IF;

  UPDATE public.reparaciones
     SET ticket  = trim(p_ticket),
         importe = p_importe,
         -- Igual que arriba, `AT TIME ZONE` final incluido: sin él, una
         -- reparación de la madrugada se mudaría al día anterior sola.
         recibida_en = ((coalesce(p_fecha, (recibida_en AT TIME ZONE 'America/Mexico_City')::date)
                         + (recibida_en AT TIME ZONE 'America/Mexico_City')::time)
                        AT TIME ZONE 'America/Mexico_City')
   WHERE store_id = p_store AND id = p_id;

  SELECT to_jsonb(r) INTO v_despues
    FROM public.reparaciones r WHERE r.store_id = p_store AND r.id = p_id;

  INSERT INTO public.mrfix_ediciones (store_id, tipo, accion, fila_id, captura_id,
                                      quien, antes, despues)
  VALUES (p_store, 'reparacion', 'editar', p_id, v_cap,
          nullif(trim(coalesce(p_quien,'')),''), v_antes, v_despues);

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ya hay una reparación con ese ticket');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLSTATE || ': ' || left(SQLERRM, 140));
END $fn$;


-- ── 7 · Borrar una reparación ───────────────────────────────
CREATE OR REPLACE FUNCTION public.reparacion_eliminar(
  p_store text, p_token text, p_id bigint, p_quien text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_antes jsonb; v_cap text; n int;
BEGIN
  IF NOT public.escritura_ok_(p_store, p_token) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_autorizado');
  END IF;
  IF NOT public.mrfix_puede_(p_store, p_quien) THEN
    RETURN jsonb_build_object('ok', false,
      'error', 'solo el gerente o el subgerente pueden borrar un ticket');
  END IF;

  SELECT to_jsonb(r), r.captura_id INTO v_antes, v_cap
    FROM public.reparaciones r WHERE r.store_id = p_store AND r.id = p_id;
  IF v_antes IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'borradas', 0);
  END IF;

  DELETE FROM public.reparaciones WHERE store_id = p_store AND id = p_id;
  GET DIAGNOSTICS n = ROW_COUNT;

  -- Misma regla que en accesorios: la foto solo se va si no queda nadie que la use.
  IF v_cap IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.accesorios_ventas a
        WHERE a.store_id = p_store AND a.captura_id = v_cap)
     AND NOT EXISTS (
       SELECT 1 FROM public.reparaciones r
        WHERE r.store_id = p_store AND r.captura_id = v_cap) THEN
    DELETE FROM public.venta_fotos WHERE store_id = p_store AND captura_id = v_cap;
  END IF;

  INSERT INTO public.mrfix_ediciones (store_id, tipo, accion, fila_id, captura_id,
                                      quien, antes, despues)
  VALUES (p_store, 'reparacion', 'borrar', p_id, v_cap,
          nullif(trim(coalesce(p_quien,'')),''), v_antes, NULL);

  RETURN jsonb_build_object('ok', true, 'borradas', n);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLSTATE || ': ' || left(SQLERRM, 140));
END $fn$;


-- ── 8 · Permisos ────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.mrfix_dia(text,text,date)                              FROM public;
REVOKE ALL ON FUNCTION public.accesorio_editar(text,text,bigint,text,text,text,integer,numeric,numeric,text,date,text) FROM public;
REVOKE ALL ON FUNCTION public.accesorio_eliminar(text,text,bigint,text)              FROM public;
REVOKE ALL ON FUNCTION public.reparacion_editar(text,text,bigint,text,numeric,date,text) FROM public;
REVOKE ALL ON FUNCTION public.reparacion_eliminar(text,text,bigint,text)             FROM public;

GRANT EXECUTE ON FUNCTION public.mrfix_dia(text,text,date)                              TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accesorio_editar(text,text,bigint,text,text,text,integer,numeric,numeric,text,date,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accesorio_eliminar(text,text,bigint,text)              TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reparacion_editar(text,text,bigint,text,numeric,date,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reparacion_eliminar(text,text,bigint,text)             TO anon, authenticated;


-- ============================================================
--  COMPROBAR  (con <TOKEN> y <empno-gerente> reales)
-- ============================================================
--
--  1) Lo capturado hoy, las dos tablas juntas:
--       select tipo, ticket, producto, importe from public.mrfix_dia('1217','<TOKEN>');
--
--  2) Un asesor NO puede borrar (espera ok=false y el motivo):
--       select public.accesorio_eliminar('1217','<TOKEN>', <id>, '<empno-asesor>');
--
--  3) La red del importe salta al corregir (espera ok=false, con los dos números):
--       select public.accesorio_editar('1217','<TOKEN>', <id>, 'T1','MICA HR','43739',
--                                      2, 149, 149, 'Quien sea', current_date, '<empno-gerente>');
--
--  4) Corregir de verdad, y que quede el rastro:
--       select public.accesorio_editar('1217','<TOKEN>', <id>, 'T1','MICA HR','43739',
--                                      1, 149, 149, 'Quien sea', current_date, '<empno-gerente>');
--       select tipo, accion, quien, antes->>'producto', despues->>'producto'
--         from public.mrfix_ediciones order by editado_en desc limit 1;
--
--  4-bis) La fecha se guarda en hora de México, no del servidor. Se prueba con
--     un ticket de MADRUGADA, que es donde se nota: si se guardara en UTC,
--     `dia` saldría el del día anterior.
--       select public.accesorio_editar('1217','<TOKEN>', <id>, 'T1','MICA HR','43739',
--                                      1, 149, 149, 'Quien sea', DATE '2026-09-10', '<empno-gerente>');
--       select dia, vendida_en AT TIME ZONE 'America/Mexico_City' as hora_mx
--         from public.accesorios_ventas where id = <id>;
--     -- `dia` tiene que decir 2026-09-10, no el 9
--
--  5) LA QUE MÁS IMPORTA — un ticket de varios artículos comparte UNA foto:
--     borrar una de sus líneas NO puede llevarse la foto de las otras.
--       select captura_id, count(*) from public.accesorios_ventas
--         where store_id='1217' group by 1 having count(*) > 1;   -- toma uno
--       select public.accesorio_eliminar('1217','<TOKEN>', <id-de-una-linea>, '<empno-gerente>');
--       select count(*) from public.venta_fotos
--         where store_id='1217' and captura_id='<ese captura_id>';  -- espera 1
