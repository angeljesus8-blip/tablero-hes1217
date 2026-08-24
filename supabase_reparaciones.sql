-- ============================================================
--  REPARACIONES — 24-ago-2026
--
--  Los tickets de reparacion de Mr Fix. El asesor los captura en Captura de
--  Series, junto al accesorio, y los dos tecnicos externos los cotejan en su
--  pantalla.
--
--  TABLA APARTE, Y ESA ES LA PIEZA QUE IMPORTA.
--
--  El Excel regional de Mr Fix (`Registro_Ventas_MrFix_Odemas_2026.xlsx`) se
--  arma con `accesorios_reporte`, que lee `accesorios_ventas`. Una reparacion
--  guardada AHI apareceria en ese Excel como una venta de accesorio: moveria
--  las comisiones de todo el equipo y el importe de una hoja que comparten diez
--  tiendas, sin dar error en ningun sitio.
--
--  Se penso en una columna `tipo` en `accesorios_ventas` y se descarto: eso
--  hace que NO contaminar dependa de que cada consulta futura se acuerde del
--  filtro. Basta un WHERE que falte —o un COUNT(*) en un tablero— para que las
--  reparaciones entren donde no van. Separadas es imposible por construccion,
--  que es el mismo argumento por el que `accesorios_ventas` no vive dentro de
--  `ventas`.
--
--  NO llevan vendedor ni comision: la reparacion es del tecnico, la tienda no
--  cobra por ella. Por eso tampoco hay `producto` ni `sku` — no van a ninguna
--  columna de ningun reporte.
--
--  Se pega completo en el SQL Editor. Es idempotente.
-- ============================================================


-- ── 1 · La tabla ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reparaciones (
  id          bigserial   PRIMARY KEY,
  store_id    text        NOT NULL REFERENCES public.tiendas(store_id) ON DELETE CASCADE,
  recibida_en timestamptz NOT NULL DEFAULT now(),
  -- El dia en hora de Mexico. Se deriva con trigger, igual que en
  -- `accesorios_ventas`: puesto a mano se desincroniza y el corte del mes
  -- empieza a contar reparaciones en el mes de al lado sin avisar.
  dia         date,
  ticket      text        NOT NULL,
  importe     numeric(12,2) NOT NULL CHECK (importe >= 0),
  capturado_por text,                  -- empno de quien la registro
  captura_id  text,                    -- id de la app; liga la foto del ticket
  ocr_texto   text,                    -- lo que leyo, para poder revisar
  creado_en   timestamptz NOT NULL DEFAULT now(),
  -- Un ticket de reparacion es UNO. A diferencia del accesorio, donde el UNIQUE
  -- lleva el producto porque un ticket trae varios articulos, aqui el ticket
  -- solo. El riesgo real es el mismo: dos asesores capturando lo mismo al
  -- cerrar el dia.
  UNIQUE (store_id, ticket)
);

ALTER TABLE public.reparaciones ENABLE ROW LEVEL SECURITY;
-- Sin politicas: no se llega por REST. Solo la tocan las funciones DEFINER.

CREATE INDEX IF NOT EXISTS reparaciones_dia
  ON public.reparaciones (store_id, dia DESC);

CREATE OR REPLACE FUNCTION public.reparaciones_dia_()
RETURNS trigger LANGUAGE plpgsql AS $trg$
BEGIN
  NEW.dia := (NEW.recibida_en AT TIME ZONE 'America/Mexico_City')::date;
  RETURN NEW;
END $trg$;

DROP TRIGGER IF EXISTS reparaciones_dia_trg ON public.reparaciones;
CREATE TRIGGER reparaciones_dia_trg
  BEFORE INSERT OR UPDATE OF recibida_en ON public.reparaciones
  FOR EACH ROW EXECUTE FUNCTION public.reparaciones_dia_();

COMMENT ON TABLE public.reparaciones IS
  'Tickets de reparacion de Mr Fix. NO van en `accesorios_ventas`: de ahi sale '
  'el Excel regional de comisiones y una reparacion se colaria como venta. No '
  'llevan vendedor ni comision: la reparacion es del tecnico.';


-- ── 2 · Guardar una, desde Captura ──────────────────────────
CREATE OR REPLACE FUNCTION public.reparacion_guardar(
  p_store      text,
  p_token      text,
  p_ticket     text,
  p_importe    numeric,
  p_fecha      date    DEFAULT NULL,   -- del ticket; si no viene, hoy
  p_hora       text    DEFAULT NULL,   -- '7:33 PM'
  p_quien      text    DEFAULT NULL,
  p_captura_id text    DEFAULT NULL,
  p_ocr        text    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_cuando timestamptz;
  v_h int := 12; v_m int := 0;
  mm text[];
  nuevo bigint;
BEGIN
  IF NOT public.escritura_ok_(p_store, p_token) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_autorizado');
  END IF;
  IF coalesce(trim(p_ticket),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'falta el numero de ticket');
  END IF;
  IF coalesce(p_importe, -1) < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'falta el importe');
  END IF;

  -- La hora es cosmetica (para ordenar el dia); si no se entiende, mediodia.
  -- Igual que en `accesorio_guardar`, y por el mismo motivo: el ticket la trae
  -- en formato de 12 horas y leerla mal no puede costar la captura.
  mm := regexp_match(coalesce(p_hora,''), '^\s*(\d{1,2}):(\d{2})\s*([APap])');
  IF mm IS NOT NULL THEN
    v_h := mm[1]::int; v_m := mm[2]::int;
    IF upper(mm[3]) = 'P' AND v_h < 12 THEN v_h := v_h + 12; END IF;
    IF upper(mm[3]) = 'A' AND v_h = 12 THEN v_h := 0; END IF;
  END IF;
  v_cuando := (make_timestamp(
                 extract(year  from coalesce(p_fecha, (now() AT TIME ZONE 'America/Mexico_City')::date))::int,
                 extract(month from coalesce(p_fecha, (now() AT TIME ZONE 'America/Mexico_City')::date))::int,
                 extract(day   from coalesce(p_fecha, (now() AT TIME ZONE 'America/Mexico_City')::date))::int,
                 v_h, v_m, 0) AT TIME ZONE 'America/Mexico_City');

  INSERT INTO public.reparaciones
    (store_id, recibida_en, ticket, importe, capturado_por, captura_id, ocr_texto)
  VALUES
    (p_store, v_cuando, trim(p_ticket), round(p_importe, 2),
     nullif(trim(coalesce(p_quien,'')), ''),
     nullif(trim(coalesce(p_captura_id,'')), ''),
     nullif(trim(coalesce(p_ocr,'')), ''))
  ON CONFLICT (store_id, ticket) DO NOTHING
  RETURNING id INTO nuevo;

  IF nuevo IS NULL THEN
    -- Ya estaba. No es un error que haya que arreglar: es el segundo asesor
    -- capturando el mismo ticket. Se dice cual, para que no lo busque.
    RETURN jsonb_build_object('ok', false, 'error',
                              'el ticket ' || trim(p_ticket) || ' ya estaba capturado');
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', nuevo);
END $fn$;


-- ── 3 · Las del mes, para el tecnico ────────────────────────
-- VOLATILE (por omision) y NO STABLE: `tecnico_ok_` sella `ultimo_acceso` con
-- un UPDATE, y PostgREST corre las funciones STABLE en transaccion de solo
-- lectura. Marcarla STABLE la revienta con 405 SOLO cuando la clave es buena
-- —con una mala se sale antes del UPDATE—, que es como se perdio una tarde el
-- 24-ago. Lo vigila `r_sql_volatilidad` en verificar.py.
CREATE OR REPLACE FUNCTION public.reparaciones_tecnico_lista(
  p_store text, p_clave text,
  p_anio integer DEFAULT NULL, p_mes integer DEFAULT NULL
) RETURNS TABLE (dia date, ticket text, importe numeric,
                 captura_id text, tiene_foto boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF NOT public.tecnico_ok_(p_store, p_clave) THEN
    RETURN;   -- clave mala: cero filas, sin decir por que
  END IF;
  RETURN QUERY
    SELECT r.dia, r.ticket, r.importe, r.captura_id,
           EXISTS (SELECT 1 FROM public.venta_fotos f
                    WHERE f.store_id = r.store_id AND f.captura_id = r.captura_id)
    FROM public.reparaciones r
    WHERE r.store_id = p_store
      AND extract(year  from r.dia)::int =
          coalesce(p_anio, extract(year  from (now() AT TIME ZONE 'America/Mexico_City'))::int)
      AND extract(month from r.dia)::int =
          coalesce(p_mes,  extract(month from (now() AT TIME ZONE 'America/Mexico_City'))::int)
    ORDER BY r.dia, r.recibida_en;
END $fn$;


-- ── 4 · La foto, ahora tambien de una reparacion ────────────
--
-- Se AMPLIA `accesorios_tecnico_foto` en vez de escribir una gemela: el candado
-- que importa es el mismo —solo fotos de accesorios O reparaciones, nunca de
-- una venta con numero de serie, que no tienen nada que ver con su trabajo— y
-- dos copias de ese candado acabarian diciendo cosas distintas. La que se
-- quedara corta seria la nueva, y nadie mira dos veces una funcion que ya
-- existia.
--
-- La foto dura 90 dias (24-ago-2026; eran 7). `venta_foto_guardar` limpia las
-- mas viejas en cada guardado, y 90 cubre el mes entero mas el tiempo de
-- cotejarlo, que es para lo que sirve este ticket.
CREATE OR REPLACE FUNCTION public.accesorios_tecnico_foto(
  p_store text, p_clave text, p_captura_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE r record;
BEGIN
  IF NOT public.tecnico_ok_(p_store, p_clave) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_autorizado');
  END IF;

  /* ⚠️ El alias es `rp`, NO `r`. Esta funcion declara `r record`, y plpgsql
     resuelve los nombres contra sus variables ANTES que contra las tablas: con
     `FROM public.reparaciones r`, el `r.store_id` del WHERE se lee como un
     campo de la variable —que aun no tiene valor— y la funcion entera revienta
     con 55000 «record "r" is not assigned yet».

     No falla solo la parte nueva: tumba TAMBIEN las fotos de accesorios, que
     llevaban semanas funcionando. Un alias de dos letras que se cruza con una
     variable, en un archivo distinto del que declara la variable. */
  IF NOT EXISTS (SELECT 1 FROM public.accesorios_ventas a
                  WHERE a.store_id = p_store AND a.captura_id = p_captura_id)
     AND NOT EXISTS (SELECT 1 FROM public.reparaciones rp
                      WHERE rp.store_id = p_store AND rp.captura_id = p_captura_id) THEN
    RETURN jsonb_build_object('ok', false, 'error',
                              'esa foto no es de un accesorio ni de una reparacion');
  END IF;

  SELECT encode(f.imagen, 'base64') AS b64, f.mime INTO r
    FROM public.venta_fotos f
   WHERE f.store_id = p_store AND f.captura_id = p_captura_id;

  /* NOT FOUND y no `r IS NULL`: si el SELECT no trajo fila, `r` se queda sin
     asignar y preguntarle IS NULL lanza el mismo 55000 de arriba. Estaba asi
     desde el 20-ago y no se habia visto porque la app solo enseña el boton del
     ticket cuando `tiene_foto` es cierto — o sea que el unico camino que lo
     alcanza es la venta cuya foto acaba de caducar a los 7 dias. */
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sin foto');
  END IF;
  RETURN jsonb_build_object('ok', true, 'imagen', r.b64, 'mime', r.mime);
END $fn$;


-- ── 5 · Permisos ────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.reparacion_guardar(text,text,text,numeric,date,text,text,text,text) FROM public;
REVOKE ALL ON FUNCTION public.reparaciones_tecnico_lista(text,text,integer,integer)               FROM public;
GRANT EXECUTE ON FUNCTION public.reparacion_guardar(text,text,text,numeric,date,text,text,text,text) TO anon, authenticated;
-- Solo `anon`: la pantalla del tecnico entra con la clave publicable, sin sesion.
GRANT EXECUTE ON FUNCTION public.reparaciones_tecnico_lista(text,text,integer,integer)              TO anon;
