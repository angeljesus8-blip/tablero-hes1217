-- ============================================================
--  VENTAS A NOMBRE DE NADIE
--  21-sep-2026 · PENDIENTE DE APLICAR
-- ============================================================
--
--  Qué lo trae
--  -----------
--  Revisando de dónde salía una venta con un vendedor que no trabaja en la
--  tienda, se miraron 45 días de histórico y aparecieron TRES filas más cuyo
--  vendedor no corresponde a nadie del equipo: dos con una letra de más en el
--  apellido y una con sólo el nombre de pila.
--
--  `equipo_divergencias` (28-ago, ver _privado/unificar_vendedor.sql) ya avisa
--  de esto... pero mirando la CONFIG y la tabla de EMPLEADOS. Hoy devuelve
--  vacío —las dos listas están de acuerdo— y aun así esas ventas siguen ahí:
--  se guardaron cuando no lo estaban, y **nadie vuelve a mirarlas**.
--
--  O sea: la función contesta «el equipo está bien», que es verdad, y la
--  pregunta que importaba era otra — «¿hay ventas que no suman a nadie?».
--
--  Por qué importa
--  ---------------
--  El reporte de comisiones casa el vendedor de la venta con el empleado por
--  nombre, sin acentos (`upper(unaccent_(...))`). Los acentos NO rompen nada.
--  Una letra de más, sí: esa venta sale `sin_nombre` en el Excel regional y su
--  comisión **no se le suma a nadie**. No da error: sale una fila en blanco
--  entre cientos.
--
--  Lo que hace este SQL
--  --------------------
--  Añade a `equipo_divergencias` las ventas y los accesorios cuyo vendedor no
--  casa con ningún empleado de la tienda, con cuántas son y desde cuándo. No
--  corrige nada: DICE. Corregir cada caso es un UPDATE con nombres reales, y
--  eso vive en `_privado/`, no en un repo público.
--
--  No cambia la firma ni las columnas, así que Admin sigue leyéndola igual.
-- ============================================================

-- ── LA REGLA DE «¿QUIÉN ES ÉSTE?», EN UN SOLO SITIO ─────────
--
-- La usan el informe (abajo) y el arreglo de los datos
-- (_privado/unificar_vendedor_2.sql). Tiene que ser LA MISMA: si el informe
-- dice «esto quedaría como X» con una regla y el UPDATE usa otra, el «mirar
-- antes de tocar» miente — y eso es exactamente lo que se está arreglando.
--
-- Dos formas de reconocer a alguien, en orden, y las dos exigen que el
-- resultado sea ÚNICO:
--
--   1. El nombre guardado es el PRINCIPIO del de la ficha.
--        'Jorge Medina'  ->  'Jorge Medina Rejon'
--
--   2. Sus palabras aparecen, EN ORDEN, dentro del de la ficha. Hace falta
--      porque hay quien se guarda con nombre y apellido paterno saltándose el
--      segundo nombre, y eso no es un prefijo de nada:
--        'Luis Vidal'  ->  'Luis de Jesus Ortega Vidal'
--
-- Devuelve CUÁNTOS casan y, si casa uno solo, cuál. Con dos o más no propone
-- ninguno a propósito: elegir por el que salga primero le mueve la comisión a
-- una persona real.
CREATE OR REPLACE FUNCTION public.vendedor_probable_(p_store text, p_nombre text)
RETURNS TABLE (cuantos bigint, nombre text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH g AS (
    SELECT upper(unaccent_(coalesce(p_nombre, ''))) AS txt
  ),
  por_prefijo AS (
    SELECT e.nombre
      FROM public.empleados e, g
     WHERE e.store_id = p_store
       AND g.txt <> ''
       AND upper(unaccent_(e.nombre)) LIKE g.txt || ' %'
  ),
  por_palabras AS (
    SELECT e.nombre
      FROM public.empleados e, g
     WHERE e.store_id = p_store
       AND g.txt <> ''
       AND upper(unaccent_(e.nombre)) LIKE '%' || regexp_replace(g.txt, '\s+', '%', 'g') || '%'
  ),
  elegidos AS (
    SELECT nombre FROM por_prefijo
    UNION ALL
    SELECT nombre FROM por_palabras
     WHERE NOT EXISTS (SELECT 1 FROM por_prefijo)
  )
  SELECT count(*)::bigint, min(nombre) FROM elegidos;
$$;

REVOKE ALL ON FUNCTION public.vendedor_probable_(text,text) FROM public;
GRANT EXECUTE ON FUNCTION public.vendedor_probable_(text,text) TO anon, authenticated;


CREATE OR REPLACE FUNCTION public.equipo_divergencias(p_store text)
RETURNS TABLE (nombre text, origen text, problema text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  -- ── Lo de siempre (28-ago) ────────────────────────────────
  SELECT v.n,
         'config',
         'no casa con ningun empleado: su comision no se sumaria a nadie'
    FROM public.tiendas t,
         LATERAL jsonb_array_elements_text(t.vendedores) AS v(n)
   WHERE t.store_id = p_store
     AND NOT EXISTS (
           SELECT 1 FROM public.empleados e
            WHERE e.store_id = t.store_id
              AND upper(unaccent_(e.nombre)) = upper(unaccent_(v.n)))

  UNION ALL

  SELECT e.nombre,
         'empleados',
         'sin nombre_reporte: la formula del PUESTO no lo encontraria'
    FROM public.empleados e
   WHERE e.store_id = p_store
     AND e.activo
     AND e.nombre_reporte IS NULL

  UNION ALL

  SELECT e.nombre,
         'empleados',
         'no aparece en la lista de la config: nadie mas puede capturar por el'
    FROM public.empleados e
   WHERE e.store_id = p_store
     AND e.activo
     AND NOT EXISTS (
           SELECT 1
             FROM public.tiendas t,
                  LATERAL jsonb_array_elements_text(t.vendedores) AS v(n)
            WHERE t.store_id = p_store
              AND upper(unaccent_(v.n)) = upper(unaccent_(e.nombre)))

  -- ── Y lo que faltaba: lo YA GUARDADO (21-sep) ─────────────
  --
  -- Que las dos listas estén de acuerdo HOY no arregla lo que se guardó
  -- cuando no lo estaban. Estas filas no las mira nadie hasta que el Excel
  -- del mes sale con un hueco, y para entonces ya hay que repararlas.
  --
  -- ⚠️ Y NO TODAS SON LO MISMO. La primera versión de esto las metía todas en
  -- el mismo saco —«no está en el equipo»— y al correrla salieron 166 ventas
  -- que sí son del equipo: el mismo asesor guardado con el nombre corto, sin
  -- apellido materno. Decirle «no está en el equipo» a eso es falso y además
  -- inútil: lo que hace falta saber es SI SE PUEDE UNIFICAR y con quién.
  --
  -- Así que se busca al empleado del que ese nombre es el principio. Si hay
  -- exactamente uno, se dice cuál. Si hay varios, se dice que no se puede
  -- decidir — dos asesores que compartan nombre y primer apellido existen, y
  -- elegir por el que salga primero le movería la comisión a alguien.
  --
  -- `(sin nombre)` queda fuera: lo pone `venta_guardar` cuando la captura
  -- llega sin vendedor, ya se sabe lo que es y no es una grafía suelta.
  UNION ALL

  SELECT x.vendedor, x.origen,
         format('%s %s desde el %s · %s',
                x.n, x.que, to_char(x.desde, 'DD/MM/YYYY'),
                CASE
                  WHEN vp.cuantos = 1 THEN 'parece ' || vp.nombre || ' escrito corto'
                  WHEN vp.cuantos > 1 THEN 'coincide con ' || vp.cuantos::text ||
                       ' empleados: NO se puede unificar sin mirarlo'
                  ELSE 'no casa con ningun empleado: su comision no se suma a nadie'
                END)
    FROM (
      SELECT t.vendedor, t.origen, count(*) AS n, min(t.cuando) AS desde,
             max(t.que) AS que
        FROM (
          SELECT v.vendedor, 'ventas'::text AS origen, v.vendida_en AS cuando,
                 'venta(s)'::text AS que
            FROM public.ventas v
           WHERE v.store_id = p_store
             AND coalesce(trim(v.vendedor),'') NOT IN ('', '(sin nombre)')
          UNION ALL
          SELECT a.vendedor, 'accesorios'::text, a.vendida_en, 'accesorio(s)'::text
            FROM public.accesorios_ventas a
           WHERE a.store_id = p_store
             AND coalesce(trim(a.vendedor),'') NOT IN ('', '(sin nombre)')
        ) t
       WHERE NOT EXISTS (
               SELECT 1 FROM public.empleados e
                WHERE e.store_id = p_store
                  AND upper(unaccent_(e.nombre)) = upper(unaccent_(t.vendedor)))
       GROUP BY t.vendedor, t.origen
    ) x
    CROSS JOIN LATERAL public.vendedor_probable_(p_store, x.vendedor) vp

  -- ── Y el que no rompe las comisiones pero sí el attach ────
  --
  -- Un nombre puede casar con la ficha y estar escrito DISTINTO: con acentos
  -- y sin ellos, normalmente. El reporte de comisiones los une —compara con
  -- `unaccent_`— y por eso esto no sale en lo de arriba.
  --
  -- Pero `ventas_hoy` y los attach agrupan por el nombre TAL CUAL
  -- (`GROUP BY h.vendedor`), y el tablero los indexa igual. Así que el mismo
  -- asesor sale como DOS personas y su Assurant Attach se parte en dos
  -- porcentajes, ninguno de los cuales es el suyo. No da error y no se nota
  -- salvo que alguien cuente las filas.
  UNION ALL

  SELECT y.vendedor,
         'grafia',
         format('%s fila(s) escritas distinto a la ficha («%s»): para las '
                'comisiones da igual, pero en el attach por asesor sale como '
                'otra persona', y.n, y.ficha)
    FROM (
      SELECT t.vendedor, count(*) AS n, min(e.nombre) AS ficha
        FROM (
          SELECT v.vendedor FROM public.ventas v WHERE v.store_id = p_store
          UNION ALL
          SELECT a.vendedor FROM public.accesorios_ventas a WHERE a.store_id = p_store
        ) t
        JOIN public.empleados e
          ON e.store_id = p_store
         AND upper(unaccent_(e.nombre)) = upper(unaccent_(t.vendedor))
       WHERE t.vendedor <> e.nombre
       GROUP BY t.vendedor
    ) y;
$$;

REVOKE ALL ON FUNCTION public.equipo_divergencias(text) FROM public;
GRANT EXECUTE ON FUNCTION public.equipo_divergencias(text) TO anon, authenticated;


-- ============================================================
--  COMPROBAR
-- ============================================================
--
--      SELECT * FROM public.equipo_divergencias('1217');
--
--  Lo que salió al correrlo el 21-sep-2026, y no era lo que se esperaba:
--  OCHO filas, no tres. Cinco son el mismo equipo guardado con el nombre
--  CORTO —sin apellido materno—, 166 ventas desde el 24/06/2026. Una es la
--  letra de más de siempre (2 ventas + 13 accesorios) y otra, un nombre de
--  pila suelto.
--
--  Por eso la función ahora dice de CADA una si parece alguien escrito corto
--  —y quién— o si de verdad no casa con nadie. Sin esa distinción el informe
--  no sirve para decidir: unificar lo primero es seguro, lo segundo no.
--
--  Cada nombre que aparezca se arregla con el barrido de
--  `_privado/unificar_vendedor.sql`, cambiándole las dos constantes del
--  principio (`malo` y `bueno`). Ese barrido recorre TODAS las columnas de
--  texto del esquema, que es la parte que no conviene volver a escribir a
--  mano: el nombre del vendedor se guarda suelto en dos docenas de sitios.
-- ============================================================
