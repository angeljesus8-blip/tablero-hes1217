-- ============================================================
--  equipo_lista — que Sales Arena pueda leer el equipo de la 1217
--  26-sep-2026
-- ============================================================
--
--  Qué lo trae
--  -----------
--  Ángel: «si agrego un nuevo asesor, debería aparecer en Sales Arena». No
--  aparecía porque la 1217 de Sales Arena NUNCA se conectó a este tablero: tenía
--  4 personas escritas a mano en Sales Arena. Y no se podía conectar: la conexión
--  (api/store.js de Sales Arena, `vincular_tablero`) pregunta por
--  `equipo_lista`, que nació en tablero-odemas (supabase_equipo_por_numero.sql)
--  y aquí no existía — respondía PGRST202.
--
--  Qué hace
--  --------
--  Devuelve el equipo de la tienda SOLO a quien traiga las dos llaves:
--    · la clave de escritura de la tienda (`escritura_ok_`), y
--    · el número de alguien ACTIVO con Admin (`puede_admin`).
--  Con una sola bastaría adivinar un número —son cortos— para leerse los
--  números de todos, que son las llaves de entrada de la tienda. Sales Arena
--  guarda las dos en su backend, nunca en el navegador.
--
--  Igual que la de odemás, MENOS la columna `ventas_dia`: en la 1217 esa marca
--  no existe (quién abre «Ventas del día» lo dice `hoja_auth`). Sales Arena solo
--  usa empno, nombre y activo.
--
--  Se puede pegar varias veces.
-- ============================================================

CREATE OR REPLACE FUNCTION public.equipo_lista(p_store text, p_token text, p_quien text)
RETURNS TABLE (id bigint, empno text, nombre text, puesto text,
               activo boolean, admin boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT e.id, e.empno, e.nombre, e.puesto, e.activo, e.admin
    FROM public.empleados e
   WHERE e.store_id = p_store
     AND public.escritura_ok_(p_store, p_token)
     -- POR NOMBRE, no por posición: la firma real es (p_store_id, p_empno) y
     -- llamarla al revés NO da error —devuelve false— y la lista sale vacía como
     -- si no hubiera nadie (pasó en odemás el 2-sep-2026).
     AND public.puede_admin(p_store_id => p_store, p_empno => p_quien)
   ORDER BY e.activo DESC, e.nombre;
$$;

REVOKE ALL ON FUNCTION public.equipo_lista(text,text,text) FROM public;
GRANT EXECUTE ON FUNCTION public.equipo_lista(text,text,text) TO anon, authenticated;

-- COMPROBAR: es lo último, así que es lo que enseña el editor.
-- Con una clave falsa no puede devolver a nadie. Esperado: filas = 0, versiones = 1.
SELECT (SELECT count(*) FROM public.equipo_lista('1217', 'clave-falsa', '0')) AS filas,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'equipo_lista') AS versiones;
