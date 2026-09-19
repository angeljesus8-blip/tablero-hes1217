-- ============================================================
--  EL CORTE HUERFANO DE LOS AGOTADOS
--  Reparacion de una sola vez
--  17-sep-2026
-- ============================================================
--
--  ------------------------------------------------------------
--  LA REGLA, COMO SE OPERA EN PISO
--  ------------------------------------------------------------
--  1. El reporte de exhibicion es la FOTO COMPLETA del piso y se sube cada vez
--     que entra mercancia nueva al aparador.
--  2. Si un EOL tiene el On Hand en cero, una pieza exhibida y se registra una
--     venta -> esa venta ES la pieza de exhibicion. El sistema la descuenta
--     solo: la casilla «es la pieza de exhibicion» ni siquiera aparece cuando
--     no queda bodega, porque ahi el 50 % se aplica automatico.
--  3. En lo que NO es EOL la pieza de piso no se vende. Con el On Hand en cero,
--     una venta es un equipo que se trae de otra tienda o que llega del CEDIS y
--     el informe todavia no refleja. El aparador no se toca.
--
--  Eso ya vive en `inventario_vivo` (supabase_venta_exhibicion.sql, bloque 2).
--  Este archivo arregla el DATO que quedo sucio antes de que existiera.
--
--  ------------------------------------------------------------
--  QUE SE ENSUCIO
--  ------------------------------------------------------------
--  Desde el 5-sep `carga_catalogo` pone el On Hand en cero a los SKU que ya no
--  vienen en el informe del dia — correcto, el articulo se agoto — pero no
--  retomaba su CORTE. Con el corte viejo:
--
--      vendido     = ventas - corte           (corte viejo -> vendido > 0)
--      excedente   = greatest(0, vendido - onhand)      (onhand ya en 0)
--
--  las ventas de BODEGA de dias pasados pasan a leerse como piezas de aparador.
--  El descuento automatico del punto 2 deja de ser "una venta despues de que la
--  bodega quedo vacia" y se convierte en "todo lo que se vendio desde hace
--  semanas". El aparador se vacia solo al agotarse el almacen.
--
--  Visto en piso el 17-sep con el WATCH FIT 4 1.82" NG (100259554): la pieza de
--  exhibicion puesta, articulo EOL, y el tablero decia «ya no» en vez de
--  ofrecerla al 50 %.  onhand 0 · vendido 3 · exhibicion 1 · exh_vendida 3.
--  Las tres ventas salieron de las tres cajas que hubo en bodega.
--
--  Al escribir esto: 36 SKU con corte huerfano · 13 con pieza de piso · 4 EOL
--  sin su remate.
--
--  ------------------------------------------------------------
--  HASTA DONDE SE RETOMA EL CORTE
--  ------------------------------------------------------------
--  Solo las ventas ANTERIORES a la ultima subida del informe. Las de despues se
--  quedan fuera a proposito: con la bodega ya confirmada en cero, esas si son
--  el descuento automatico del punto 2, y borrarlas volveria a ofrecer al 50 %
--  una pieza de piso que ya se vendio. Al 17-sep no hay ninguna — se comprobo
--  contra las ventas del dia — pero el filtro protege el rato que pase entre
--  que esto se escribe y se pega.
--
--  No mueve una sola cifra de bodega: solo toca SKU con On Hand en cero, y ahi
--  `stock = greatest(0, 0 - vendido)` ya es cero con corte viejo o nuevo. La
--  comprobacion 2 lo verifica.
--
--  Se pega completo en el SQL Editor del proyecto "HES" (rjdrljtujbwooejrpyqv).
--  Es idempotente. VA AL FINAL, despues de:
--    1) supabase_venta_exhibicion.sql   (la regla del punto 2 y 3)
--    2) supabase_cargas_admin.sql       (para que no se vuelva a ensuciar)
-- ============================================================


-- ── 1 · Antes: la foto, para poder comparar ─────────────────
DROP TABLE IF EXISTS _inv_antes_corte;
CREATE TABLE _inv_antes_corte AS SELECT * FROM public.inventario_vivo('1217');


-- ── 2 · Lo que se va a tocar, a la vista ────────────────────
SELECT sku, descripcion, onhand, vendido, exhibicion, exh_vendida
  FROM _inv_antes_corte
 WHERE onhand = 0 AND vendido > 0
 ORDER BY exhibicion DESC, sku;


-- ── 3 · Retomar el corte de los agotados ────────────────────
-- El criterio de que ventas cuentan es el MISMO de `corte_tomar_` —bodega, sin
-- entregas de preventa—, escrito aqui solo porque hace falta ademas el corte de
-- fecha. Si algun dia cambia alla, este archivo ya no se usa: es de una vez.
INSERT INTO public.inventario_corte (store_id, tipo, sku, vendidas)
SELECT i.store_id, 'onhand', i.sku,
       (SELECT count(*)::int
          FROM public.ventas v
         WHERE v.store_id = i.store_id
           AND v.sku = i.sku
           AND NOT v.de_exhibicion
           AND NOT EXISTS (SELECT 1 FROM public.apartados a WHERE a.venta_id = v.id)
           AND v.vendida_en <= (SELECT max(c.updated_at) FROM public.catalogo c
                                 WHERE c.store_id = i.store_id))
  FROM public.inventario i
 WHERE i.store_id = '1217'
   AND coalesce(i.onhand, 0) = 0
ON CONFLICT (store_id, tipo, sku) DO UPDATE
  SET vendidas = excluded.vendidas, tomado_en = now();


-- ============================================================
--  COMPROBAR
-- ============================================================

-- 1) EL STOCK NO SE MOVIO. Esperado: 0 filas. Si sale alguna, parar y avisar:
--    esto no tenia por que tocar bodega.
SELECT a.sku, a.stock AS antes, b.stock AS ahora
  FROM _inv_antes_corte a
  JOIN public.inventario_vivo('1217') b USING (sku)
 WHERE a.stock <> b.stock;

-- 2) Ya no queda corte huerfano. Esperado: solo SKU con ventas POSTERIORES a la
--    ultima subida del informe (hoy, ninguno).
SELECT sku, descripcion, onhand, vendido, exh_vendida
  FROM public.inventario_vivo('1217')
 WHERE onhand = 0 AND vendido > 0;

-- 3) Las piezas de piso que vuelven a contarse. ESTA ES LA QUE SE LEE CON EL
--    APARADOR DELANTE: lo que aparezca aqui y no este puesto en el mueble, se
--    vendio sin que el sistema lo supiera. Arreglo: volver a subir el reporte
--    de exhibicion, que es la foto de lo que HAY.
SELECT b.sku, b.descripcion,
       greatest(0, a.exhibicion - a.exh_vendida) AS piso_antes,
       greatest(0, b.exhibicion - b.exh_vendida) AS piso_ahora
  FROM _inv_antes_corte a
  JOIN public.inventario_vivo('1217') b USING (sku)
 WHERE greatest(0, b.exhibicion - b.exh_vendida)
     > greatest(0, a.exhibicion - a.exh_vendida)
 ORDER BY b.descripcion;

-- 4) Los EOL que ya se pueden rematar. El Watch Fit 4 negro (100259554) tiene
--    que estar en esta lista, con `solo_exhibicion = true` (el 50 % se aplica
--    solo al capturar la venta).
SELECT * FROM public.eol_precio_venta('1217') ORDER BY sku;

-- 5) La regla del punto 3 de la cabecera, comprobada con datos: ningun articulo
--    que NO sea EOL puede tener exh_vendida por excedente. Esperado: 0 filas.
SELECT iv.sku, iv.descripcion, iv.onhand, iv.vendido, iv.exhibicion, iv.exh_vendida
  FROM public.inventario_vivo('1217') iv
 WHERE iv.exh_vendida > 0
   AND NOT EXISTS (SELECT 1 FROM public.eol e
                    WHERE e.store_id = '1217' AND e.sku = iv.sku AND NOT e.pausado);

-- 6) Al terminar:
--    DROP TABLE _inv_antes_corte;

-- ============================================================
--  PASO 2 · LO QUE DIJO EL APARADOR  (19-sep-2026)
-- ============================================================
--  La comprobacion 3 devolvio cuatro piezas de piso recuperadas. Angel las
--  fue a ver una por una al mueble:
--
--      100259554  WATCH FIT 4 NG            -> SI esta. Se queda, $1,749.
--      100274973  WATCH GT6 41MM BN         -> NO esta.
--      100250576  MATEPAD PRO 13.2" DO      -> NO esta.
--      100074525  HUAWEI WATCH KID AZ       -> NO esta.
--
--  Las tres que no estan tienen `onhand 0 · vendido 0 · exhibicion 1`: no hay
--  ninguna venta que descontarles. Su pieza salio ANTES del corte que este
--  archivo retomo — vendida sin marcar, o en traspaso — y el corte se llevo por
--  delante la unica senal que quedaba de esa salida.
--
--  Eso NO se arregla con ventas: se arregla con la foto del piso, porque el
--  dato que esta mal es cuantas piezas hay exhibidas.
--
--  VIA NORMAL, sin SQL: subir el reporte de exhibicion desde Admin. Los SKU que
--  no vienen en el archivo quedan en exhibicion = 0 y `carga_exhibicion`
--  retoma los dos cortes. Esa es la via buena y de paso corrige lo que no
--  sepamos.
--
--  Si el reporte no esta a mano, esto hace lo mismo para esos tres SKU:

SELECT sku, descripcion, onhand, vendido, exhibicion, exh_vendida
  FROM public.inventario_vivo('1217')
 WHERE sku IN ('100274973','100250576','100074525');

UPDATE public.inventario
   SET exhibicion = 0
 WHERE store_id = '1217'
   AND sku IN ('100274973','100250576','100074525');

-- Con exhibicion en 0 los tres salen del aparador y del remate: el 50 % exige
-- `exhibicion - exh_vendida > 0`. Cuando se repongan, el reporte de exhibicion
-- los devuelve a 1 y vuelve a tomar su corte.

-- COMPROBAR. Esperado: solo 100259554, en $1,749.00, solo_exhibicion = true.
SELECT * FROM public.eol_precio_venta('1217') ORDER BY sku;

-- ============================================================
--  Odemas · Grupo Gigante — uso interno HES 1217
-- ============================================================
