-- ============================================================
--  LEY SILLA — salida y regreso confirmados  ·  24-nov-2026  (avisos, fase 3)
-- ============================================================
--  Depende de: supabase_preventa_series.sql (escritura_ok_) y
--  supabase_acceso_funciones.sql (admin_de).
--
--  El horario ya PLANEA los dos periodos de Ley Silla de cada asesor. Esto
--  registra si de verdad se tomaron: el asesor toca «🪑 Salgo» y «✅ Ya
--  regresé» en su tarjeta de hoy, y el gerente ve el semáforo del día.
--
--  LA HORA LA PONE EL SERVIDOR (now()), no el celular: el asesor no escribe
--  nada, así nadie la ajusta cambiando la hora del teléfono. Es lo que la hace
--  servir como evidencia.
--
--  CANDADO: marcar pide el token de la tienda (el mismo que ya llevan las
--  ventas) además de un número de empleado activo. No se repite el hueco de
--  `tarea_marcar`, que acepta cualquier número sin token.
--
--  Si el asesor olvidó marcar, el gerente captura la hora a mano y la marca
--  queda como `capturado_por = 'gerencia'`, para que se distinga.
-- ============================================================


-- ── 1 · Las marcas ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ley_silla_marcas (
  store_id      text        NOT NULL REFERENCES public.tiendas(store_id) ON DELETE CASCADE,
  fecha         date        NOT NULL,
  empno         text        NOT NULL,
  periodo       smallint    NOT NULL CHECK (periodo IN (1, 2)),
  salida        timestamptz NOT NULL,
  regreso       timestamptz,
  capturado_por text        NOT NULL DEFAULT 'asesor' CHECK (capturado_por IN ('asesor', 'gerencia')),
  actualizado   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, fecha, empno, periodo),
  CHECK (regreso IS NULL OR regreso >= salida)
);
ALTER TABLE public.ley_silla_marcas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ley_silla_marcas FROM anon, authenticated;


-- ── 2 · El asesor marca ─────────────────────────────────────
--  p_accion = 'salgo' | 'regreso'
--  Reglas: no sale dos veces al mismo periodo; no sale a uno mientras el otro
--  está abierto; solo regresa del que tiene abierto. Todo es de HOY.
CREATE OR REPLACE FUNCTION public.ley_silla_marcar(
  p_store text, p_token text, p_empno text, p_periodo int, p_accion text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Mexico_City')::date;
  v_emp text := trim(coalesce(p_empno, ''));
  m     public.ley_silla_marcas%ROWTYPE;
BEGIN
  IF NOT public.escritura_ok_(p_store, p_token) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_autorizado');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.empleados e
                  WHERE e.store_id = p_store AND e.empno = v_emp AND e.activo = true) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'numero_no_activo');
  END IF;
  IF p_periodo NOT IN (1, 2) OR p_accion NOT IN ('salgo', 'regreso') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'datos_invalidos');
  END IF;

  IF p_accion = 'salgo' THEN
    IF EXISTS (SELECT 1 FROM public.ley_silla_marcas
                WHERE store_id = p_store AND fecha = v_hoy AND empno = v_emp AND periodo = p_periodo) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ya_salio');
    END IF;
    IF EXISTS (SELECT 1 FROM public.ley_silla_marcas
                WHERE store_id = p_store AND fecha = v_hoy AND empno = v_emp AND regreso IS NULL) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'otro_abierto');
    END IF;
    INSERT INTO public.ley_silla_marcas (store_id, fecha, empno, periodo, salida)
    VALUES (p_store, v_hoy, v_emp, p_periodo, now());
  ELSE
    UPDATE public.ley_silla_marcas
       SET regreso = now(), actualizado = now()
     WHERE store_id = p_store AND fecha = v_hoy AND empno = v_emp
       AND periodo = p_periodo AND regreso IS NULL;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'no_estaba_fuera');
    END IF;
  END IF;

  SELECT * INTO m FROM public.ley_silla_marcas
   WHERE store_id = p_store AND fecha = v_hoy AND empno = v_emp AND periodo = p_periodo;
  RETURN jsonb_build_object('ok', true, 'periodo', m.periodo,
                            'salida', m.salida, 'regreso', m.regreso);
END $fn$;

REVOKE ALL ON FUNCTION public.ley_silla_marcar(text, text, text, int, text) FROM public;
GRANT EXECUTE ON FUNCTION public.ley_silla_marcar(text, text, text, int, text) TO anon, authenticated;


-- ── 3 · El asesor lee lo suyo de hoy ────────────────────────
CREATE OR REPLACE FUNCTION public.ley_silla_mias(
  p_store text, p_token text, p_empno text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF NOT public.escritura_ok_(p_store, p_token) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_autorizado');
  END IF;
  RETURN jsonb_build_object('ok', true, 'marcas', coalesce((
    SELECT jsonb_agg(jsonb_build_object('periodo', periodo, 'salida', salida,
                                        'regreso', regreso, 'por', capturado_por) ORDER BY periodo)
      FROM public.ley_silla_marcas
     WHERE store_id = p_store
       AND fecha = (now() AT TIME ZONE 'America/Mexico_City')::date
       AND empno = trim(coalesce(p_empno, ''))), '[]'::jsonb));
END $fn$;

REVOKE ALL ON FUNCTION public.ley_silla_mias(text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.ley_silla_mias(text, text, text) TO anon, authenticated;


-- ── 4 · El gerente lee el equipo (un rango de días) ─────────
CREATE OR REPLACE FUNCTION public.ley_silla_equipo(
  p_store text, p_desde date, p_hasta date
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF NOT coalesce(public.admin_de(p_store), false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_autorizado');
  END IF;
  IF p_hasta < p_desde OR p_hasta - p_desde > 7 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rango de fechas invalido');
  END IF;
  RETURN jsonb_build_object('ok', true, 'marcas', coalesce((
    SELECT jsonb_agg(jsonb_build_object('fecha', fecha, 'empno', empno, 'periodo', periodo,
                                        'salida', salida, 'regreso', regreso,
                                        'por', capturado_por) ORDER BY fecha, empno, periodo)
      FROM public.ley_silla_marcas
     WHERE store_id = p_store AND fecha BETWEEN p_desde AND p_hasta), '[]'::jsonb));
END $fn$;

REVOKE ALL ON FUNCTION public.ley_silla_equipo(text, date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ley_silla_equipo(text, date, date) TO authenticated;


-- ── 5 · El gerente captura a mano (olvidó marcar) ───────────
--  Horas de México ('HH:MM'). p_regreso puede ir NULL. Con p_salida NULL se
--  BORRA la marca de ese periodo (por si se capturó en el renglón equivocado).
CREATE OR REPLACE FUNCTION public.ley_silla_capturar(
  p_store text, p_fecha date, p_empno text, p_periodo int, p_salida time, p_regreso time
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_emp text := trim(coalesce(p_empno, ''));
  v_hoy date := (now() AT TIME ZONE 'America/Mexico_City')::date;
BEGIN
  IF NOT coalesce(public.admin_de(p_store), false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_autorizado');
  END IF;
  IF p_periodo NOT IN (1, 2) OR v_emp = '' OR p_fecha IS NULL
     OR p_fecha > v_hoy OR p_fecha < v_hoy - 14 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'datos_invalidos');
  END IF;
  IF p_salida IS NULL THEN
    DELETE FROM public.ley_silla_marcas
     WHERE store_id = p_store AND fecha = p_fecha AND empno = v_emp AND periodo = p_periodo;
    RETURN jsonb_build_object('ok', true, 'borrada', true);
  END IF;
  IF p_regreso IS NOT NULL AND p_regreso < p_salida THEN
    RETURN jsonb_build_object('ok', false, 'error', 'regreso_antes_de_salida');
  END IF;
  INSERT INTO public.ley_silla_marcas AS m (store_id, fecha, empno, periodo, salida, regreso, capturado_por)
  VALUES (p_store, p_fecha, v_emp, p_periodo,
          (p_fecha + p_salida) AT TIME ZONE 'America/Mexico_City',
          CASE WHEN p_regreso IS NULL THEN NULL
               ELSE (p_fecha + p_regreso) AT TIME ZONE 'America/Mexico_City' END,
          'gerencia')
  ON CONFLICT (store_id, fecha, empno, periodo) DO UPDATE
    SET salida = excluded.salida, regreso = excluded.regreso,
        capturado_por = 'gerencia', actualizado = now();
  RETURN jsonb_build_object('ok', true);
END $fn$;

REVOKE ALL ON FUNCTION public.ley_silla_capturar(text, date, text, int, time, time) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ley_silla_capturar(text, date, text, int, time, time) TO authenticated;


-- ============================================================
--  COMPROBAR
-- ============================================================
--  1) Sin token no se marca nada (debe decir no_autorizado):
--       select public.ley_silla_marcar('1217', '', 'TU_NUMERO', 1, 'salgo');
--
--  2) La app no puede leer la tabla directo ni capturar sin sesión (false, false):
--       select has_table_privilege('anon', 'public.ley_silla_marcas', 'select'),
--              has_function_privilege('anon', 'public.ley_silla_capturar(text,date,text,int,time,time)', 'execute');
--
--  3) Las marcas de hoy:
--       select empno, periodo,
--              to_char(salida  at time zone 'America/Mexico_City','HH24:MI') sale,
--              to_char(regreso at time zone 'America/Mexico_City','HH24:MI') regresa,
--              capturado_por
--         from public.ley_silla_marcas
--        where store_id = '1217' and fecha = (now() at time zone 'America/Mexico_City')::date
--        order by empno, periodo;
-- ============================================================
