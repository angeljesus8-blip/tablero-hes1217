-- ============================================================
--  CONCURSO DE TICKETS ORO Y PLATA
--  15-sep-2026 · del 15-sep al 15-oct-2026
-- ============================================================
--
--  El asesor sube la foto del ticket COMPLETO, la app la lee y la califica, y
--  el marcador le suma su oro o su plata.
--
--  Se registra el ticket de TODO el equipo, pero el marcador ensena solo a los
--  asesores dados de alta en `concurso_participantes` — en este periodo, dos.
--  El filtro esta en el marcador, no en la puerta de entrada: ver la seccion 8.
--
--  ------------------------------------------------------------
--  NO TOCA NI UNA TABLA DE LAS QUE YA HABIA
--  ------------------------------------------------------------
--  Ni `ventas`, ni `accesorios_ventas`, ni `inventario`. Todo vive aqui.
--
--  Es la misma razon por la que `accesorios_ventas` nacio aparte el 18-ago:
--  `ventas_hoy` calcula el Assurant que se reporta con meta del 25 %, e
--  `inventario_vivo` descuenta stock por SKU. Un ticket del concurso que
--  entrara ahi moveria el KPI y descontaria piezas que ya se descontaron —sin
--  dar ningun error— y nadie lo ataria meses despues a un concurso terminado.
--
--  Lo que SI comparte es `venta_fotos`, que tiene PRIMARY KEY
--  (store_id, captura_id) y por tanto ya sirve para cualquier captura. La foto
--  del ticket se sube con `venta_foto_guardar`, igual que las de Mr Fix.
--
--  ------------------------------------------------------------
--  QUIEN CALIFICA ES LA APP, Y AQUI SE GUARDA LO QUE HIZO
--  ------------------------------------------------------------
--  La regla («core + 2 de 3») vive en UN solo sitio: `concurso_nivel.js`. Este
--  archivo no la reimplementa.
--
--  Escribirla tambien en PL/pgSQL seria tener dos reglas que hay que mantener
--  de acuerdo. El dia que se separen, el marcador diria una cosa y la pantalla
--  que valida diria otra, y nadie podria saber cual miente. El concurso se
--  discute en el piso y se acabo.
--
--  Lo que se guarda, entonces, es TODO lo necesario para volver a calificar:
--  cada linea con su papel y la version de la regla que se uso. La pantalla de
--  validacion recalcula con la regla de hoy y compara. Si no coinciden, lo
--  ensena — que es justo como se caza una app vieja en el celular de alguien.
--
--  ------------------------------------------------------------
--  EL VENDEDOR SALE DE «ATENDIDO POR» Y HAY QUE CASARLO
--  ------------------------------------------------------------
--  El ticket imprime `Atendido por :RAMIREZ SOTO, LUIS` — apellidos primero,
--  mayusculas y sin acentos. Ninguna de las dos listas del equipo esta asi.
--
--  Ese formato es EXACTAMENTE el de `empleados.nombre_reporte`, que existe
--  desde el 18-ago para el Excel regional. Por ahi se casan.
--
--  Y hay que casarlos de verdad, no guardar el texto y ya: el marcador agrupa
--  por vendedor, asi que un asesor escrito de dos formas aparece como dos
--  personas con la mitad de los tickets cada una. Ya paso —Maria llevaba meses
--  partida en dos, 19 ventas por un lado y 32 por otro— y no dio ningun error:
--  se vio al cuadrar el mes.
--
--  Y si NO casa, el ticket se rechaza diciendo a quien leyo. No es lo mismo que
--  hace `accesorios_reporte`, que los guarda y los marca en rojo, y la razon es
--  que aqui el nombre no es un dato de mas: es LO UNICO que ata el ticket a una
--  persona. Sin el, no hay a quien sumarselo.
--
--  Guardarlo «para arreglarlo luego» seria guardar un ticket que no le suma a
--  nadie, que aparece en el detalle, que cuadra con su foto, y que nadie puede
--  explicar. El asesor lo volveria a subir y seguiria sin pasar nada. Mejor
--  decirlo en el momento, con el ticket y el cliente todavia delante.
--
--  Se pega completo en el SQL Editor. Es idempotente.
-- ============================================================


-- ── 1 · El periodo del concurso ─────────────────────────────
--
-- En tabla y no escrito en la app: el siguiente concurso se abre cambiando dos
-- fechas, sin deploy y sin esperar a nadie.
CREATE TABLE IF NOT EXISTS public.concurso_periodo (
  id        bigserial PRIMARY KEY,
  store_id  text NOT NULL REFERENCES public.tiendas(store_id) ON DELETE CASCADE,
  nombre    text NOT NULL,
  desde     date NOT NULL,
  hasta     date NOT NULL,
  activo    boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  CHECK (hasta >= desde)
);

ALTER TABLE public.concurso_periodo ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS concurso_periodo_uno_activo
  ON public.concurso_periodo (store_id) WHERE activo;

COMMENT ON TABLE public.concurso_periodo IS
  'El concurso vigente. El indice unico parcial deja UN solo activo por tienda: '
  'con dos, un ticket podria contar para los dos y el marcador no cuadraria con '
  'ninguno.';

INSERT INTO public.concurso_periodo (store_id, nombre, desde, hasta, activo)
SELECT '1217', 'Tickets Oro y Plata', DATE '2026-09-15', DATE '2026-10-15', true
 WHERE NOT EXISTS (SELECT 1 FROM public.concurso_periodo WHERE store_id = '1217');


-- ── 1-bis · Quien sale en el marcador ───────────────────────
--
-- No concursa toda la tienda: en este periodo van dos asesores (decidido el
-- 15-sep-2026). Pero el ticket se GUARDA de todos y lo que esta lista filtra
-- es a quien se ENSENA en el marcador.
--
-- La diferencia importa el dia que entre un tercero: sus tickets ya estan
-- registrados y aparece con su marcador real desde el primer dia. Si se
-- hubieran rechazado, empezaria en cero y esas ventas no habria como
-- recuperarlas.
--
-- Va en tabla y por periodo, no en una lista dentro de la app: quien participa
-- cambia en cada concurso, y un `if` con dos numeros de empleado dentro del
-- codigo obliga a un deploy para algo que es de configuracion.
--
-- Los numeros NO se escriben aqui: este repo es publico. Se dan de alta desde
-- Admin, o con un INSERT en `_privado/`, igual que `mapeo_nombres.sql`.
CREATE TABLE IF NOT EXISTS public.concurso_participantes (
  periodo_id bigint NOT NULL REFERENCES public.concurso_periodo(id) ON DELETE CASCADE,
  store_id   text   NOT NULL REFERENCES public.tiendas(store_id) ON DELETE CASCADE,
  empno      text   NOT NULL,
  alta_en    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (periodo_id, empno)
);

ALTER TABLE public.concurso_participantes ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.concurso_participantes IS
  'Quien SALE EN EL MARCADOR en cada periodo. No filtra lo que se guarda: el '
  'ticket de cualquiera del equipo se registra igual. Si esta vacia el '
  'marcador ensena a todos los que tengan tickets, para que olvidar el alta no '
  'deje una tabla en blanco mientras entran ventas.';

-- Alta y baja, desde Admin.
DROP FUNCTION IF EXISTS public.concurso_participante(text,text,text,boolean);
CREATE OR REPLACE FUNCTION public.concurso_participante(
  p_store text, p_token text, p_empno text, p_dentro boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_per bigint; v_nombre text;
BEGIN
  IF NOT public.escritura_ok_(p_store, p_token) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_autorizado');
  END IF;

  SELECT id INTO v_per FROM public.concurso_periodo
   WHERE store_id = p_store AND activo LIMIT 1;
  IF v_per IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no hay concurso activo');
  END IF;

  /* Tiene que existir como empleado. Un numero tecleado mal se daria de alta
     igual y anadiria al marcador una fila fantasma en cero que no es de nadie,
     mientras el asesor que se queria dar de alta sigue sin aparecer. Nada
     falla, y el gerente jura que lo dio de alta. */
  SELECT nombre INTO v_nombre FROM public.empleados
   WHERE store_id = p_store AND empno = trim(p_empno);
  IF v_nombre IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error',
      'no hay ningun empleado con el numero ' || trim(p_empno));
  END IF;

  IF p_dentro THEN
    INSERT INTO public.concurso_participantes (periodo_id, store_id, empno)
    VALUES (v_per, p_store, trim(p_empno))
    ON CONFLICT (periodo_id, empno) DO NOTHING;
  ELSE
    DELETE FROM public.concurso_participantes
     WHERE periodo_id = v_per AND empno = trim(p_empno);
  END IF;

  RETURN jsonb_build_object('ok', true, 'nombre', v_nombre, 'dentro', p_dentro);
END $fn$;


-- ── 2 · Los papeles de cada producto ────────────────────────
--
-- Solo lo que se quiera CORREGIR a mano. Lo que no este aqui lo resuelve
-- `concurso_roles.js`: todo el SKU 43739 es TechSmart, y el resto por nombre.
--
-- `roles` es un array porque un producto puede jugar dos papeles: una band es
-- core si es lo principal del ticket y accesorio Huawei si ya hay un MatePad.
-- Una sola columna `rol` obligaria a elegir, y elegir mal baja tickets de nivel
-- sin dar error.
CREATE TABLE IF NOT EXISTS public.concurso_roles (
  store_id  text   NOT NULL REFERENCES public.tiendas(store_id) ON DELETE CASCADE,
  sku       text   NOT NULL,
  nombre    text,
  roles     text[] NOT NULL DEFAULT '{}',
  clase     text,
  nota      text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, sku),
  CHECK (roles <@ ARRAY['core','acc_hw','ts_serv']::text[])
);

ALTER TABLE public.concurso_roles ENABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN public.concurso_roles.roles IS
  'core | acc_hw | ts_serv. Varios a la vez si el producto puede jugar varios '
  'papeles. Vacio = no cuenta para ninguna casilla.';


-- ── 3 · Los tickets registrados ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.concurso_tickets (
  id          bigserial PRIMARY KEY,
  store_id    text NOT NULL REFERENCES public.tiendas(store_id) ON DELETE CASCADE,
  periodo_id  bigint REFERENCES public.concurso_periodo(id) ON DELETE SET NULL,
  ticket      text NOT NULL,
  vendido_en  timestamptz NOT NULL DEFAULT now(),
  dia         date,                       -- se deriva con trigger
  -- El texto tal como lo imprimio el ticket, SIEMPRE. Es la prueba de lo que
  -- decia el papel, y no se pisa aunque se case con un empleado.
  atendido_por text NOT NULL,
  -- El empleado con el que caso, si caso. El marcador agrupa por AQUI.
  empno       text,
  vendedor    text NOT NULL,              -- el nombre bueno, o el del ticket
  nivel       text NOT NULL CHECK (nivel IN ('oro','plata','ninguno')),
  porque      text,
  total       numeric(12,2),
  captura_id  text,                       -- liga la foto en `venta_fotos`
  ocr_texto   text,
  capturado_por text,                     -- empno de quien lo subio
  regla       text,                       -- version de la regla que califico
  avisos      text[],                     -- lo que la lectura no pudo cerrar
  creado_en   timestamptz NOT NULL DEFAULT now(),
  -- UN TICKET SE REGISTRA UNA VEZ. Es el riesgo real del concurso: el mismo
  -- papel subido dos veces, o subido por dos asesores al cerrar el dia. Sin
  -- esto, un ticket oro se convierte en dos con solo volver a fotografiarlo.
  UNIQUE (store_id, ticket)
);

ALTER TABLE public.concurso_tickets ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS concurso_tickets_dia
  ON public.concurso_tickets (store_id, dia DESC);
CREATE INDEX IF NOT EXISTS concurso_tickets_vend
  ON public.concurso_tickets (store_id, empno, dia);

CREATE OR REPLACE FUNCTION public.concurso_dia_()
RETURNS trigger LANGUAGE plpgsql AS $trg$
BEGIN
  NEW.dia := (NEW.vendido_en AT TIME ZONE 'America/Mexico_City')::date;
  RETURN NEW;
END $trg$;

DROP TRIGGER IF EXISTS concurso_dia_trg ON public.concurso_tickets;
CREATE TRIGGER concurso_dia_trg
  BEFORE INSERT OR UPDATE OF vendido_en ON public.concurso_tickets
  FOR EACH ROW EXECUTE FUNCTION public.concurso_dia_();


-- ── 4 · Las lineas de cada ticket ───────────────────────────
--
-- Se guardan TODAS, tambien las que no cuentan para nada. La pantalla existe
-- para validar si el ticket calificaba: con solo las lineas que sumaron, no se
-- puede comprobar nada — habria que creerselo.
CREATE TABLE IF NOT EXISTS public.concurso_lineas (
  id         bigserial PRIMARY KEY,
  ticket_id  bigint NOT NULL REFERENCES public.concurso_tickets(id) ON DELETE CASCADE,
  orden      integer NOT NULL,
  sku        text,
  nombre     text,
  cantidad   integer NOT NULL DEFAULT 1,
  precio     numeric(12,2),
  importe    numeric(12,2),
  descuento  numeric(12,2) NOT NULL DEFAULT 0,
  serie      text,
  es_garantia boolean NOT NULL DEFAULT false,
  clase      text,                       -- core | acc_hw | techsmart | servicio | sin_rol
  roles      text[] NOT NULL DEFAULT '{}',
  rol        text                        -- el papel que acabo jugando, o NULL
);

ALTER TABLE public.concurso_lineas ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS concurso_lineas_ticket
  ON public.concurso_lineas (ticket_id, orden);

COMMENT ON COLUMN public.concurso_lineas.rol IS
  'El papel que el reparto le dio: core, acc_hw, ts_serv, garantia. NULL si no '
  'llego a usarse — un ticket con tres micas solo gasta una.';


-- ── 5 · Casar «Atendido por» con el equipo ──────────────────
--
-- `RAMIREZ SOTO, LUIS` contra `empleados.nombre_reporte`, que es el mismo
-- formato (APELLIDOS NOMBRE, mayusculas, sin acentos).
--
-- Se quitan comas, acentos y espacios de mas por los dos lados: el OCR mete
-- espacios donde quiere y el ticket imprime `LOPEZ , CARLOS` tal cual.
CREATE OR REPLACE FUNCTION public.concurso_clave_nombre_(t text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(
           upper(public.unaccent_(regexp_replace(coalesce(t,''), '[,.]', ' ', 'g'))),
           '\s+', ' ', 'g')
$$;

COMMENT ON FUNCTION public.concurso_clave_nombre_(text) IS
  'Aplana un nombre para compararlo. NO arregla una letra de mas: eso no lo '
  'arregla ningun unaccent y por eso existe `nombre_reporte` mapeado a mano.';


-- ── 5b · Y cuando el exacto no puede acertar ────────────────
--
-- 19-sep-2026. Un asesor subio su ticket y el servidor contesto «no reconozco
-- a X en el equipo» dos veces seguidas, con dos grafias distintas de la misma
-- persona. No era el OCR: el papel imprime UN apellido y una inicial
-- (`APELLIDO, NOMBRE A`) y `nombre_reporte` lleva los DOS apellidos, porque su
-- trabajo es casar letra por letra con el Excel regional de comisiones. Dos
-- formatos distintos para el mismo nombre; la igualdad no puede salvarlos.
--
-- Medido sobre el mapeo real de la 1217 (5 personas) antes de escribir esto:
-- el exacto falla con las tres lecturas del dia, y comparando POR PALABRAS
-- acierta en las tres y en las cinco personas, sin un solo empate.
--
-- Es el mismo criterio que `accCasarVendedor` en captura_series.html, y eso
-- era justo el problema: la app tenia dos maneras de casar un nombre y el
-- concurso usaba la fragil. Aqui se escribe igual a proposito — minimo DOS
-- palabras de tres letras o mas, y con empate NO se elige.
--
-- Las dos condiciones son la misma: no equivocarse de persona. Un apellido
-- suelto lo comparten dos del equipo (medido: pasa en la 1217), y las
-- particulas y las iniciales que inventa el OCR casan con cualquiera. Poner el
-- ticket a nombre de otro no da error en ningun sitio: se veria, si acaso, al
-- repartir el premio. Si no se puede saber, se dice y el asesor lo elige.
CREATE OR REPLACE FUNCTION public.concurso_casar_empleado_(p_store text, p_leido text)
RETURNS TABLE (empno text, nombre text)
LANGUAGE plpgsql STABLE SET search_path = public AS $fn$
DECLARE
  v_pal text[];
BEGIN
  -- 1) El exacto manda cuando acierta: es el que no se puede equivocar.
  RETURN QUERY
    SELECT e.empno::text, e.nombre::text
      FROM public.empleados e
     WHERE e.store_id = p_store
       AND public.concurso_clave_nombre_(e.nombre_reporte)
           = public.concurso_clave_nombre_(p_leido)
     LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  -- 2) Y si no, por palabras. Las de menos de tres letras se tiran: son las
  --    iniciales del ticket y las particulas («de», «la»), que casan con todos.
  SELECT array_agg(DISTINCT p) INTO v_pal
    FROM unnest(string_to_array(public.concurso_clave_nombre_(p_leido), ' ')) AS p
   WHERE length(p) >= 3;
  IF v_pal IS NULL OR array_length(v_pal, 1) < 2 THEN RETURN; END IF;

  RETURN QUERY
  WITH puntos AS (
    /* Se mira contra `nombre_reporte` Y contra `nombre`, porque no todo el
       mundo tiene mapeado el primero: quien entro despues del ultimo mapeo
       casa igual por el segundo, en vez de quedarse fuera del concurso sin
       que nadie se entere. */
    SELECT e.empno::text AS empno, e.nombre::text AS nombre,
           (SELECT count(*) FROM unnest(v_pal) AS w
             WHERE w = ANY (string_to_array(public.concurso_clave_nombre_(
                      coalesce(e.nombre_reporte, '') || ' ' ||
                      coalesce(e.nombre, '')), ' '))) AS n
      FROM public.empleados e
     WHERE e.store_id = p_store
  )
  SELECT p.empno, p.nombre
    FROM puntos p
   WHERE p.n >= 2
     AND p.n = (SELECT max(q.n) FROM puntos q)
     AND (SELECT count(*) FROM puntos q WHERE q.n = p.n) = 1;
END $fn$;

COMMENT ON FUNCTION public.concurso_casar_empleado_(text,text) IS
  'Quien atendio, del nombre impreso en el ticket. Exacto primero y por '
  'palabras despues (minimo 2 de 3+ letras, sin empate). Devuelve 0 o 1 fila: '
  'si no se puede saber de quien es, no se adivina.';


-- ── 6 · Guardar el ticket con sus lineas ────────────────────
--
-- Las lineas llegan en un jsonb y se insertan en la MISMA transaccion que el
-- ticket. Partirlo en dos llamadas dejaria tickets sin lineas el dia que se
-- caiga la senal a la mitad: calificados, contando para el marcador, y sin
-- nada que ensenar en la pantalla que sirve para validarlos.
DROP FUNCTION IF EXISTS public.concurso_guardar(text,text,text,text,date,text,text,text,numeric,jsonb,text,text,text,text,text[]);
CREATE OR REPLACE FUNCTION public.concurso_guardar(
  p_store      text,
  p_token      text,
  p_ticket     text,
  p_atendido   text,
  p_fecha      date    DEFAULT NULL,
  p_hora       text    DEFAULT NULL,
  p_nivel      text    DEFAULT 'ninguno',
  p_porque     text    DEFAULT NULL,
  p_total      numeric DEFAULT NULL,
  p_lineas     jsonb   DEFAULT '[]'::jsonb,
  p_captura_id text    DEFAULT NULL,
  p_quien      text    DEFAULT NULL,
  p_ocr        text    DEFAULT NULL,
  p_regla      text    DEFAULT NULL,
  p_avisos     text[]  DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_cuando timestamptz;
  v_h int := 12; v_m int := 0;
  mm text[];
  v_id bigint;
  v_periodo bigint;
  v_empno text; v_nombre text;
  v_dia date;
  v_en_marcador boolean;
BEGIN
  IF NOT public.escritura_ok_(p_store, p_token) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_autorizado');
  END IF;
  IF coalesce(trim(p_ticket),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'falta el numero de ticket');
  END IF;
  IF coalesce(trim(p_atendido),'') = '' THEN
    -- Sin vendedor el ticket no le suma a nadie, y un marcador con tickets que
    -- no son de nadie no lo cuadra ya nunca.
    RETURN jsonb_build_object('ok', false, 'error', 'falta quien lo vendio');
  END IF;
  IF p_nivel NOT IN ('oro','plata','ninguno') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'nivel desconocido: ' || p_nivel);
  END IF;
  IF jsonb_typeof(coalesce(p_lineas,'[]'::jsonb)) <> 'array'
     OR jsonb_array_length(coalesce(p_lineas,'[]'::jsonb)) = 0 THEN
    -- Un ticket sin lineas no se puede validar, que es para lo que se sube.
    RETURN jsonb_build_object('ok', false, 'error', 'el ticket llego sin lineas');
  END IF;

  -- La hora es cosmetica (ordena la lista); si no se entiende, mediodia.
  mm := regexp_match(coalesce(p_hora,''), '^\s*(\d{1,2}):(\d{2})\s*([APap])');
  IF mm IS NOT NULL THEN
    v_h := mm[1]::int; v_m := mm[2]::int;
    IF upper(mm[3]) = 'P' AND v_h < 12 THEN v_h := v_h + 12; END IF;
    IF upper(mm[3]) = 'A' AND v_h = 12 THEN v_h := 0; END IF;
  END IF;
  v_dia := coalesce(p_fecha, (now() AT TIME ZONE 'America/Mexico_City')::date);
  v_cuando := (make_timestamp(extract(year from v_dia)::int,
                              extract(month from v_dia)::int,
                              extract(day from v_dia)::int,
                              v_h, v_m, 0) AT TIME ZONE 'America/Mexico_City');

  /* El periodo se resuelve POR LA FECHA DEL TICKET, no por la de hoy. Un
     ticket del viernes capturado el lunes pertenece al viernes; atarlo a «el
     activo de ahora» lo metería en el concurso siguiente el dia que uno
     termine, sin avisar. */
  SELECT id INTO v_periodo FROM public.concurso_periodo
   WHERE store_id = p_store AND v_dia BETWEEN desde AND hasta
   ORDER BY activo DESC, desde DESC LIMIT 1;

  -- Casar con el equipo. Ver la cabecera: sin esto el marcador parte a un
  -- asesor en dos personas.
  SELECT c.empno, c.nombre INTO v_empno, v_nombre
    FROM public.concurso_casar_empleado_(p_store, p_atendido) c;

  /* Fuera de fechas no se guarda, y se dice la fecha que se leyo.

     Un ticket del 10-sep guardado en silencio se queda ahi para siempre: no
     cuenta, no da error, y el asesor que lo subio cree que si. Y la fecha la
     puede haber leido mal el OCR, asi que hay que ENSENARLA — con «fuera del
     concurso» a secas, quien tiene el papel del dia 20 en la mano no sabe si el
     equivocado es el o la maquina. */
  IF v_periodo IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'fuera_de_fechas', true,
      'error', 'ese ticket es del ' || to_char(v_dia, 'DD/MM/YYYY') ||
               ', fuera de las fechas del concurso');
  END IF;

  IF v_empno IS NULL THEN
    /* No se pudo saber de quien es, asi que tampoco si concursa. Se dice a
       quien leyo para que se vea si fallo el OCR o es de otra persona. */
    RETURN jsonb_build_object('ok', false, 'sin_empleado', true,
      'error', 'no reconozco a «' || trim(p_atendido) ||
               '» en el equipo: elige el asesor a mano');
  END IF;

  /* ── Se guarda de TODOS, aunque no salgan en el marcador ──
     Cambiado el 15-sep-2026: antes se rechazaba el ticket de quien no
     concursaba. Ahora registra el equipo entero y el marcador ensena solo a
     los que estan dados de alta.

     Es mejor asi por una razon que no se ve hasta que pasa: si manana entra un
     tercero al concurso, sus tickets YA ESTAN y aparece con su marcador real
     desde el primer dia. Con el rechazo habria empezado en cero y las ventas
     de esas semanas no habria forma de recuperarlas — la foto del ticket ya no
     la tiene nadie.

     Lo que si se devuelve es `en_marcador`, para que la pantalla pueda decir
     «guardado, pero este periodo el marcador es solo de Fulano y Mengano».
     Sin eso, quien sube su ticket y no se ve aparecer en ningun sitio supone
     que se perdio. */
  v_en_marcador := EXISTS (SELECT 1 FROM public.concurso_participantes
                            WHERE periodo_id = v_periodo AND empno = v_empno)
                OR NOT EXISTS (SELECT 1 FROM public.concurso_participantes
                                WHERE periodo_id = v_periodo);

  INSERT INTO public.concurso_tickets
    (store_id, periodo_id, ticket, vendido_en, atendido_por, empno, vendedor,
     nivel, porque, total, captura_id, ocr_texto, capturado_por, regla, avisos)
  VALUES (p_store, v_periodo, trim(p_ticket), v_cuando, trim(p_atendido),
          v_empno, v_nombre,
          p_nivel, p_porque, p_total,
          nullif(trim(coalesce(p_captura_id,'')),''),
          left(coalesce(p_ocr,''), 8000),
          nullif(trim(coalesce(p_quien,'')),''), p_regla, p_avisos)
  ON CONFLICT (store_id, ticket) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    /* Ya estaba. Se dice quien lo subio y con que nivel: «ya existe» a secas
       hace que el asesor crea que se le perdio, y lo intente por otra via. */
    RETURN (SELECT jsonb_build_object('ok', true, 'duplicado', true,
              'error', 'el ticket ' || trim(p_ticket) || ' ya lo registro ' ||
                       t.vendedor || ' como ' || upper(t.nivel))
              FROM public.concurso_tickets t
             WHERE t.store_id = p_store AND t.ticket = trim(p_ticket));
  END IF;

  INSERT INTO public.concurso_lineas
    (ticket_id, orden, sku, nombre, cantidad, precio, importe, descuento,
     serie, es_garantia, clase, roles, rol)
  SELECT v_id,
         coalesce((l->>'orden')::int, ord),
         l->>'sku', l->>'nombre',
         coalesce((l->>'cantidad')::int, 1),
         (l->>'precio')::numeric, (l->>'importe')::numeric,
         coalesce((l->>'descuento')::numeric, 0),
         l->>'serie',
         coalesce((l->>'es_garantia')::boolean, false),
         l->>'clase',
         coalesce(ARRAY(SELECT jsonb_array_elements_text(l->'roles')), '{}'::text[]),
         l->>'rol'
    FROM jsonb_array_elements(p_lineas) WITH ORDINALITY AS t(l, ord);

  -- Aqui `v_empno` y `v_nombre` no pueden ser NULL: sin ellos se devolvio antes.
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'nivel', p_nivel,
                            'empno', v_empno, 'vendedor', v_nombre,
                            'periodo', v_periodo,
                            'en_marcador', v_en_marcador);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLSTATE || ': ' || left(SQLERRM, 140));
END $fn$;


-- ── 7 · Borrar un ticket mal capturado ──────────────────────
--
-- Corregir un ticket es borrarlo y volver a subirlo: las lineas se van con el
-- (ON DELETE CASCADE) y el UNIQUE deja capturarlo otra vez. Editar a medias
-- dejaria lineas viejas de un ticket nuevo, y eso no se ve en la pantalla.
DROP FUNCTION IF EXISTS public.concurso_borrar(text,text,bigint);
CREATE OR REPLACE FUNCTION public.concurso_borrar(
  p_store text, p_token text, p_id bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE n int;
BEGIN
  IF NOT public.escritura_ok_(p_store, p_token) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_autorizado');
  END IF;
  DELETE FROM public.concurso_tickets
   WHERE store_id = p_store AND id = p_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ese ticket ya no esta');
  END IF;
  RETURN jsonb_build_object('ok', true);
END $fn$;


-- ── 8 · El marcador ─────────────────────────────────────────
--
-- SALEN LOS PARTICIPANTES, no los que ya registraron algo. Y por eso es un
-- JOIN desde `concurso_participantes` y no un GROUP BY de los tickets.
--
-- Un marcador construido desde los tickets no puede ensenar un cero: quien
-- lleva ninguno simplemente no aparece, y su fila vacia es justo la que hace
-- falta ver. Es la diferencia entre «voy ganando» y «voy 3 a 0».
--
-- Y aqui es donde se filtra el concurso, no al guardar: se registra el ticket
-- de todo el equipo y el marcador ensena solo a los dados de alta. Lo que
-- decide quien sale es esta tabla, en una sola consulta y en un solo sitio.
--
-- LA RED: si NO hay nadie dado de alta, salen todos los que tengan tickets.
-- Sin eso, olvidarse del alta deja un marcador VACIO mientras los tickets
-- entran sin dar un solo error — y un marcador en blanco se lee como «nadie ha
-- vendido nada», que es justo lo contrario de lo que esta pasando.
--
-- Los `ninguno` tambien se cuentan, por lo mismo: sin ellos no se puede decir
-- «llevas 12 tickets y 3 son oro», que es lo que ensena donde se esta fallando.
DROP FUNCTION IF EXISTS public.concurso_marcador(text,date,date);
CREATE FUNCTION public.concurso_marcador(
  p_store text, p_desde date DEFAULT NULL, p_hasta date DEFAULT NULL
) RETURNS TABLE (
  empno text, vendedor text, oro bigint, plata bigint,
  ninguno bigint, tickets bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH per AS (
    SELECT p.id,
           coalesce(p_desde, p.desde,
                    date_trunc('month', now() AT TIME ZONE 'America/Mexico_City')::date) AS d,
           coalesce(p_hasta, p.hasta,
                    (now() AT TIME ZONE 'America/Mexico_City')::date) AS h
      FROM public.concurso_periodo p
     WHERE p.store_id = p_store AND p.activo
     LIMIT 1
  ),
  quien AS (
    SELECT pa.empno
      FROM per JOIN public.concurso_participantes pa ON pa.periodo_id = per.id
    UNION
    -- La red de arriba: solo aporta filas cuando la lista de alta esta vacia.
    SELECT t.empno
      FROM per JOIN public.concurso_tickets t
             ON t.store_id = p_store AND t.dia BETWEEN per.d AND per.h
     WHERE t.empno IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.concurso_participantes pa2
                        WHERE pa2.periodo_id = per.id)
  )
  SELECT q.empno,
         coalesce(e.nombre, q.empno),
         count(t.id) FILTER (WHERE t.nivel = 'oro'),
         count(t.id) FILTER (WHERE t.nivel = 'plata'),
         count(t.id) FILTER (WHERE t.nivel = 'ninguno'),
         count(t.id)
    FROM quien q
    CROSS JOIN per
    LEFT JOIN public.empleados e
           ON e.store_id = p_store AND e.empno = q.empno
    LEFT JOIN public.concurso_tickets t
           ON t.store_id = p_store AND t.empno = q.empno
          AND t.dia BETWEEN per.d AND per.h
   GROUP BY q.empno, e.nombre
   -- Oro primero, luego plata. El desempate por nombre deja el orden estable:
   -- una lista que se reordena sola entre dos consultas parece que cambio.
   ORDER BY 3 DESC, 4 DESC, 2;
$$;


-- ── 9 · La lista para validar ───────────────────────────────
DROP FUNCTION IF EXISTS public.concurso_lista(text,date,date,text);
CREATE FUNCTION public.concurso_lista(
  p_store text, p_desde date DEFAULT NULL, p_hasta date DEFAULT NULL,
  p_empno text DEFAULT NULL
) RETURNS TABLE (
  id bigint, ticket text, dia date, vendido_en timestamptz,
  vendedor text, empno text, atendido_por text, nivel text, porque text,
  total numeric, captura_id text, tiene_foto boolean, avisos text[],
  sin_empleado boolean, articulos bigint, garantias bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH per AS (
    SELECT coalesce(p_desde, (SELECT desde FROM public.concurso_periodo
                               WHERE store_id = p_store AND activo LIMIT 1),
                    date_trunc('month', now() AT TIME ZONE 'America/Mexico_City')::date) AS d,
           coalesce(p_hasta, (SELECT hasta FROM public.concurso_periodo
                               WHERE store_id = p_store AND activo LIMIT 1),
                    (now() AT TIME ZONE 'America/Mexico_City')::date) AS h
  )
  SELECT t.id, t.ticket, t.dia, t.vendido_en, t.vendedor, t.empno,
         t.atendido_por, t.nivel, t.porque, t.total, t.captura_id,
         EXISTS (SELECT 1 FROM public.venta_fotos f
                  WHERE f.store_id = t.store_id AND f.captura_id = t.captura_id),
         t.avisos,
         (t.empno IS NULL),
         (SELECT count(*) FROM public.concurso_lineas l
           WHERE l.ticket_id = t.id AND NOT l.es_garantia),
         (SELECT count(*) FROM public.concurso_lineas l
           WHERE l.ticket_id = t.id AND l.es_garantia)
    FROM public.concurso_tickets t, per
   WHERE t.store_id = p_store AND t.dia BETWEEN per.d AND per.h
     AND (p_empno IS NULL OR t.empno = p_empno)
   ORDER BY t.vendido_en DESC;
$$;


-- ── 10 · El detalle de un ticket ────────────────────────────
--
-- Los articulos que se fueron en esa transaccion, que es lo que Angel pidio
-- para poder validar si de verdad calificaba.
DROP FUNCTION IF EXISTS public.concurso_detalle(text,bigint);
CREATE FUNCTION public.concurso_detalle(p_store text, p_id bigint)
RETURNS TABLE (
  orden integer, sku text, nombre text, cantidad integer,
  precio numeric, importe numeric, descuento numeric, serie text,
  es_garantia boolean, clase text, roles text[], rol text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT l.orden, l.sku, l.nombre, l.cantidad, l.precio, l.importe,
         l.descuento, l.serie, l.es_garantia, l.clase, l.roles, l.rol
    FROM public.concurso_lineas l
    JOIN public.concurso_tickets t ON t.id = l.ticket_id
   WHERE t.store_id = p_store AND t.id = p_id
   ORDER BY l.orden;
$$;


-- ── 11 · Lo que la app necesita al arrancar ─────────────────
DROP FUNCTION IF EXISTS public.concurso_config(text);
CREATE FUNCTION public.concurso_config(p_store text)
RETURNS TABLE (
  id bigint, nombre text, desde date, hasta date, vigente boolean,
  dias_restantes integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p.id, p.nombre, p.desde, p.hasta,
         ((now() AT TIME ZONE 'America/Mexico_City')::date BETWEEN p.desde AND p.hasta),
         (p.hasta - (now() AT TIME ZONE 'America/Mexico_City')::date)::int
    FROM public.concurso_periodo p
   WHERE p.store_id = p_store AND p.activo
   LIMIT 1;
$$;

-- Quien concursa, con su nombre. La app la necesita para decir «tú no estás en
-- este concurso» antes de que alguien fotografíe un ticket para nada.
DROP FUNCTION IF EXISTS public.concurso_participantes_lista(text);
CREATE FUNCTION public.concurso_participantes_lista(p_store text)
RETURNS TABLE (empno text, nombre text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT pa.empno, coalesce(e.nombre, pa.empno)
    FROM public.concurso_periodo p
    JOIN public.concurso_participantes pa ON pa.periodo_id = p.id
    LEFT JOIN public.empleados e ON e.store_id = p_store AND e.empno = pa.empno
   WHERE p.store_id = p_store AND p.activo
   ORDER BY 2;
$$;

DROP FUNCTION IF EXISTS public.concurso_roles_lista(text);
CREATE FUNCTION public.concurso_roles_lista(p_store text)
RETURNS TABLE (sku text, nombre text, roles text[], clase text, nota text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT r.sku, r.nombre, r.roles, r.clase, r.nota
    FROM public.concurso_roles r
   WHERE r.store_id = p_store
   ORDER BY r.sku;
$$;

-- Editar un papel a mano, desde Admin.
DROP FUNCTION IF EXISTS public.concurso_rol_guardar(text,text,text,text,text[],text,text);
CREATE OR REPLACE FUNCTION public.concurso_rol_guardar(
  p_store text, p_token text, p_sku text, p_nombre text,
  p_roles text[], p_clase text DEFAULT NULL, p_nota text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF NOT public.escritura_ok_(p_store, p_token) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_autorizado');
  END IF;
  IF coalesce(trim(p_sku),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'falta el SKU');
  END IF;
  IF NOT (coalesce(p_roles,'{}') <@ ARRAY['core','acc_hw','ts_serv']::text[]) THEN
    RETURN jsonb_build_object('ok', false, 'error',
      'papel desconocido: solo core, acc_hw o ts_serv');
  END IF;

  INSERT INTO public.concurso_roles (store_id, sku, nombre, roles, clase, nota)
  VALUES (p_store, regexp_replace(trim(p_sku), '^0+(?=[0-9])', ''),
          nullif(trim(coalesce(p_nombre,'')),''), coalesce(p_roles,'{}'),
          nullif(trim(coalesce(p_clase,'')),''), nullif(trim(coalesce(p_nota,'')),''))
  ON CONFLICT (store_id, sku) DO UPDATE
    SET nombre = excluded.nombre, roles = excluded.roles,
        clase = excluded.clase, nota = excluded.nota, updated_at = now();

  RETURN jsonb_build_object('ok', true);
END $fn$;


-- ── 12 · Permisos ───────────────────────────────────────────
--
-- RLS encendido y SIN politicas: a estas tablas no se llega por REST. Solo las
-- tocan las funciones de arriba, que son SECURITY DEFINER y comprueban el
-- token. Es como estan `reparaciones` y las demas.
REVOKE ALL ON FUNCTION public.concurso_guardar(text,text,text,text,date,text,text,text,numeric,jsonb,text,text,text,text,text[]) FROM public;
REVOKE ALL ON FUNCTION public.concurso_borrar(text,text,bigint)        FROM public;
REVOKE ALL ON FUNCTION public.concurso_marcador(text,date,date)        FROM public;
REVOKE ALL ON FUNCTION public.concurso_lista(text,date,date,text)      FROM public;
REVOKE ALL ON FUNCTION public.concurso_detalle(text,bigint)            FROM public;
REVOKE ALL ON FUNCTION public.concurso_config(text)                    FROM public;
REVOKE ALL ON FUNCTION public.concurso_roles_lista(text)               FROM public;
REVOKE ALL ON FUNCTION public.concurso_participantes_lista(text)       FROM public;
REVOKE ALL ON FUNCTION public.concurso_participante(text,text,text,boolean) FROM public;
REVOKE ALL ON FUNCTION public.concurso_rol_guardar(text,text,text,text,text[],text,text) FROM public;

GRANT EXECUTE ON FUNCTION public.concurso_guardar(text,text,text,text,date,text,text,text,numeric,jsonb,text,text,text,text,text[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.concurso_borrar(text,text,bigint)        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.concurso_marcador(text,date,date)        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.concurso_lista(text,date,date,text)      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.concurso_detalle(text,bigint)            TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.concurso_config(text)                    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.concurso_roles_lista(text)               TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.concurso_participantes_lista(text)       TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.concurso_participante(text,text,text,boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.concurso_rol_guardar(text,text,text,text,text[],text,text) TO anon, authenticated;

-- Los dos ayudantes con guion bajo NO se exponen. Nadie los llama desde fuera:
-- los usa `concurso_guardar`, que es SECURITY DEFINER y por eso los ve.
--
-- Sin esto heredan el EXECUTE de PUBLIC y contestan a cualquiera con la llave
-- publicable. Hoy no filtran nada —RLS esconde `empleados` del rol `anon`, asi
-- que `concurso_casar_empleado_` devuelve [] siempre—, y ese es justo el
-- problema: parece rota. El que la pruebe desde fuera la vera fallar hasta con
-- el nombre exacto, y el arreglo que se le ocurrira es ponerle SECURITY
-- DEFINER; entonces si, cualquiera con la llave publicable podria ir probando
-- nombres hasta sacar numeros de empleado del equipo. Se cierra la puerta
-- antes de que alguien la abra por el lado equivocado.
REVOKE ALL ON FUNCTION public.concurso_casar_empleado_(text,text) FROM public;
REVOKE ALL ON FUNCTION public.concurso_clave_nombre_(text)        FROM public;


-- ============================================================
--  COMPROBAR (pegar despues, con el token de la tienda)
-- ============================================================
--  Token:  select gas_token from public.tiendas where store_id='1217';
--
--  1 · El periodo esta abierto y quedan dias:
--      select * from public.concurso_config('1217');
--      -- vigente = true, dias_restantes = 30 el 15-sep
--
--  1-bis · DAR DE ALTA A LOS DOS QUE SALEN EN EL MARCADOR. Los tickets se
--      guardan de todo el equipo; esta lista decide a quien se ENSENA.
--      Los numeros salen de:
--        select empno, nombre from public.empleados where store_id='1217';
--
--      select public.concurso_participante('1217','<token>','<empno>', true);
--      select public.concurso_participante('1217','<token>','<empno>', true);
--
--      Y comprobar que son LOS DOS QUE DEBEN SER, por nombre:
--        select * from public.concurso_participantes_lista('1217');
--
--      Este paso no es de adorno. Un empno que no existe lo rechaza la
--      funcion, pero uno EQUIVOCADO —el de otro asesor— lo acepta encantada, y
--      lo que se veria es a alguien que no concursa sumando tickets. La lista
--      devuelve los nombres, que es lo unico reconocible de un vistazo.
--
--  2 · Guardar el ticket 34140 de prueba (ORO). OJO: la fecha del ticket es el
--      14-sep y el concurso empieza el 15, asi que ESTE ticket tiene que ser
--      rechazado con `fuera_de_fechas`. Es la comprobacion, no un estorbo: si
--      entra, la puerta de las fechas no esta cerrando.
--
--      Para probar que si guarda, repetir con la fecha de hoy y con un
--      `nombre_reporte` del equipo. Si sale `sin_empleado`, «Atendido por» no
--      empato con ningun `nombre_reporte` y lo que hay que arreglar es el
--      mapeo, no el ticket.
--
--  2-bis · Y con el `nombre_reporte` de alguien que NO esta dado de alta:
--      tiene que guardar igual, con `en_marcador` = false. Si lo rechaza,
--      quedo puesto el filtro en la puerta en vez de en el marcador.
--
--      select public.concurso_guardar('1217','<token>','34140',
--        'RAMIREZ SOTO, LUIS', DATE '2026-09-14', '6:03 PM', 'oro',
--        'los cuatro', 26302,
--        '[{"orden":1,"sku":"100250576","nombre":"MATEPAD PRO","importe":29990,
--           "descuento":14995,"clase":"core","roles":["core"],"rol":"core"}]'::jsonb);
--
--  3 · El mismo ticket otra vez NO entra dos veces:
--      -- repetir el paso 2 → duplicado = true, y dice quien lo registro
--
--  4 · El marcador lo cuenta, y salen SOLO los dos dados de alta — con su cero
--      si no llevan ninguno. El ticket del paso 2-bis no debe aparecer en
--      ninguna de las dos filas:
--      select * from public.concurso_marcador('1217');
--
--  4-bis · Pero en la lista para validar SI esta, porque ahi salen todos:
--      select ticket, vendedor, nivel from public.concurso_lista('1217');
--
--  5 · Y se puede ver el detalle:
--      select * from public.concurso_detalle('1217', <id>);
--
--  6 · Limpiar la prueba:
--      select public.concurso_borrar('1217','<token>', <id>);
--      -- las lineas se van solas (ON DELETE CASCADE)
-- ============================================================
