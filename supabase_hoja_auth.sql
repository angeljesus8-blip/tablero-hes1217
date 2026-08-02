-- ============================================================
-- El login debe entregar hoja_auth y sheet_url — 2-ago-2026
-- Correr completo en Supabase → SQL Editor → Run.
-- ============================================================
--
-- Qué está roto
-- -------------
-- Captura de Series decide quién ve las ventas del día así:
--
--     const DESCARGA_AUTORIZADA = (_cfgCS && _cfgCS.hoja_auth) || '';
--     const ok = currentVend === DESCARGA_AUTORIZADA;
--
-- Pero login_asesor devuelve solo (store_id, nombre, ciudad, gas_url,
-- vendedores, gas_token). `hoja_auth` nunca llega, queda '', y la
-- comparación es falsa para todo el mundo: el botón está oculto para
-- todos, incluida Laura, que es la única que lo necesita.
--
-- El 1-ago se corrigió el nombre del campo en el cliente y se dio por
-- resuelto. No lo estaba: el cliente pedía bien un dato que el servidor
-- nunca mandó. Esto cierra ese lado.
--
-- Un cambio no termina hasta probarlo de punta a punta (MAPA.md).
--
-- ------------------------------------------------------------
-- PASO 1 · Ver cómo está antes de tocar
-- ------------------------------------------------------------
SELECT store_id, nombre,
       (hoja_auth IS NOT NULL AND hoja_auth <> '') AS tiene_hoja_auth,
       coalesce(hoja_auth, '(vacío)')              AS hoja_auth_actual,
       (sheet_url IS NOT NULL AND sheet_url <> '') AS tiene_sheet_url
FROM public.tiendas
ORDER BY store_id;

-- ------------------------------------------------------------
-- PASO 2 · Las columnas, por si alguna falta
-- ------------------------------------------------------------
ALTER TABLE public.tiendas
  ADD COLUMN IF NOT EXISTS hoja_auth text,
  ADD COLUMN IF NOT EXISTS sheet_url text;

COMMENT ON COLUMN public.tiendas.hoja_auth IS
  'Nombre EXACTO del vendedor que puede ver las ventas del día en Captura de '
  'Series, tal como aparece en la lista de vendedores. Se compara letra por '
  'letra: una tilde o un espacio de más y deja de funcionar. Vacío = nadie.';

-- ------------------------------------------------------------
-- PASO 3 · Poner el nombre de Laura
-- ------------------------------------------------------------
-- Tomado de la propia lista de vendedores para que coincida exactamente
-- con lo que el cliente compara — así no depende de cómo se teclee aquí.
UPDATE public.tiendas t
SET hoja_auth = (
      SELECT v FROM unnest(t.vendedores) AS v
      WHERE lower(v) LIKE 'laura%' LIMIT 1
    )
WHERE t.store_id = '1217'
  AND EXISTS (SELECT 1 FROM unnest(t.vendedores) AS v WHERE lower(v) LIKE 'laura%');

-- Si el UPDATE no encontró a nadie, el SELECT del paso 5 lo va a delatar.
-- En ese caso ponlo a mano con el nombre exacto de la lista:
--   UPDATE public.tiendas SET hoja_auth = 'Laura ...' WHERE store_id = '1217';

-- ------------------------------------------------------------
-- PASO 4 · Que las funciones lo entreguen
-- ------------------------------------------------------------
-- Cambia el tipo de retorno, así que CREATE OR REPLACE no basta: hay que
-- DROP primero. El cuerpo es el mismo de GAS_guardian.sql; lo único nuevo
-- son t.hoja_auth y t.sheet_url al final.

DROP FUNCTION IF EXISTS public.login_asesor(text);

CREATE FUNCTION public.login_asesor(p_pin text)
RETURNS TABLE (store_id text, nombre text, ciudad text,
               gas_url text, vendedores jsonb, gas_token text,
               hoja_auth text, sheet_url text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.store_id, t.nombre, t.ciudad, t.gas_url,
         to_jsonb(t.vendedores), t.gas_token,
         t.hoja_auth, t.sheet_url
  FROM public.tiendas t
  WHERE coalesce(t.activo, true) = true
    AND length(coalesce(p_pin,'')) >= 4
    AND p_pin = coalesce(nullif(t.asesor_pin, ''), t.store_id)
  LIMIT 1;
$$;

DROP FUNCTION IF EXISTS public.login_empleado(text);

CREATE FUNCTION public.login_empleado(p_pin text)
RETURNS TABLE (store_id text, nombre text, ciudad text,
               gas_url text, vendedores jsonb,
               emp_no text, emp_nombre text, emp_puesto text, emp_admin boolean,
               gas_token text, hoja_auth text, sheet_url text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.store_id, t.nombre, t.ciudad, t.gas_url,
         to_jsonb(t.vendedores),
         e.empno, e.nombre, e.puesto, e.admin,
         t.gas_token, t.hoja_auth, t.sheet_url
  FROM public.empleados e
  JOIN public.tiendas  t ON t.store_id = e.store_id
  WHERE e.activo = true
    AND coalesce(t.activo, true) = true
    AND length(coalesce(p_pin,'')) >= 4
    AND e.empno = p_pin
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.login_asesor(text)   FROM public;
REVOKE ALL ON FUNCTION public.login_empleado(text) FROM public;
GRANT EXECUTE ON FUNCTION public.login_asesor(text)   TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.login_empleado(text) TO anon, authenticated;

-- ------------------------------------------------------------
-- PASO 5 · Comprobar que quedó
-- ------------------------------------------------------------
-- Cambia 1217 por el PIN real de asesor si no es ese.
SELECT store_id,
       coalesce(hoja_auth, '(vacío)') AS quien_ve_las_ventas,
       (gas_token IS NOT NULL)        AS trae_token
FROM public.login_asesor('1217');

-- Debe salir el nombre de Laura, no "(vacío)".
-- Si sale vacío, el botón seguirá oculto: revisa el paso 3.
--
-- Después de correr esto, Laura tiene que SALIR y volver a ENTRAR en
-- Captura de Series. La sesión se guarda en el teléfono/laptop al entrar;
-- si no vuelve a entrar, sigue con la vieja y sin hoja_auth.
