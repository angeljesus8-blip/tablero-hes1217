-- ============================================================
--  ENCARGOS — tareas que gerencia asigna a mano (27-sep-2026)
-- ============================================================
-- El checklist de piso (supabase_tareas.sql) se reparte SOLO con el horario y
-- nadie lo toca. Esto es lo otro: «hoy, Fulano, cuenta los accesorios de la
-- vitrina». Una tarea escrita por gerencia, para una persona y un día.
--
-- Va en tabla aparte y no en `tareas_hechas`: aquella solo acepta los ids del
-- catálogo fijo (CHECK `tareas_id_valido`), y un encargo es texto libre.
--
-- Se pega completo en el SQL Editor del proyecto "HES" (rjdrljtujbwooejrpyqv).
-- Es idempotente: se puede volver a correr sin romper nada.
--
-- Reglas (acordadas el 27-sep-2026):
--   · Se le encarga a quien tiene número de empleado: es con lo que entra a
--     verlo. Quien no tiene número no tendría por dónde enterarse.
--   · Lo que no se hizo su día NO desaparece: sigue saliendo como atrasado
--     hasta que se marque o gerencia lo borre.
--   · Asigna solo quien entra con correo (gerente o subgerente con cuenta):
--     escribe directo en la tabla y la RLS decide con `admin_de`.
-- ============================================================


-- ── 1 · La tabla ────────────────────────────────────────────
-- Una fila = un encargo. «Hecho» vive en la misma fila: un encargo es de UNA
-- persona, así que no hay nada que repartir entre varias palomitas.
--
-- `fecha` es la fecha del calendario (no semana + día, como `tareas_hechas`):
-- lo atrasado se busca por «antes de hoy y sin hacer», y eso cruza semanas.
CREATE TABLE IF NOT EXISTS public.tareas_asignadas (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  store_id    text        NOT NULL REFERENCES public.tiendas(store_id) ON DELETE CASCADE,
  fecha       date        NOT NULL,
  para_empno  text        NOT NULL CHECK (btrim(para_empno) <> ''),
  -- 120 como en la app: es un encargo, no una circular. Y el tope va también
  -- aquí porque la app no es la única que puede escribir en la tabla.
  texto       text        NOT NULL CHECK (char_length(btrim(texto)) BETWEEN 1 AND 120),
  creada_en   timestamptz NOT NULL DEFAULT now(),
  creada_por  uuid        DEFAULT auth.uid(),
  hecha_en    timestamptz,
  hecha_por   text        -- número de empleado; NULL con hecha_en = la marcó gerencia
);

CREATE INDEX IF NOT EXISTS tareas_asignadas_tienda_fecha
  ON public.tareas_asignadas (store_id, fecha);


-- ── 2 · RLS ─────────────────────────────────────────────────
-- Gerencia con cuenta: lee, crea, marca y borra, igual que en `tareas_hechas`.
-- El asesor no tiene cuenta de Supabase — pasa por las dos funciones de abajo,
-- que le dan SOLO lo suyo.
ALTER TABLE public.tareas_asignadas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tareas_asignadas_admin ON public.tareas_asignadas;
CREATE POLICY tareas_asignadas_admin ON public.tareas_asignadas
  FOR ALL TO authenticated
  USING (public.admin_de(store_id))
  WITH CHECK (public.admin_de(store_id));


-- ── 3 · Lo que ve cada quien: SOLO lo suyo ──────────────────
-- ⚠️ El filtro va AQUÍ, en el servidor, y no en el teléfono. Un encargo ajeno
--    lleva fecha y nombre: «el jueves, Dani cuenta accesorios» dice que Dani
--    trabaja el jueves, y desde el 6-sep-2026 el asesor ve su horario y no el
--    de los demás. Si la lista entera viajara al teléfono, esconderla con el
--    pintado la dejaría a un «inspeccionar» de distancia.
--
-- Trae la semana pedida [p_desde, p_hasta] y, además, todo lo de ANTES que
-- siga sin hacer: lo atrasado no se pierde al cambiar de semana.
CREATE OR REPLACE FUNCTION public.tareas_asignadas_mias(
  p_store_id text,
  p_empno    text,
  p_desde    date,
  p_hasta    date
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
               'id',       a.id,
               'fecha',    a.fecha,
               'texto',    a.texto,
               'hecha',    a.hecha_en IS NOT NULL,
               'mia',      (a.hecha_por IS NOT DISTINCT FROM p_empno))
             ORDER BY a.fecha, a.id)
      FROM public.tareas_asignadas a
      WHERE a.store_id   = p_store_id
        AND a.para_empno = p_empno
        AND (   a.fecha BETWEEN p_desde AND p_hasta
             OR (a.fecha < p_desde AND a.hecha_en IS NULL))
    ), '[]'::json)
    ELSE NULL
  END;
$$;

REVOKE ALL ON FUNCTION public.tareas_asignadas_mias(text, text, date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.tareas_asignadas_mias(text, text, date, date) TO anon, authenticated;


-- ── 4 · Marcar (y desmarcar) lo suyo ────────────────────────
-- Tres candados, y los tres los pone el servidor —la app los repite solo para
-- apagar la casilla, no para decidir—:
--   · el encargo tiene que ser SUYO (para_empno = su número);
--   · no antes de su día: un encargo del jueves marcado el lunes es un encargo
--     que nadie hizo, y la lista se leería al día con la vitrina sin contar;
--   · desmarcar, solo lo que marcó él. Lo que marcó gerencia se queda.
CREATE OR REPLACE FUNCTION public.tarea_asignada_marcar(
  p_store_id text,
  p_empno    text,
  p_id       bigint,
  p_hecha    boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_hoy   date := (now() AT TIME ZONE 'America/Mexico_City')::date;
  v_fila  public.tareas_asignadas%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.empleados e
    WHERE e.store_id = p_store_id
      AND e.empno    = p_empno
      AND e.activo   = true
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_autorizado');
  END IF;

  SELECT * INTO v_fila FROM public.tareas_asignadas a
   WHERE a.id = p_id AND a.store_id = p_store_id AND a.para_empno = p_empno;
  -- Ajeno o inexistente dan lo mismo: decir cuál es cuál sería decir qué ids
  -- existen en la tienda.
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_es_tuya');
  END IF;

  IF p_hecha THEN
    IF v_fila.fecha > v_hoy THEN
      RETURN jsonb_build_object('ok', false, 'error', 'todavia_no');
    END IF;
    -- Ya hecha: se contesta que sí sin tocarla. La primera marca manda, igual
    -- que en `tarea_marcar`.
    UPDATE public.tareas_asignadas
       SET hecha_en = now(), hecha_por = p_empno
     WHERE id = p_id AND hecha_en IS NULL;
    RETURN jsonb_build_object('ok', true, 'hecha', true);
  END IF;

  UPDATE public.tareas_asignadas
     SET hecha_en = NULL, hecha_por = NULL
   WHERE id = p_id AND hecha_en IS NOT NULL
     AND hecha_por IS NOT DISTINCT FROM p_empno;
  -- Que diga que no se pudo, en vez de contestar "ok" y dejar la palomita
  -- puesta en la base: el asesor volvería a tocarla creyendo que no registró.
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_es_tuya');
  END IF;
  RETURN jsonb_build_object('ok', true, 'hecha', false);
END;
$fn$;

REVOKE ALL ON FUNCTION public.tarea_asignada_marcar(text, text, bigint, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.tarea_asignada_marcar(text, text, bigint, boolean) TO anon, authenticated;


-- ── 5 · Verificación (con cebos) ────────────────────────────
-- Usa números reales de `_privado/datos_equipo.txt`: <A> y <B> son dos
-- asesores activos distintos. Todo se hace como postgres en el SQL Editor,
-- que se salta la RLS; lo que se prueba aquí son las dos funciones.
--
--   a) Un encargo de prueba para <A>, hoy, y otro para mañana:
--        INSERT INTO tareas_asignadas (store_id, fecha, para_empno, texto)
--        VALUES ('1217', (now() AT TIME ZONE 'America/Mexico_City')::date,     '<A>', 'PRUEBA hoy'),
--               ('1217', (now() AT TIME ZONE 'America/Mexico_City')::date + 1, '<A>', 'PRUEBA mañana')
--        RETURNING id;                                  -- anota los dos ids
--
--   b) <A> los ve; <B> no ve ninguno:
--        SELECT tareas_asignadas_mias('1217','<A>', current_date - 7, current_date + 7);
--        -- espera los dos
--        SELECT tareas_asignadas_mias('1217','<B>', current_date - 7, current_date + 7);
--        -- espera []
--        SELECT tareas_asignadas_mias('1217','000000', current_date - 7, current_date + 7);
--        -- espera NULL (número que no existe)
--
--   c) <B> no marca lo de <A>; <A> no marca lo de mañana; <A> sí marca lo de hoy:
--        SELECT tarea_asignada_marcar('1217','<B>', <id hoy>);      -- {"ok":false,"error":"no_es_tuya"}
--        SELECT tarea_asignada_marcar('1217','<A>', <id mañana>);   -- {"ok":false,"error":"todavia_no"}
--        SELECT tarea_asignada_marcar('1217','<A>', <id hoy>);      -- {"ok":true,"hecha":true}
--
--   d) <B> no la desmarca; <A> sí:
--        SELECT tarea_asignada_marcar('1217','<B>', <id hoy>, false); -- {"ok":false,"error":"no_es_tuya"}
--        SELECT tarea_asignada_marcar('1217','<A>', <id hoy>, false); -- {"ok":true,"hecha":false}
--
--   e) Lo atrasado sigue saliendo aunque se pida la semana siguiente:
--        UPDATE tareas_asignadas SET fecha = current_date - 10 WHERE id = <id hoy>;
--        SELECT tareas_asignadas_mias('1217','<A>', current_date, current_date + 6);
--        -- espera que salga «PRUEBA hoy» (atrasada)
--
--   f) La tabla NO se lee sin cuenta. Desde fuera, con la clave publicable:
--        curl "https://rjdrljtujbwooejrpyqv.supabase.co/rest/v1/tareas_asignadas?select=*" -H "apikey: <clave publicable>"
--      Espera [] — si devuelve filas, la política no quedó.
--
--   Y al terminar, limpia:
--        DELETE FROM tareas_asignadas WHERE texto LIKE 'PRUEBA%';
