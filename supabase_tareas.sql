-- ============================================================
--  TAREAS DE LA SEMANA — el checklist de piso (19-sep-2026)
-- ============================================================
-- El planeador ya sabe quién abre, quién cierra y quién descansa. Lo que
-- faltaba era la otra mitad del turno: barrer, limpiar mesas, lavar el
-- sanitario, ordenar bodega. Eso se repartía de palabra, y de palabra también
-- se perdía —nadie podía decir si el baño ya se lavó esta semana—.
--
-- El REPARTO no se guarda aquí. Se calcula en `horario_semanal.html` a partir
-- del mismo horario que ya se pinta: misma semana + mismo horario = misma
-- asignación en todos los teléfonos. Guardar el reparto sería una segunda
-- verdad que se desincroniza con el horario en cuanto alguien pida vacaciones.
--
-- Lo único que vive aquí es la PALOMITA: qué tarea, de qué día, ya se hizo.
-- Eso sí es un hecho del mundo y no se puede calcular.
--
-- Se pega completo en el SQL Editor del proyecto "HES" (rjdrljtujbwooejrpyqv).
-- Es idempotente: se puede volver a correr sin romper nada.
--
-- ⚠️ La app solo enseña el checklist en la 1217 (`TIENDA_TAREAS`). Esta tabla
--    no lo fuerza: lleva `store_id` como todas las demás, así que el día que
--    otra tienda lo quiera, se abre en el HTML y no hay que migrar nada.
-- ============================================================


-- ── 1 · La tabla ────────────────────────────────────────────
-- Una fila = una tarea de un día concreto, ya hecha. Si no hay fila, está
-- pendiente: no hay estado "no hecha" que alguien tenga que limpiar cada lunes.
--
-- `anio` va aparte de `semana` porque la semana ISO vuelve a 1 cada enero: sin
-- él, el baño lavado la semana 1 de 2027 taparía al de la semana 1 de 2026.
CREATE TABLE IF NOT EXISTS public.tareas_hechas (
  store_id   text        NOT NULL REFERENCES public.tiendas(store_id) ON DELETE CASCADE,
  anio       smallint    NOT NULL CHECK (anio BETWEEN 2020 AND 2100),
  semana     smallint    NOT NULL CHECK (semana BETWEEN 1 AND 53),
  tarea      text        NOT NULL,
  dia        smallint    NOT NULL CHECK (dia BETWEEN 0 AND 6),   -- 0 = domingo
  hecha_por  text,        -- número de empleado; NULL = la marcó el gerente por correo
  hecha_en   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, anio, semana, tarea, dia),
  -- Mismo motivo que el CHECK de `horarios_config`: un typo en el id de la
  -- tarea creaba una fila que nadie leía y nadie reportaba. Que falle de frente.
  -- Si se agrega una tarea al catálogo del HTML, se agrega TAMBIÉN aquí.
  CONSTRAINT tareas_id_valido
    CHECK (tarea IN ('sanitario','piso','mesas','bodega','sillas'))
);

-- ⚠️ El CHECK de arriba solo se aplica cuando la tabla se CREA. En la 1217 ya
-- existe desde el 19-sep-2026, así que agregar una tarea al catálogo del HTML y
-- volver a correr este archivo NO bastaba: `CREATE TABLE IF NOT EXISTS` no toca
-- una tabla que ya está, la restricción se quedaba con la lista vieja y la
-- palomita de la tarea nueva se rechazaba sin que el reparto se viera mal.
-- Por eso se rehace aquí siempre. Al agregar una tarea hay que tocar LAS DOS
-- listas — son la misma lista escrita dos veces, y la de abajo es la que manda
-- en una base que ya existe.
ALTER TABLE public.tareas_hechas DROP CONSTRAINT IF EXISTS tareas_id_valido;
ALTER TABLE public.tareas_hechas ADD  CONSTRAINT tareas_id_valido
  CHECK (tarea IN ('sanitario','piso','mesas','bodega','sillas'));


-- ── 2 · RLS ─────────────────────────────────────────────────
-- Gerente y subgerente entran con su cuenta: leen y escriben directo, igual que
-- en `horarios_config`. El asesor no tiene cuenta de Supabase — pasa por las
-- dos funciones de abajo.
ALTER TABLE public.tareas_hechas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tareas_hechas_admin ON public.tareas_hechas;
CREATE POLICY tareas_hechas_admin ON public.tareas_hechas
  FOR ALL TO authenticated
  USING (public.admin_de(store_id))
  WITH CHECK (public.admin_de(store_id));


-- ── 3 · Lo que ve el equipo ─────────────────────────────────
-- Valida el número igual que `horario_equipo`: quien no esté activo en
-- `empleados` no recibe nada.
--
-- ⚠️ Devuelve `mia` (boolean) y NO el número de quien la marcó. Desde el
--    6-sep-2026 el asesor ve su horario y no el de los demás; decirle «la marcó
--    el 900004 el jueves» es horario ajeno dicho de otra forma —se sabría quién
--    trabajó ese día—. El gerente sí ve el nombre, porque lee la tabla directo
--    con su sesión.
CREATE OR REPLACE FUNCTION public.tareas_semana(
  p_store_id text,
  p_empno    text,
  p_anio     int,
  p_semana   int
) RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN EXISTS (
      SELECT 1 FROM public.empleados e
      WHERE e.store_id = p_store_id
        AND e.empno    = p_empno
        AND e.activo   = true
    )
    THEN coalesce((
      SELECT json_agg(json_build_object(
               'tarea', t.tarea,
               'dia',   t.dia,
               'mia',   (t.hecha_por IS NOT DISTINCT FROM p_empno),
               'hecha_en', t.hecha_en))
      FROM public.tareas_hechas t
      WHERE t.store_id = p_store_id
        AND t.anio     = p_anio
        AND t.semana   = p_semana
    ), '[]'::json)
    ELSE NULL
  END;
$$;

GRANT EXECUTE ON FUNCTION public.tareas_semana(text, text, int, int) TO anon, authenticated;


-- ── 4 · Palomear (y despalomear) ────────────────────────────
-- `ON CONFLICT DO NOTHING` a propósito: la primera palomita manda. Si dos
-- personas marcan la misma tarea, la tarea no se hizo dos veces — y quedarse
-- con la última convertiría «quién la hizo» en «quién tocó el botón al final».
--
-- Desmarcar solo puede quien marcó. Sin eso, cualquiera del equipo podría
-- borrar el trabajo registrado de otro, y la tabla dejaría de servir para lo
-- único que sirve: saber si ya se hizo.
CREATE OR REPLACE FUNCTION public.tarea_marcar(
  p_store_id text,
  p_empno    text,
  p_anio     int,
  p_semana   int,
  p_tarea    text,
  p_dia      int,
  p_hecha    boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_ok    boolean;
  v_filas int;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.empleados e
    WHERE e.store_id = p_store_id
      AND e.empno    = p_empno
      AND e.activo   = true
  ) INTO v_ok;

  IF NOT v_ok THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_autorizado');
  END IF;

  IF p_hecha THEN
    INSERT INTO public.tareas_hechas (store_id, anio, semana, tarea, dia, hecha_por)
    VALUES (p_store_id, p_anio, p_semana, p_tarea, p_dia, p_empno)
    ON CONFLICT DO NOTHING;
    RETURN jsonb_build_object('ok', true, 'hecha', true);
  END IF;

  DELETE FROM public.tareas_hechas t
   WHERE t.store_id = p_store_id
     AND t.anio     = p_anio
     AND t.semana   = p_semana
     AND t.tarea    = p_tarea
     AND t.dia      = p_dia
     AND t.hecha_por IS NOT DISTINCT FROM p_empno;
  GET DIAGNOSTICS v_filas = ROW_COUNT;

  -- Que diga que no se pudo, en vez de contestar "ok" y dejar la palomita
  -- puesta: el asesor volvería a tocarla creyendo que no registró.
  IF v_filas = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_es_tuya');
  END IF;
  RETURN jsonb_build_object('ok', true, 'hecha', false);

EXCEPTION
  -- El CHECK del id de tarea o del día. Llega como resultado, no como un 500
  -- que la app no sabe leer.
  WHEN check_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tarea_o_dia_invalido');
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.tarea_marcar(text, text, int, int, text, int, boolean) TO anon, authenticated;


-- ── 5 · Verificación ────────────────────────────────────────
--   a) La tabla quedó:
--        SELECT count(*) FROM tareas_hechas;            -- espera 0
--
--   b) Un número activo puede marcar (usa uno real de `_privado/datos_equipo.txt`):
--        SELECT tarea_marcar('1217','<empno-activo>', 2026, 38, 'sanitario', 4);
--        -- espera {"ok": true, "hecha": true}
--
--   c) Y la ve al leer:
--        SELECT tareas_semana('1217','<empno-activo>', 2026, 38);
--        -- espera un arreglo con {"tarea":"sanitario","dia":4,"mia":true,...}
--
--   d) Un número que no existe no puede:
--        SELECT tarea_marcar('1217','000000', 2026, 38, 'piso', 1);
--        -- espera {"ok": false, "error": "no_autorizado"}
--        SELECT tareas_semana('1217','000000', 2026, 38);   -- espera NULL
--
--   e) Otro no puede desmarcar lo tuyo:
--        SELECT tarea_marcar('1217','<OTRO-empno>', 2026, 38, 'sanitario', 4, false);
--        -- espera {"ok": false, "error": "no_es_tuya"}
--
--   f) Una tarea inventada no entra:
--        SELECT tarea_marcar('1217','<empno-activo>', 2026, 38, 'lavar_coche', 1);
--        -- espera {"ok": false, "error": "tarea_o_dia_invalido"}
--
--   f-bis) Y las sillas SÍ entran (21-sep-2026 — esto es lo que comprueba que
--          el CHECK se rehízo sobre la tabla que ya existía):
--        SELECT tarea_marcar('1217','<empno-activo>', 2026, 38, 'sillas', 1);
--        -- espera {"ok": true, "hecha": true}
--        -- si dice "tarea_o_dia_invalido", el ALTER del paso 1 no corrió
--
--   g) La tabla NO se lee sin cuenta. Desde fuera, con la clave publicable:
--        curl "https://rjdrljtujbwooejrpyqv.supabase.co/rest/v1/tareas_hechas?select=*" -H "apikey: <clave publicable>"
--      Espera [] — si devuelve filas, la política no quedó.
--
--   Y al terminar la prueba, limpia:
--        DELETE FROM tareas_hechas WHERE anio = 2026 AND semana = 38;
