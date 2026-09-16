-- ============================================================
--  El gerente que entra con su CORREO también ve al equipo — 15-sep-2026
-- ============================================================
--  Síntoma: entrando con el número de empleado, el gerente ve las comisiones
--  del equipo entero. Entrando con su correo y contraseña —la misma persona,
--  la misma tienda— la pantalla le dice «Para ver tu comisión, entra con tu
--  número de empleado». Sin ningún error, que es lo que lo hace parecer un
--  permiso mal puesto cuando es otra cosa.
--
--  La causa: `comisiones_lista` pregunta SOLO por número de empleado
--  (`p_empno`). Quien entra con el correo de la tienda es el DUEÑO, y el dueño
--  no tiene ficha en `empleados` —su cuenta vive en `tiendas.user_id`—, así que
--  `index.html` no guarda `hes1217_empleado` y la pantalla llega al servidor
--  diciendo «no sé quién soy». Y eso, por diseño, no devuelve nada:
--  «no sé quién eres» no puede significar «toma todo». Ver
--  `supabase_comisiones_privadas.sql`, que es donde se decidió.
--
--  Es EL MISMO fallo que el MAPA ya documenta dos veces (cadena 1 y 1-bis):
--  la misma persona, dos puertas de entrada, distinto resultado. `hoja_auth`
--  costó dos días; `vincular_mi_cuenta` no devolvía el puesto y al subgerente
--  le aparecía Resurtir con su número y no con su correo. Esta es la tercera vez,
--  y ahora en la pantalla del sueldo.
--
--  Lo que cambia: se añade UNA condición —`admin_de(p_store)`— a la lista de
--  quién puede ver al equipo. Nada más. No se toca ningún importe, ni el
--  filtro del asesor, ni la exigencia del token.
--
--  Se pega completo en el SQL Editor. Es idempotente.
-- ============================================================


-- ── 1 · La tercera forma de mandar aquí ─────────────────────
--  `admin_de` ya existe (`supabase_acceso_funciones.sql`) y es la que usa el
--  horario para lo mismo. Responde que sí por dos caminos:
--
--    · la cuenta es la dueña de la tienda   (tiendas.user_id = auth.uid())
--    · o tiene ficha activa con admin       (empleados.user_id = auth.uid())
--
--  Y responde que NO cuando no hay sesión: con la clave publicable `auth.uid()`
--  es NULL, así que esto NO reabre lo que se cerró el 6-sep. Cualquiera que lea
--  la clave dentro del HTML publicado sigue sin sacar una sola fila; para pasar
--  por aquí hay que traer un JWT de verdad, y eso es correo y contraseña.
--
--  ⚠️ Va PRIMERO en el OR y por eso mismo importa el orden: `puede_gestionar_`
--  mira `p_empno`, que en este caso viene vacío, así que sin esta línea el
--  gerente por correo cae al último tramo (`k.empno = ''`) y no casa con nadie.
--
--  Se puede ejecutar aunque `admin_de` esté concedida solo a `authenticated`:
--  esta función es SECURITY DEFINER, corre como su dueño, y `auth.uid()` sigue
--  leyendo el JWT de quien llama.
--
--  `alcance` y `gar_pct` SÍ pueden pasar de 100 — hay 30 días de ventana para
--  comprar el seguro. Si alguien mete aquí un LEAST(...,100) «para que se vea
--  bien», estará borrando trabajo hecho de verdad. (Se conserva de la versión
--  anterior; esta función no cambia ni un número, solo QUIÉN los ve.)
CREATE OR REPLACE FUNCTION public.comisiones_lista(
  p_store text,
  p_token text,
  p_empno text
)
RETURNS TABLE (empno text, nombre text, puesto text, venta numeric,
               ppto_pct numeric, alcance numeric, gar_pct numeric,
               gar_pzas integer, gar_elegible integer, gar_monto numeric,
               periodo text, periodo_gar text, actualizado timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT k.empno, k.nombre, k.puesto, k.venta, k.ppto_pct, k.alcance,
         k.gar_pct, k.gar_pzas, k.gar_elegible, k.gar_monto,
         k.periodo, k.periodo_gar, k.updated_at
  FROM public.comisiones k
  WHERE k.store_id = p_store
    AND public.escritura_ok_(p_store, p_token)
    AND (
      -- NUEVO (15-sep-2026): quien entró con su correo y manda en esta tienda.
      -- Es el gerente dueño, que no tiene número que enseñar.
      public.admin_de(p_store)
      -- Gerente y subgerente por número. Se comprueba contra `empleados`
      -- (activo + puesto), no contra lo que diga el teléfono.
      OR public.puede_gestionar_(p_store, nullif(trim(coalesce(p_empno,'')), ''))
      -- Cualquier otro: la suya, y solo si dijo quién es. Sin número no se
      -- devuelve nada: «no sé quién eres» no puede significar «toma todo».
      OR k.empno = nullif(trim(coalesce(p_empno,'')), '')
    )
  ORDER BY k.venta DESC NULLS LAST;
$$;

REVOKE ALL ON FUNCTION public.comisiones_lista(text,text,text) FROM public;
GRANT EXECUTE ON FUNCTION public.comisiones_lista(text,text,text) TO anon, authenticated;

COMMENT ON FUNCTION public.comisiones_lista(text,text,text) IS
  'Comisiones de la tienda filtradas por quien mira: el equipo entero para '
  'quien manda —gerente o subgerente por numero, o cuenta con admin_de por '
  'correo—, su propia fila para cualquier otro, y nada sin token o sin forma '
  'de saber quien es.';


-- ============================================================
--  COMPROBAR
-- ============================================================
--
--  ⚠️ Los puntos 1 y 2 NO se pueden comprobar desde el SQL Editor: ahí la
--  sesión es la del panel de Supabase, `auth.uid()` no es el de la app y
--  `admin_de` responde lo que no toca. Se comprueban desde la app, que es
--  donde vive el caso. Lo que sí se puede comprobar aquí es que nada de lo que
--  ya funcionaba dejó de funcionar (puntos 3 a 6).
--
--  1) En la app, entrando con CORREO Y CONTRASEÑA: la pantalla de Comisiones
--     enseña «👥 Equipo — N integrantes», no «entra con tu número».
--
--  2) En la app, entrando con el NÚMERO de un asesor: sigue viendo una sola
--     tarjeta, la suya.
--
--  3) Sin sesión, con la clave publicable y sin número — el agujero que se
--     cerró el 6-sep, que tiene que seguir cerrado:
--       select count(*) from public.comisiones_lista('1217', '<token>', '');
--     -- espera 0
--
--  4) El gerente por su número sigue viendo a todos:
--       select count(*) from public.comisiones_lista('1217', '<token>', '<empno-gerente>');
--     -- espera el número de personas con comisión cargada
--
--  5) El asesor por su número, solo la suya:
--       select empno from public.comisiones_lista('1217', '<token>', '<empno-asesor>');
--     -- espera EXACTAMENTE una fila, con su propio número
--
--  6) Con el token equivocado, nada — ni para quien manda:
--       select count(*) from public.comisiones_lista('1217', 'no-es', '<empno-gerente>');
--     -- espera 0
--
--  (Los números reales están en `_privado/datos_equipo.txt`.)
--
--
--  SI ALGO SALE MAL, se vuelve atrás pegando de nuevo la función tal como está
--  en `supabase_comisiones_privadas.sql`: es la misma menos la línea de
--  `admin_de`. No hay tabla que restaurar — esto no escribe nada.
-- ============================================================
