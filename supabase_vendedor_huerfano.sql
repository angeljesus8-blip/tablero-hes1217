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
  -- `(sin nombre)` queda fuera: lo pone `venta_guardar` cuando la captura
  -- llega sin vendedor, ya se sabe lo que es y no es una grafía suelta.
  UNION ALL

  SELECT v.vendedor,
         'ventas',
         format('%s venta(s) desde el %s a nombre de alguien que no esta en el '
                'equipo: su comision no se suma a nadie',
                count(*), to_char(min(v.vendida_en), 'DD/MM/YYYY'))
    FROM public.ventas v
   WHERE v.store_id = p_store
     AND coalesce(trim(v.vendedor),'') NOT IN ('', '(sin nombre)')
     AND NOT EXISTS (
           SELECT 1 FROM public.empleados e
            WHERE e.store_id = v.store_id
              AND upper(unaccent_(e.nombre)) = upper(unaccent_(v.vendedor)))
   GROUP BY v.vendedor

  UNION ALL

  SELECT a.vendedor,
         'accesorios',
         format('%s accesorio(s) desde el %s a nombre de alguien que no esta '
                'en el equipo: su comision no se suma a nadie',
                count(*), to_char(min(a.vendida_en), 'DD/MM/YYYY'))
    FROM public.accesorios_ventas a
   WHERE a.store_id = p_store
     AND coalesce(trim(a.vendedor),'') NOT IN ('', '(sin nombre)')
     AND NOT EXISTS (
           SELECT 1 FROM public.empleados e
            WHERE e.store_id = a.store_id
              AND upper(unaccent_(e.nombre)) = upper(unaccent_(a.vendedor)))
   GROUP BY a.vendedor;
$$;

REVOKE ALL ON FUNCTION public.equipo_divergencias(text) FROM public;
GRANT EXECUTE ON FUNCTION public.equipo_divergencias(text) TO anon, authenticated;


-- ============================================================
--  COMPROBAR
-- ============================================================
--
--      SELECT * FROM public.equipo_divergencias('1217');
--
--  Esperado el 21-sep-2026: tres filas de origen `ventas` —dos grafías de un
--  mismo apellido y un nombre de pila suelto— y lo que salga de `accesorios`.
--  Si sale vacío, o la función no se aplicó o alguien ya las corrigió.
--
--  Cada nombre que aparezca se arregla con el barrido de
--  `_privado/unificar_vendedor.sql`, cambiándole las dos constantes del
--  principio (`malo` y `bueno`). Ese barrido recorre TODAS las columnas de
--  texto del esquema, que es la parte que no conviene volver a escribir a
--  mano: el nombre del vendedor se guarda suelto en dos docenas de sitios.
-- ============================================================
