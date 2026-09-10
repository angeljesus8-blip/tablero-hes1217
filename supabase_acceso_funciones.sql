-- ════════════════════════════════════════════════════════════════════
--  LAS CUATRO FUNCIONES DE ACCESO QUE NO ESTABAN AQUÍ
--  9-sep-2026
-- ════════════════════════════════════════════════════════════════════
--
--  Estas cuatro llevaban meses vivas en Supabase y la app las usaba, pero su
--  definición no estaba en ningún archivo de este repo. Estaban solo en unos
--  .sql sueltos fuera de todo control de versiones, y en `tablero-odemas`.
--
--  Por qué importaba: si algún día hubiera que rehacer la base desde este
--  repo, faltarían las cuatro. Y no daría un error claro —`admin.html` e
--  `index.html` hacen console.warn('… no disponible') y siguen adelante—, así
--  que el síntoma sería «Admin dice que no tengo permiso» sin nada que lo ate
--  a una función ausente.
--
--  Qué falta y quién lo llama:
--    · puede_admin          admin.html, antes de dejar entrar a Admin
--    · vincular_mi_cuenta   index.html y horarios.html, al iniciar sesión
--    · admin_de             las POLÍTICAS RLS de horarios (supabase_horarios.sql
--                           la usa en USING/WITH CHECK pero nunca la define)
--    · verificar_pin_admin  hoy solo se cita en un comentario de admin.html
--
--  DE DÓNDE SALE ESTO: no se copió de otro repo. Se le pidió a Postgres la
--  definición que está corriendo, con pg_get_functiondef(), y es lo que hay
--  abajo tal cual. Se comprobó después que coincide palabra por palabra con
--  la copia de `tablero-odemas`, en las cuatro.
--
--  ⚠️ Los GRANT sí se tomaron de `tablero-odemas`: pg_get_functiondef() no los
--  devuelve. Son los que tienen sentido con cómo la app llama a cada función
--  (anon puede validar un PIN antes de tener sesión; vincular_mi_cuenta y
--  admin_de necesitan una sesión ya iniciada), pero NO se verificaron contra
--  la base. Si algún día se ejecuta este archivo para restaurar, conviene
--  comprobarlos.
--
--  CORRER ESTO NO CAMBIA NADA HOY: las cuatro ya existen con este cuerpo.
--  El archivo está aquí para poder reconstruirlas, no para aplicarlo.
-- ════════════════════════════════════════════════════════════════════


-- ── 1 · admin_de — quién puede ESCRIBIR en una tienda ────────────────
-- Es el portero de las políticas RLS. Dice que sí por dos caminos: ser el
-- dueño de la tienda (el correo con el que se registró), o tener una ficha de
-- empleado activa con admin = true.
-- STABLE porque dentro de una misma consulta la respuesta no cambia: sin eso,
-- Postgres la vuelve a evaluar por cada fila de la política.

CREATE OR REPLACE FUNCTION public.admin_de(p_store_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
      select 1 from public.tiendas t
      where t.store_id = p_store_id and t.user_id = auth.uid()
    ) or exists (
      select 1 from public.empleados e
      where e.store_id = p_store_id and e.user_id = auth.uid()
        and e.activo = true and e.admin = true
    );
$function$;

GRANT EXECUTE ON FUNCTION public.admin_de(text) TO authenticated;


-- ── 2 · puede_admin — si esta persona abre Admin ─────────────────────
-- Va por NÚMERO DE EMPLEADO, no por sesión de Supabase: el asesor entra con su
-- número y no tiene cuenta propia. `admin.html` lo pregunta al servidor cada
-- vez en lugar de fiarse de lo que traiga el navegador.
-- Pide activo = true: a quien ya no trabaja aquí no le vale su número.

CREATE OR REPLACE FUNCTION public.puede_admin(p_store_id text, p_empno text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.empleados e
    where e.store_id = p_store_id
      and e.empno    = p_empno
      and e.activo   = true
      and e.admin    = true
  );
$function$;

GRANT EXECUTE ON FUNCTION public.puede_admin(text, text) TO anon, authenticated;


-- ── 3 · verificar_pin_admin — el PIN se comprueba en el servidor ─────
-- El PIN nunca viaja al navegador para compararlo allí: se manda y el servidor
-- responde sí o no. `length >= 4` evita que una tienda sin admin_pin puesto se
-- abra con una cadena vacía; si no hay admin_pin, cae al store_id.

CREATE OR REPLACE FUNCTION public.verificar_pin_admin(p_store_id text, p_pin text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.tiendas t
    where t.store_id = p_store_id
      and coalesce(t.activo, true) = true
      and length(coalesce(p_pin,'')) >= 4
      and p_pin = coalesce(nullif(t.admin_pin, ''), t.store_id)
  );
$function$;

GRANT EXECUTE ON FUNCTION public.verificar_pin_admin(text, text) TO anon, authenticated;


-- ── 4 · vincular_mi_cuenta — atar la sesión con la ficha del equipo ──
-- La llama la app justo después de iniciar sesión. Busca por CORREO una ficha
-- de empleado activa y le pega el user_id de la sesión. Así alguien que entra
-- con su cuenta de Supabase queda reconocido como parte del equipo de su
-- tienda, con su puesto y su permiso de admin.
--
-- El `and (e.user_id is null or e.user_id = auth.uid())` es lo que impide que
-- una cuenta nueva se quede con la ficha de alguien que ya la tenía atada.
--
-- Devuelve `puesto` porque el tablero y el horario deciden con él quién ve
-- Resurtir y quién ve el horario del equipo.

CREATE OR REPLACE FUNCTION public.vincular_mi_cuenta()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_email  text;
  v_store  text;
  v_nombre text;
  v_admin  boolean;
  v_empno  text;
  v_puesto text;
begin
  select lower(u.email) into v_email from auth.users u where u.id = auth.uid();
  if v_email is null then
    return json_build_object('ok', false, 'error', 'sin sesion');
  end if;

  update public.empleados e
     set user_id = auth.uid()
   where lower(e.email) = v_email
     and e.activo = true
     and (e.user_id is null or e.user_id = auth.uid())
  returning e.store_id, e.nombre, e.admin, e.empno, e.puesto
       into v_store, v_nombre, v_admin, v_empno, v_puesto;

  if v_store is null then
    return json_build_object('ok', false, 'error', 'sin ficha');
  end if;

  return json_build_object('ok', true, 'store_id', v_store, 'nombre', v_nombre,
                           'admin', v_admin, 'empno', v_empno,
                           'puesto', v_puesto);
end $function$;

GRANT EXECUTE ON FUNCTION public.vincular_mi_cuenta() TO authenticated;


-- ── Comprobación ─────────────────────────────────────────────────────
-- Que las cuatro existen y con la firma que la app espera. No devuelve datos
-- de nadie: solo nombres y firmas.
--
-- select p.proname, pg_get_function_arguments(p.oid), pg_get_function_result(p.oid)
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public'
--    and p.proname in ('admin_de','puede_admin','verificar_pin_admin','vincular_mi_cuenta')
--  order by p.proname;
