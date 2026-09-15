-- ============================================================
--  Cada quien ve SU comisión — 6-sep-2026
-- ============================================================
--  ⚠️ YA NO ES LA VERSIÓN VIVA (15-sep-2026). La que está pegada en Supabase es
--  la de `supabase_comisiones_gerente_correo.sql`, idéntica a esta más una
--  línea: `admin_de(p_store)`, que es lo que deja al gerente DUEÑO —el que
--  entra con el correo de la tienda y no tiene ficha de empleado— ver las
--  comisiones del equipo.
--
--  Repegar ESTE archivo revierte aquello SIN DAR ERROR: el gerente vuelve a ver
--  «entra con tu número de empleado» en su propia tienda y nada lo relaciona
--  con haber pegado un .sql. Si hay que volver atrás a propósito, adelante —
--  esa es justo la marcha atrás documentada allí—; si no, pega el otro.
--
--  Lo de abajo se conserva porque es donde se decidió QUÉ se protege y por qué.
-- ============================================================
--  Pedido en piso: «para el apartado de comisiones me gustaria que solamente
--  cada integrante pudiera ver el suyo, a excepcion del gerente que podria ver
--  el de todos».
--
--  Y al ir a hacerlo apareció algo más gordo. `comisiones_lista(p_store)` no
--  pide NADA salvo el número de tienda, y está concedida a `anon`. O sea que
--  cualquiera con la clave publicable —que viaja dentro de comisiones.html, en
--  un repo público— podía volcar el sueldo del equipo entero desde fuera de la
--  tienda. Se comprobó con un curl, sin sesión y sin PIN: cuatro filas con
--  nombre completo, venta, garantías e importes.
--
--  Esta version pide DOS cosas:
--
--    p_token  el gas_token de la tienda. Lo tiene toda sesión de la app y no se
--             adivina (64 caracteres). Es el mismo candado que ya protege las
--             escrituras (`escritura_ok_`), y lo que saca las comisiones de
--             estar al alcance de cualquiera que lea el HTML publicado.
--    p_empno  el número de quien mira. Decide QUÉ ve.
--
--  ⚠️ HASTA DÓNDE LLEGA ESTO, para que no se confunda con lo que no es.
--  El equipo no tiene contraseña propia: se identifica con un número que
--  aparece en tickets y reportes. Así que esto es un cerrojo, no una caja
--  fuerte — cierra el caso real (abrir la app y ver el sueldo del de al lado, o
--  leerlo desde fuera con la clave pública), pero no para a quien conozca el
--  número del gerente y lo teclee a propósito. La caja fuerte sería que el
--  gerente entrara con su correo y contraseña, y se decide aparte.
--
--  Se pega completo en el SQL Editor. Es idempotente.
-- ============================================================


-- ── 1 · La versión que filtra ───────────────────────────────
--  Firma NUEVA (tres argumentos, ninguno con DEFAULT) para que conviva con la
--  vieja sin que PostgREST dude entre las dos: se llaman por nombre de
--  argumento, y {p_store} solo casa con la vieja y {p_store,p_token,p_empno}
--  solo con esta. Sin esto, una sobrecarga ambigua responde PGRST203 y la
--  pantalla se queda sin comisiones para todos.
--
--  `alcance` y `gar_pct` SÍ pueden pasar de 100 — hay 30 días de ventana para
--  comprar el seguro. Si alguien mete aquí un LEAST(...,100) «para que se vea
--  bien», estará borrando trabajo hecho de verdad. (Se conserva de la versión
--  original; esta función no cambia ni un número, solo QUIÉN los ve.)
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
      -- Gerente y subgerente: el equipo entero. Se comprueba contra `empleados`
      -- (activo + puesto), no contra lo que diga el teléfono.
      public.puede_gestionar_(p_store, nullif(trim(coalesce(p_empno,'')), ''))
      -- Cualquier otro: la suya, y solo si dijo quién es. Sin número no se
      -- devuelve nada: «no sé quién eres» no puede significar «toma todo».
      OR k.empno = nullif(trim(coalesce(p_empno,'')), '')
    )
  ORDER BY k.venta DESC NULLS LAST;
$$;

REVOKE ALL ON FUNCTION public.comisiones_lista(text,text,text) FROM public;
GRANT EXECUTE ON FUNCTION public.comisiones_lista(text,text,text) TO anon, authenticated;

COMMENT ON FUNCTION public.comisiones_lista(text,text,text) IS
  'Comisiones de la tienda filtradas por quien mira: gerente y subgerente ven '
  'el equipo entero, cualquier otro solo su fila, y sin token o sin numero no '
  'se devuelve nada. Sustituye a comisiones_lista(text), que las daba todas a '
  'cualquiera con la clave publicable.';


-- ── 2 · Cerrar la puerta vieja ──────────────────────────────
--  Esto apaga `comisiones_lista(p_store)`: la que devuelve el equipo entero sin
--  pedir nada, y la que hace que las comisiones sean legibles hoy con la clave
--  publicable. SE PEGA JUNTO CON LO DE ARRIBA. Pegar el SQL tiene que bastar
--  para que el cambio valga; no puede quedar dependiendo de que cada quien
--  actualice su celular.

REVOKE ALL ON FUNCTION public.comisiones_lista(text) FROM anon, authenticated;

--  Se REVOCA y no se borra: un DROP se lleva por delante lo que dependa de
--  ella, y volver a concederla si algo sale mal es una línea:
--     GRANT EXECUTE ON FUNCTION public.comisiones_lista(text) TO anon, authenticated;
--
--  ⚠️ HAY UNA SEGUNDA PUERTA, y sin cerrarla esto MIENTE en vez de proteger.
--  Un celular con la app anterior a v230 solo sabe llamar a la firma vieja. Al
--  revocarla, esa app se cae al respaldo del Apps Script (`modo=comisiones`),
--  que lee la hoja «Comisiones» — y esa hoja dejó de recibir el 7-ago, así que
--  responde el reporte de JULIO con aspecto del mes en curso. O sea: el equipo
--  entero, de un mes que no es, sin un solo error en pantalla.
--
--  SE CIERRA SIN TOCAR EL APPS SCRIPT, en el propio Google Sheets:
--
--     Renombrar la pestaña «Comisiones» -> «Comisiones_hasta_ago2026»
--
--  `leerComisiones_` la busca por ese nombre exacto; si no la encuentra
--  devuelve la lista vacía, y la app vieja dice «No llegaron datos nuevos. Lo
--  que ves es lo último guardado en este teléfono» en vez de pintar julio.
--  Renombrar y no borrar: el histórico se conserva entero.
--
--  Quedarse sin comisiones un rato se nota y se pregunta; ver las de otro mes
--  como si fueran de hoy, no.
--
--  Lo único que NO se puede cerrar desde aquí es la copia que cada teléfono ya
--  tiene guardada de antes. Se borra sola en cuanto esa persona abre la app en
--  v230, que se actualiza al abrir y al volver.


-- ============================================================
--  COMPROBAR  (cambia <empno-gerente> y <empno-asesor> por los reales,
--              que están en _privado/datos_equipo.txt)
-- ============================================================
--
--  1) El gerente ve a todo el equipo:
--       select count(*) from public.comisiones_lista('1217', '<token>', '<empno-gerente>');
--     -- espera el número de personas con comisión cargada
--
--  2) El asesor, solo la suya:
--       select empno from public.comisiones_lista('1217', '<token>', '<empno-asesor>');
--     -- espera EXACTAMENTE una fila, y con su propio número
--
--  3) Sin número no hay nada — «no sé quién eres» no es «toma todo»:
--       select count(*) from public.comisiones_lista('1217', '<token>', '');
--     -- espera 0
--
--  4) Con el token equivocado, tampoco:
--       select count(*) from public.comisiones_lista('1217', 'no-es', '<empno-gerente>');
--     -- espera 0
--
--  5) Y un número que no es de nadie no abre nada:
--       select count(*) from public.comisiones_lista('1217', '<token>', '999999');
--     -- espera 0
