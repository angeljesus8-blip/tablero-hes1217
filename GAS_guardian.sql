-- ============================================================
-- Cierra el acceso al Apps Script — correr en Supabase (SQL Editor)
-- Proyecto del tablero. 30-jul-2026.
-- ============================================================
--
-- Dos problemas que resuelve:
--
-- 1. El Apps Script responde a cualquiera. Comprobado sin credencial:
--    ?modo=loquesea devuelve 200 filas de Ventas con número de serie,
--    precio y vendedor. El guardián del .gs exige un token; este SQL es
--    de dónde sale ese token.
--
-- 2. login_asesor('1217') entra. Y "1217" está en el nombre del repo, en
--    el título de la app y en el pie de página.
--
--    Al leer la función se ve por qué, y es una buena noticia:
--        p_pin = coalesce(nullif(t.asesor_pin, ''), t.store_id)
--    La columna asesor_pin YA EXISTE y el diseño ya contemplaba un PIN
--    propio. Está vacía, así que cae al store_id. No hay que cambiar la
--    lógica: hay que llenar la columna.
--
-- Correr por pasos y leer lo que devuelve cada uno.
-- ============================================================


-- ── PASO 1 · Estado actual ──────────────────────────────────
-- asesor_pin vacío = hoy se entra con el número de tienda.

SELECT store_id,
       coalesce(nullif(asesor_pin,''), '(vacío → se usa el store_id)') AS pin_hoy,
       (gas_token IS NOT NULL)                                         AS ya_tiene_token
FROM public.tiendas
WHERE store_id = '1217';


-- ── PASO 2 · Columna para el token ──────────────────────────
-- asesor_pin ya existe; solo falta gas_token.

ALTER TABLE public.tiendas
  ADD COLUMN IF NOT EXISTS gas_token text;

COMMENT ON COLUMN public.tiendas.gas_token IS
  'Idéntico a GAS_TOKEN en Propiedades del script del Apps Script.';
COMMENT ON COLUMN public.tiendas.asesor_pin IS
  'PIN que teclea el equipo. Si queda vacío se usa el store_id, que es público.';


-- ── PASO 3 · Poner los valores ──────────────────────────────
-- Los valores están en _privado_no_publicar/SECRETOS_gas.txt.
-- Este archivo va al repo: NO pegues los valores reales aquí.

UPDATE public.tiendas
SET asesor_pin = 'PEGA_AQUI_EL_PIN_NUEVO',
    gas_token  = 'PEGA_AQUI_EL_TOKEN_LARGO'
WHERE store_id = '1217';

-- Comprobación sin imprimir los valores:
SELECT store_id,
       length(asesor_pin)          AS largo_pin,
       length(gas_token)           AS largo_token,
       (asesor_pin = store_id)     AS pin_inseguro   -- debe dar false
FROM public.tiendas WHERE store_id = '1217';


-- ── PASO 4 · Las funciones devuelven también el token ───────
-- Cambia el tipo de retorno, así que CREATE OR REPLACE no basta:
-- hay que DROP primero. El cuerpo es el mismo que ya tenían, leído de
-- pg_proc el 30-jul-2026; lo único nuevo es t.gas_token al final.

DROP FUNCTION IF EXISTS public.login_asesor(text);

CREATE FUNCTION public.login_asesor(p_pin text)
RETURNS TABLE (store_id text, nombre text, ciudad text,
               gas_url text, vendedores jsonb, gas_token text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.store_id, t.nombre, t.ciudad, t.gas_url,
         to_jsonb(t.vendedores), t.gas_token
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
               gas_token text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.store_id, t.nombre, t.ciudad, t.gas_url,
         to_jsonb(t.vendedores),
         e.empno, e.nombre, e.puesto, e.admin,
         t.gas_token
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


-- ── PASO 5 · Comprobar que cerró ────────────────────────────
-- El primero DEBE dar 0. Si da 1, el PASO 3 no se aplicó.

SELECT count(*) AS debe_ser_cero FROM public.login_asesor('1217');
SELECT count(*) AS debe_ser_uno  FROM public.login_asesor('PEGA_AQUI_EL_PIN_NUEVO');


-- ============================================================
-- Después:
--   1. El equipo teclea el PIN NUEVO, no el 1217. Avísales antes.
--   2. Pega GAS_guardian.gs en el Apps Script, GAS_ESTRICTO = "false".
--   3. Se publican los HTML (ya mandan &t=).
--   4. Sin llamadas sin token en el registro → GAS_ESTRICTO = "true".
-- ============================================================
