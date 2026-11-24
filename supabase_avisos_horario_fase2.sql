-- ============================================================
--  AVISOS DEL HORARIO — fase 2: recordatorios automáticos  ·  24-nov-2026
-- ============================================================
--  Depende de supabase_avisos_horario.sql (función avisar_a_) y de
--  supabase_acceso_funciones.sql (admin_de).
--
--  CÓMO FUNCIONA
--   1. Cuando el gerente publica una semana, hace un cambio de día o la
--      desbloquea, el horario manda aquí la lista de horas de cada persona:
--      comida, Ley Silla 1 y Ley Silla 2 (`avisos_semana_guardar`).
--      Las horas las calcula la app —la misma cuenta que pinta la tarjeta—, no
--      se repiten aquí: dos copias de la regla acabarían diciendo cosas
--      distintas.
--   2. Cada minuto pg_cron llama a `avisos_tick()`, que manda los que tocan:
--      comida 10 min antes, Ley Silla 5 min antes. Cada aviso sale UNA vez y
--      queda anotado (enviado_en + resultado).
--
--  Todo en hora de México: `fecha` y `hora` son de la tienda, no UTC.
-- ============================================================


-- ── 1 · La lista de horas ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.horario_avisos (
  store_id    text        NOT NULL REFERENCES public.tiendas(store_id) ON DELETE CASCADE,
  fecha       date        NOT NULL,
  empno       text        NOT NULL,
  tipo        text        NOT NULL CHECK (tipo IN ('comida','ls1','ls2')),
  hora        time        NOT NULL,
  enviado_en  timestamptz,
  resultado   jsonb,
  actualizado timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, fecha, empno, tipo)
);
-- Nadie llega por REST: se escribe por la función de abajo y se lee desde el
-- SQL Editor.
ALTER TABLE public.horario_avisos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.horario_avisos FROM anon, authenticated;


-- ── 2 · El horario guarda la lista de una semana ────────────
-- Reemplaza lo que haya de HOY en adelante dentro de [p_desde, p_hasta].
-- Lo pasado no se toca (es el registro de lo que se mandó).
-- Si una hora no cambió y ya se había mandado, no se vuelve a mandar; si
-- cambió, se vuelve a programar.
CREATE OR REPLACE FUNCTION public.avisos_semana_guardar(
  p_store text, p_desde date, p_hasta date, p_filas jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_hoy  date := (now() AT TIME ZONE 'America/Mexico_City')::date;
  v_ins  int;
  v_del  int;
BEGIN
  -- Solo quien manda en la tienda (dueña o ficha con admin), por su sesión.
  IF NOT coalesce(public.admin_de(p_store), false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_autorizado');
  END IF;
  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde OR p_hasta - p_desde > 7 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rango de fechas invalido');
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _av_nuevas (fecha date, empno text, tipo text, hora time) ON COMMIT DROP;
  TRUNCATE _av_nuevas;
  INSERT INTO _av_nuevas
  SELECT DISTINCT ON (x.fecha, trim(x.empno), x.tipo) x.fecha, trim(x.empno), x.tipo, x.hora
    FROM jsonb_to_recordset(coalesce(p_filas, '[]'::jsonb)) AS x(fecha date, empno text, tipo text, hora time)
   WHERE x.fecha BETWEEN p_desde AND p_hasta
     AND x.fecha >= v_hoy
     AND coalesce(trim(x.empno),'') <> ''
     AND x.tipo IN ('comida','ls1','ls2')
     AND x.hora IS NOT NULL;

  DELETE FROM public.horario_avisos a
   WHERE a.store_id = p_store
     AND a.fecha BETWEEN greatest(p_desde, v_hoy) AND p_hasta
     AND NOT EXISTS (SELECT 1 FROM _av_nuevas n
                      WHERE n.fecha = a.fecha AND n.empno = a.empno AND n.tipo = a.tipo);
  GET DIAGNOSTICS v_del = ROW_COUNT;

  INSERT INTO public.horario_avisos AS a (store_id, fecha, empno, tipo, hora)
  SELECT p_store, n.fecha, n.empno, n.tipo, n.hora FROM _av_nuevas n
  ON CONFLICT (store_id, fecha, empno, tipo) DO UPDATE
    SET hora        = excluded.hora,
        actualizado = now(),
        enviado_en  = CASE WHEN a.hora = excluded.hora THEN a.enviado_en ELSE NULL END,
        resultado   = CASE WHEN a.hora = excluded.hora THEN a.resultado  ELSE NULL END;
  GET DIAGNOSTICS v_ins = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'guardados', v_ins, 'borrados', v_del);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLSTATE || ': ' || left(SQLERRM, 140));
END $fn$;

REVOKE ALL ON FUNCTION public.avisos_semana_guardar(text, date, date, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.avisos_semana_guardar(text, date, date, jsonb) TO authenticated;


-- ── 3 · El reloj: manda lo que toca ─────────────────────────
CREATE OR REPLACE FUNCTION public.avisos_tick()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_ahora timestamp := now() AT TIME ZONE 'America/Mexico_City';
  r       record;
  v_msg   text;
  v_res   jsonb;
  v_n     int := 0;
BEGIN
  FOR r IN
    SELECT a.store_id, a.fecha, a.empno, a.tipo, a.hora
      FROM public.horario_avisos a
     WHERE a.enviado_en IS NULL
       AND a.fecha = v_ahora::date
       AND (a.fecha + a.hora) - CASE a.tipo WHEN 'comida' THEN interval '10 minutes'
                                            ELSE interval '5 minutes' END <= v_ahora
       AND (a.fecha + a.hora) > v_ahora      -- si ya empezó, avisar ya no sirve
     ORDER BY a.hora
     FOR UPDATE SKIP LOCKED
  LOOP
    v_msg := CASE r.tipo
      WHEN 'comida' THEN '🍽️ Tu comida es a las ' || to_char(r.hora, 'HH24:MI') || ' (en 10 min).'
      WHEN 'ls1'    THEN '🪑 Tu 1er descanso de Ley Silla es a las ' || to_char(r.hora, 'HH24:MI') || ' (en 5 min).'
      ELSE               '🪑 Tu 2º descanso de Ley Silla es a las ' || to_char(r.hora, 'HH24:MI') || ' (en 5 min).'
    END;
    v_res := public.avisar_a_(r.store_id, ARRAY[r.empno], v_msg);
    UPDATE public.horario_avisos
       SET enviado_en = now(), resultado = v_res
     WHERE store_id = r.store_id AND fecha = r.fecha AND empno = r.empno AND tipo = r.tipo;
    v_n := v_n + 1;
  END LOOP;

  -- Lo que se quedó sin mandar y ya pasó (el reloj estuvo apagado, o la semana
  -- se publicó tarde): se anota como no enviado para que no quede en duda.
  UPDATE public.horario_avisos
     SET enviado_en = now(), resultado = jsonb_build_object('ok', false, 'error', 'paso la hora')
   WHERE enviado_en IS NULL AND (fecha + hora) <= v_ahora;

  -- Se guardan 60 días de registro.
  DELETE FROM public.horario_avisos WHERE fecha < v_ahora::date - 60;

  RETURN jsonb_build_object('ok', true, 'enviados', v_n);
END $fn$;

REVOKE ALL ON FUNCTION public.avisos_tick() FROM public, anon, authenticated;


-- ── 4 · Agendarlo cada minuto ───────────────────────────────
-- Cada 5 min (como el arqueo) haría que un aviso de «5 min antes» llegara justo
-- a la hora o tarde. Cada minuto no cuesta nada: la consulta mira solo hoy.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('avisos_tick')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'avisos_tick');
    PERFORM cron.schedule('avisos_tick', '* * * * *', $sql$ SELECT public.avisos_tick(); $sql$);
    RAISE NOTICE 'Agendado: avisos_tick cada minuto.';
  ELSE
    RAISE NOTICE 'pg_cron NO esta habilitada: los avisos no se agendaron.';
  END IF;
END $$;


-- ============================================================
--  COMPROBAR
-- ============================================================
--  1) El reloj quedó agendado:
--       select jobname, schedule, active from cron.job where jobname = 'avisos_tick';
--
--  2) Después de abrir el horario como gerente (la app manda la lista sola),
--     los avisos de hoy y su estado:
--       select fecha, empno, tipo, to_char(hora,'HH24:MI') hora,
--              to_char(enviado_en at time zone 'America/Mexico_City','HH24:MI') enviado,
--              resultado->>'destinatarios' a, resultado->>'error' error
--         from public.horario_avisos
--        where store_id = '1217' and fecha = (now() at time zone 'America/Mexico_City')::date
--        order by hora, empno;
--
--  3) La app NO puede llamar al reloj (debe decir false):
--       select has_function_privilege('anon', 'public.avisos_tick()', 'execute');
--
--  Para apagarlo:  select cron.unschedule('avisos_tick');
-- ============================================================
