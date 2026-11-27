-- ============================================================
--  LÍMITE DE INTENTOS EN EL LOGIN · y se cierra el PIN de tienda
--  26-nov-2026 · Fase 0 del plan del login · va DESPUÉS de todos los demás
-- ============================================================
--
--  Qué lo trae
--  -----------
--  `login_empleado(p_pin)` recibe SOLO un número de empleado y devuelve la
--  clave de escritura de la tienda. No pide nada más y no tenía límite de
--  intentos: con la clave publicable del HTML, cualquiera podía probar números
--  hasta acertar uno. Los números de la tienda son casi consecutivos y
--  estuvieron publicados en el historial de un repo hasta el 26-nov-2026.
--
--  Y detrás, `login_asesor(p_pin)`: el PIN de TIENDA de antes de los números
--  de empleado. Daba la misma clave, tampoco tenía límite, y nadie lo usa desde
--  que el equipo entra con su número (ago-2026). Se cierra.
--
--  Esto FRENA, no cierra: el arreglo de fondo es el PIN personal (fases 1-3).
--
--  Qué hace
--  --------
--  1 · 15 intentos fallidos desde la misma IP en 10 minutos → esa IP queda
--      bloqueada 15 minutos. Mientras tanto `login_empleado` responde un ERROR
--      `demasiados_intentos` (no «sin filas»: la app tiene que distinguir un
--      número equivocado de un bloqueo, y no seguir probando por otra ruta).
--  2 · `login_asesor` deja de poder llamarse desde la app (se le quita el
--      permiso; NO se borra, y el PIN de tienda se queda en su columna). Para
--      volver atrás basta con el GRANT que está al final, comentado.
--
--  La IP sale de `cf-connecting-ip`, no de `x-forwarded-for`: el segundo se
--  puede falsificar y el primero lo pone Cloudflare (comprobado en odemás el
--  2-oct-2026 con una sonda). Si algún día no llega, NO se limita: contar «de
--  todos» dejaría fuera a toda la tienda por culpa de un solo atacante.
--
--  Decisiones que conviene saber
--  -----------------------------
--  · Solo se cuentan los FALLOS, y un acierto NO borra la cuenta: si lo hiciera,
--    quien tenga un número propio en la misma IP la reiniciaría entre intentos.
--  · El equipo comparte el wifi de la tienda y por tanto la IP. El umbral es 15
--    (y no 10) porque el teclado intenta solo a los 5 dígitos: un número mal
--    tecleado son hasta 2 fallos. Si se bloquea, dura 15 minutos, y con los
--    datos del celular se entra.
--
--  Cómo, sin copiar ningún cuerpo
--  ------------------------------
--  La función viva se RENOMBRA a `login_empleado_filas_` (cuerpo intacto, sin
--  permisos) y con el nombre de siempre se pone una PUERTA con la misma firma y
--  las mismas columnas, copiadas de la función viva. De `login_empleado` hay
--  varias versiones en el repo y la que manda es la de la base.
--
--  Todo va en UNA transacción, y si ya se pegó una vez se detiene sin tocar nada.
-- ============================================================

BEGIN;

-- ── 1 · Dónde se anotan los fallos ──────────────────────────
-- Cerradas a anon y authenticated: solo las tocan las funciones de abajo.
CREATE TABLE IF NOT EXISTS public.login_intentos (
  ip text        NOT NULL,
  en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_intentos_ip_en ON public.login_intentos (ip, en);
ALTER TABLE public.login_intentos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.login_intentos FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.login_bloqueos (
  ip    text PRIMARY KEY,
  hasta timestamptz NOT NULL
);
ALTER TABLE public.login_bloqueos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.login_bloqueos FROM anon, authenticated;


-- ── 2 · La IP de quien llama ────────────────────────────────
CREATE OR REPLACE FUNCTION public.ip_cliente_()
RETURNS text
LANGUAGE sql STABLE SET search_path = public
AS $$
  SELECT nullif(trim(nullif(current_setting('request.headers', true), '')::json->>'cf-connecting-ip'), '');
$$;
REVOKE ALL ON FUNCTION public.ip_cliente_() FROM public, anon, authenticated;


-- ── 3 · La puerta ───────────────────────────────────────────
DO $do$
DECLARE
  k   int;
  sig text;
  res text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
              WHERE s.nspname = 'public' AND p.proname = 'login_empleado_filas_') THEN
    RAISE EXCEPTION 'login_empleado_filas_ ya existe: este archivo ya se pegó. No se tocó nada.';
  END IF;

  SELECT count(*) INTO k FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
   WHERE s.nspname = 'public' AND p.proname = 'login_empleado';
  IF k <> 1 THEN
    RAISE EXCEPTION 'Esperaba UNA login_empleado, hay %. No se tocó nada: avísale a Claude.', k;
  END IF;

  SELECT pg_get_function_identity_arguments(p.oid), pg_get_function_result(p.oid)
    INTO sig, res
    FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
   WHERE s.nspname = 'public' AND p.proname = 'login_empleado';
  IF sig <> 'p_pin text' THEN
    RAISE EXCEPTION 'login_empleado tiene la firma (%), y esperaba (p_pin text). No se tocó nada.', sig;
  END IF;
  IF res !~* '^(TABLE|SETOF)' THEN
    RAISE EXCEPTION 'login_empleado devuelve % y no una tabla. No se tocó nada.', res;
  END IF;

  EXECUTE 'ALTER FUNCTION public.login_empleado(text) RENAME TO login_empleado_filas_';
  EXECUTE 'REVOKE ALL ON FUNCTION public.login_empleado_filas_(text) FROM public, anon, authenticated';

  -- Plpgsql y VOLATILE (el defecto): escribe en las tablas de intentos, y
  -- PostgREST corre las STABLE en transacción de solo lectura (25006).
  EXECUTE format($f$
    CREATE FUNCTION public.login_empleado(p_pin text)
    RETURNS %s
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
    AS $b$
    DECLARE
      v_ip text := public.ip_cliente_();
      v_n  int;
    BEGIN
      IF v_ip IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM public.login_bloqueos b WHERE b.ip = v_ip AND b.hasta > now()) THEN
          RAISE EXCEPTION 'demasiados_intentos' USING ERRCODE = 'P0001';
        END IF;
      END IF;

      RETURN QUERY SELECT * FROM public.login_empleado_filas_(p_pin);
      IF FOUND THEN
        RETURN;
      END IF;

      -- No entró: se anota el fallo y, si ya son 15 en 10 minutos, se bloquea.
      IF v_ip IS NOT NULL THEN
        INSERT INTO public.login_intentos (ip) VALUES (v_ip);
        SELECT count(*) INTO v_n FROM public.login_intentos i
         WHERE i.ip = v_ip AND i.en > now() - interval '10 minutes';
        IF v_n >= 15 THEN
          INSERT INTO public.login_bloqueos (ip, hasta)
          VALUES (v_ip, now() + interval '15 minutes')
          ON CONFLICT (ip) DO UPDATE SET hasta = excluded.hasta;
        END IF;
        -- Limpieza al paso, sin un cron: lo que ya no cuenta, fuera.
        DELETE FROM public.login_intentos WHERE en < now() - interval '1 day';
        DELETE FROM public.login_bloqueos WHERE hasta < now() - interval '1 day';
      END IF;
    END $b$
  $f$, res);

  EXECUTE 'REVOKE ALL ON FUNCTION public.login_empleado(text) FROM public';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.login_empleado(text) TO anon, authenticated';

  -- ── 4 · El PIN de tienda, cerrado ─────────────────────────
  -- Solo se le quita el permiso. El GRANT de vuelta está al final.
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
              WHERE s.nspname = 'public' AND p.proname = 'login_asesor') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.login_asesor(text) FROM public, anon, authenticated';
  END IF;
END $do$;

NOTIFY pgrst, 'reload schema';

COMMIT;


-- ============================================================
--  COMPROBAR (las hago yo desde fuera, con la clave publicable)
-- ============================================================
--
--  1 · Un número malo → 0 filas (no error) hasta el decimoquinto fallo.
--  2 · login_asesor ya no responde a la app (error de permiso).
--  3 · Solo queda UNA login_empleado y la interna sin permisos:
--      SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE')
--        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public' AND p.proname LIKE 'login_%';
--      -- Esperado: login_empleado = true, login_empleado_filas_ = false,
--      --           login_asesor = false.
--  4 · Tú, en tu celular: cierra sesión y entra con tu número. Debe entrar.
--
--  VOLVER ATRÁS (solo si algo sale mal):
--  · El PIN de tienda:
--      GRANT EXECUTE ON FUNCTION public.login_asesor(text) TO anon, authenticated;
--  · El límite: avísale a Claude; se deshace renombrando de vuelta.
-- ============================================================
