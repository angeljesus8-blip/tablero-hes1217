-- ============================================================
--  ACCESO DE TECNICOS EXTERNOS — solo accesorios, solo lectura
--  20-ago-2026
-- ============================================================
--
--  Dos tecnicos de Mr Fix necesitan cotejar su mes: que accesorios se vendieron,
--  en que ticket y a que precio. Nada mas del sistema.
--
--  ------------------------------------------------------------
--  POR QUE NO ENTRAN COMO EMPLEADOS
--  ------------------------------------------------------------
--  Son EXTERNOS. Meterlos en `empleados` les daria el `gas_token` de la tienda,
--  que es el permiso de ESCRITURA sobre todo: ventas, inventario, EOL, avisos,
--  apartados. Esconder pantallas en el cliente no impide llamar a una funcion.
--
--  Por eso llevan su propia clave, que NO sirve para escribir nada: las dos
--  funciones de abajo son las unicas que la aceptan, y las dos solo leen.
--
--  ------------------------------------------------------------
--  Y NO VEN NOMBRES
--  ------------------------------------------------------------
--  `accesorios_tecnico_lista` devuelve dia, ticket, producto, cantidad y
--  precio. NO devuelve `vendedor`: quien vendio es del equipo de la tienda y no
--  hace falta para cuadrar accesorios.
--
--  ⚠️ La FOTO del ticket si lo lleva, y mas: «Atendido por», los demas
--  articulos de esa compra, la forma de pago y parte del numero de tarjeta del
--  cliente. Se advirtio y Angel decidio mostrarla igual (20-ago-2026). Queda
--  escrito aqui porque quien lea esto dentro de seis meses tiene que saber que
--  fue una decision tomada, no un descuido.
--
--  Se pega completo en el SQL Editor. Es idempotente.
-- ============================================================


-- ── 1 · Quien puede mirar ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tecnicos_acceso (
  id         bigserial   PRIMARY KEY,
  store_id   text        NOT NULL REFERENCES public.tiendas(store_id) ON DELETE CASCADE,
  nombre     text        NOT NULL,
  -- Clave propia, larga y aleatoria. NO es el gas_token: con esta no se puede
  -- escribir nada en ningun sitio.
  clave      text        NOT NULL,
  activo     boolean     NOT NULL DEFAULT true,
  ultimo_acceso timestamptz,
  creado_en  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, clave)
);

ALTER TABLE public.tecnicos_acceso ENABLE ROW LEVEL SECURITY;
-- Sin politicas: no se llega por REST. Solo la leen las funciones DEFINER.

COMMENT ON TABLE public.tecnicos_acceso IS
  'Tecnicos externos (Mr Fix) que consultan las ventas de accesorios. Su clave '
  'NO es el gas_token y no sirve para escribir: solo la aceptan '
  'accesorios_tecnico_lista y accesorios_tecnico_foto.';

/* Siembra de arranque. Se cambian con un UPDATE cuando haga falta; darlas de
   baja es poner activo=false, que corta el acceso sin borrar el rastro.

   SOLO SIEMBRA SI LA TIENDA NO TIENE NINGUN TECNICO. Antes iba con
   ON CONFLICT (store_id, clave) DO NOTHING, que no protege de lo que importa:
   una vez rotada la clave, el conflicto ya no salta y repegar este archivo
   RESUCITA la clave vieja como un tercer tecnico activo. Reabrir un acceso
   retirado, sin dar error y sin que nadie mire esa tabla. */
INSERT INTO public.tecnicos_acceso (store_id, nombre, clave)
SELECT v.store_id, v.nombre, v.clave
  FROM (VALUES ('1217', 'Tecnico Mr Fix 1', 'mrfix-1217-a7k2m9x4qp'),
               ('1217', 'Tecnico Mr Fix 2', 'mrfix-1217-t5w8n3z6vb'))
       AS v(store_id, nombre, clave)
 WHERE NOT EXISTS (SELECT 1 FROM public.tecnicos_acceso t
                    WHERE t.store_id = v.store_id);


-- ── 2 · La clave vale, y se anota quien mira ────────────────
CREATE OR REPLACE FUNCTION public.tecnico_ok_(p_store text, p_clave text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_id bigint;
BEGIN
  SELECT id INTO v_id FROM public.tecnicos_acceso
   WHERE store_id = p_store AND clave = p_clave AND activo
   LIMIT 1;
  IF v_id IS NULL THEN RETURN false; END IF;
  -- Deja rastro de que se uso. Sin esto no habria forma de saber si una clave
  -- sigue en uso el dia que haya que retirarla.
  UPDATE public.tecnicos_acceso SET ultimo_acceso = now() WHERE id = v_id;
  RETURN true;
END $fn$;

REVOKE ALL ON FUNCTION public.tecnico_ok_(text,text) FROM public, anon, authenticated;


-- ── 3 · Las ventas del mes, SIN nombres ─────────────────────
CREATE OR REPLACE FUNCTION public.accesorios_tecnico_lista(
  p_store text, p_clave text,
  p_anio integer DEFAULT NULL, p_mes integer DEFAULT NULL
) RETURNS TABLE (dia date, ticket text, producto text,
                 cantidad integer, precio numeric, importe numeric,
                 captura_id text, tiene_foto boolean)
-- VOLATILE (por omision), y NO STABLE: `tecnico_ok_` sella `ultimo_acceso` con
-- un UPDATE. PostgREST corre las funciones STABLE en transaccion de SOLO
-- LECTURA, asi que marcarla STABLE la reventaba con 405 / 25006.
-- Y solo con la clave BUENA: con una mala se sale en el SELECT, antes del
-- UPDATE, y devuelve cero filas tan tranquila.
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF NOT public.tecnico_ok_(p_store, p_clave) THEN
    RETURN;   -- clave mala: cero filas, sin decir por que
  END IF;
  RETURN QUERY
    SELECT v.dia, v.ticket, v.producto, v.cantidad, v.precio, v.importe,
           v.captura_id,
           EXISTS (SELECT 1 FROM public.venta_fotos f
                    WHERE f.store_id = v.store_id AND f.captura_id = v.captura_id)
    FROM public.accesorios_ventas v
    WHERE v.store_id = p_store
      AND extract(year  from v.dia)::int =
          coalesce(p_anio, extract(year  from (now() AT TIME ZONE 'America/Mexico_City'))::int)
      AND extract(month from v.dia)::int =
          coalesce(p_mes,  extract(month from (now() AT TIME ZONE 'America/Mexico_City'))::int)
    ORDER BY v.dia, v.vendida_en;
END $fn$;


-- ── 4 · La foto de ESE ticket, y solo de accesorios ─────────
--
-- El candado que importa: solo se sirve la foto si su `captura_id` pertenece a
-- una venta de ACCESORIOS. Sin esa comprobacion, la clave del tecnico abriria
-- cualquier foto de `venta_fotos` — incluidas las de ventas de equipos con
-- numero de serie, que no tienen nada que ver con su trabajo.
CREATE OR REPLACE FUNCTION public.accesorios_tecnico_foto(
  p_store text, p_clave text, p_captura_id text
) RETURNS jsonb
-- VOLATILE por lo mismo que la de arriba: `tecnico_ok_` escribe.
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE r record;
BEGIN
  IF NOT public.tecnico_ok_(p_store, p_clave) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_autorizado');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.accesorios_ventas a
                  WHERE a.store_id = p_store AND a.captura_id = p_captura_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'esa foto no es de un accesorio');
  END IF;

  SELECT encode(f.imagen, 'base64') AS b64, f.mime INTO r
    FROM public.venta_fotos f
   WHERE f.store_id = p_store AND f.captura_id = p_captura_id;

  IF r IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sin foto');
  END IF;
  RETURN jsonb_build_object('ok', true, 'imagen', r.b64, 'mime', r.mime);
END $fn$;


-- ── 5 · Permisos ────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.accesorios_tecnico_lista(text,text,integer,integer) FROM public;
REVOKE ALL ON FUNCTION public.accesorios_tecnico_foto(text,text,text)             FROM public;
GRANT EXECUTE ON FUNCTION public.accesorios_tecnico_lista(text,text,integer,integer) TO anon;
GRANT EXECUTE ON FUNCTION public.accesorios_tecnico_foto(text,text,text)             TO anon;


-- ============================================================
--  COMPROBAR
-- ============================================================
--
--  1) Las dos claves existen:
--       select nombre, clave, activo from public.tecnicos_acceso where store_id='1217';
--
--  2) Con clave buena devuelve filas y SIN columna de vendedor:
--       select * from public.accesorios_tecnico_lista('1217','mrfix-1217-a7k2m9x4qp');
--
--  3) LO QUE HAY QUE COMPROBAR — con clave mala, CERO filas:
--       select count(*) from public.accesorios_tecnico_lista('1217','inventada');
--
--  4) Y que la clave no abre fotos que no son de accesorios. Coge un captura_id
--     de una venta de EQUIPO (tabla `ventas`) y pidelo:
--       select public.accesorios_tecnico_foto('1217','mrfix-1217-a7k2m9x4qp','<id de ventas>');
--     Tiene que responder «esa foto no es de un accesorio».
--
--  5) Retirar a un tecnico:
--       update public.tecnicos_acceso set activo=false where nombre='Tecnico Mr Fix 1';
--
-- ============================================================
--  Odemas · Grupo Gigante — uso interno HES 1217
-- ============================================================


-- ============================================================
--  ── 6 · Darlos de alta desde Admin (20-ago-2026) ──────────
-- ============================================================
--
--  Estas TRES si piden el gas_token: las usa el gerente desde Admin, no el
--  tecnico. La clave del tecnico no sirve aqui, y el token del gerente no
--  sirve para consultar las ventas — cada uno abre lo suyo.

-- La clave la genera la BASE, no el navegador. Escrita a mano acabaria siendo
-- «mrfix1» o el nombre de la tienda; aqui sale aleatoria y no se puede adivinar.
CREATE OR REPLACE FUNCTION public.tecnico_guardar(
  p_store text, p_token text, p_nombre text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE v_clave text;
BEGIN
  IF NOT public.escritura_ok_(p_store, p_token) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_autorizado');
  END IF;
  IF coalesce(trim(p_nombre),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'falta el nombre');
  END IF;

  v_clave := 'mrfix-' || p_store || '-' ||
             substr(md5(random()::text || clock_timestamp()::text), 1, 12);

  INSERT INTO public.tecnicos_acceso (store_id, nombre, clave)
  VALUES (p_store, trim(p_nombre), v_clave);

  -- La clave se devuelve UNA vez, al crearla: es lo que hay que darle al
  -- tecnico. Despues se puede volver a ver en la lista, porque quien entra a
  -- Admin ya puede leerla de la tabla igual — esconderla seria teatro.
  RETURN jsonb_build_object('ok', true, 'clave', v_clave);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLSTATE || ': ' || left(SQLERRM, 120));
END $fn$;

CREATE OR REPLACE FUNCTION public.tecnicos_lista(p_store text, p_token text)
RETURNS TABLE (id bigint, nombre text, clave text, activo boolean,
               ultimo_acceso timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF NOT public.escritura_ok_(p_store, p_token) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT t.id, t.nombre, t.clave, t.activo, t.ultimo_acceso
      FROM public.tecnicos_acceso t
     WHERE t.store_id = p_store
     ORDER BY t.activo DESC, t.nombre;
END $fn$;

CREATE OR REPLACE FUNCTION public.tecnico_baja(
  p_store text, p_token text, p_id bigint, p_activo boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF NOT public.escritura_ok_(p_store, p_token) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_autorizado');
  END IF;
  /* Se da de baja, NO se borra: la fila guarda el ultimo acceso, y borrarla
     tira la unica pista de si esa clave llego a usarse y hasta cuando. */
  UPDATE public.tecnicos_acceso SET activo = coalesce(p_activo, false)
   WHERE store_id = p_store AND id = p_id;
  RETURN jsonb_build_object('ok', true);
END $fn$;

REVOKE ALL ON FUNCTION public.tecnico_guardar(text,text,text)              FROM public;
REVOKE ALL ON FUNCTION public.tecnicos_lista(text,text)                    FROM public;
REVOKE ALL ON FUNCTION public.tecnico_baja(text,text,bigint,boolean)       FROM public;
GRANT EXECUTE ON FUNCTION public.tecnico_guardar(text,text,text)            TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tecnicos_lista(text,text)                  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tecnico_baja(text,text,bigint,boolean)     TO anon, authenticated;
