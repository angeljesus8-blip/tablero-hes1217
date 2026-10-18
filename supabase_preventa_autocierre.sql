-- ============================================================
--  LA PREVENTA SE CIERRA SOLA CUANDO LLEGA INVENTARIO
--  17-oct-2026 · requiere supabase_preventa_abrir.sql (ya pegado)
-- ============================================================
--
--  QUÉ PROBLEMA CIERRA
--  -------------------
--  Hasta hoy la preventa solo se terminaba a mano (Admin → Preventa →
--  Terminar). Si nadie se acordaba, el equipo seguía saliendo en la sección
--  de preventa —«paga hoy y recoge cuando llegue»— con piezas ya en bodega,
--  y el asesor no tenía el botón normal de venta: `estadoSku` dice «hay» y la
--  tarjeta de preventa solo añadía «✅ Ya llegó».
--
--  POR QUÉ ES SEGURO CERRARLA EN CUANTO HAY ON HAND
--  -------------------------------------------------
--  La preventa se cobra en el POS EL DÍA QUE SE APARTA. Cuando llega el
--  embarque, el «Informe de Artículos Totales» ya trae el On Hand SIN las
--  piezas comprometidas (se comprobó el 7-ago-2026 con los Pura 90S: 6
--  apartados y On Hand 1; ver supabase_inventario_preventa.sql). Así que:
--    · On Hand > 0  → son piezas libres: se venden normal, la preventa sobra.
--    · On Hand = 0  → o no ha llegado nada, o todo lo que llegó ya tenía
--                     dueño: la preventa sigue abierta, que es lo correcto.
--  Y el On Hand NO incluye la exhibición (verificado en piso el 1-ago, ver
--  MAPA.md): el demo que llega antes que el embarque no la cierra.
--
--  SOLO EN EL CAMBIO DE 0 A ALGO, NO CADA VEZ QUE HAY STOCK
--  --------------------------------------------------------
--  El disparo es la LLEGADA: el On Hand pasa de cero (o de no existir) a más
--  de cero. Si el gerente reabre la preventa a mano teniendo stock —porque
--  llegaron 2 y hay 5 clientes esperando—, el informe del día siguiente trae
--  otra vez 2 y NO la vuelve a cerrar. Cerrar «cada vez que hay stock» le
--  pisaría esa decisión todos los días sin decir nada.
--  Lo que eso deja fuera, a propósito: una preventa ABIERTA cuando ya había
--  stock no se cierra sola hasta que el SKU se agote y vuelva a llegar.
--
--  DÓNDE VIVE: UN TRIGGER, NO DENTRO DE carga_catalogo
--  ---------------------------------------------------
--  Meterlo en `carga_catalogo` obligaba a copiar esa función entera aquí, y
--  entonces quedaría escrita en dos archivos: el día que alguien repegue
--  supabase_cargas_admin.sql, el cierre automático desaparece sin un error
--  (el caso que `verificar.py` marca con `resincronizar`). El trigger mira la
--  tabla `inventario`, así que también cubre cualquier otra carga que algún
--  día escriba el On Hand.
--
--  No toca ningún apartado: los que ya existen se entregan igual.
--
--  Se pega completo en el SQL Editor del proyecto "HES"
--  (rjdrljtujbwooejrpyqv). Es idempotente. El último renglón es una prueba
--  que se deshace sola y tiene que decir «OK».
-- ============================================================


-- ── 1 · Quién la cerró ──────────────────────────────────────
-- NULL = a mano desde Admin (lo que ya había). 'inventario' = este trigger.
-- Sirve para la próxima vez que alguien pregunte «¿y esta quién la terminó?».
ALTER TABLE public.preventa_cupo
  ADD COLUMN IF NOT EXISTS cerrada_por text;


-- ── 2 · El trigger ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.preventa_cierra_al_llegar()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $trg$
BEGIN
  IF coalesce(NEW.onhand, 0) <= 0 THEN RETURN NEW; END IF;
  -- Ya tenía stock antes de esta carga: no es una llegada (ver encabezado).
  IF TG_OP = 'UPDATE' AND coalesce(OLD.onhand, 0) > 0 THEN RETURN NEW; END IF;

  UPDATE public.preventa_cupo
     SET activa = false, cerrada_en = now(), cerrada_por = 'inventario'
   WHERE store_id = NEW.store_id
     AND sku      = NEW.sku
     AND activa   = true;
  RETURN NEW;
END $trg$;

-- `UPDATE OF onhand`: la carga de exhibición escribe en esta misma tabla y no
-- debe despertar el trigger. (Igual no cerraría nada —el onhand no cambia—,
-- pero así ni lo intenta.)
DROP TRIGGER IF EXISTS preventa_cierra_al_llegar_trg ON public.inventario;
CREATE TRIGGER preventa_cierra_al_llegar_trg
  AFTER INSERT OR UPDATE OF onhand ON public.inventario
  FOR EACH ROW EXECUTE FUNCTION public.preventa_cierra_al_llegar();


-- ── 3 · La prueba ───────────────────────────────────────────
-- Corre los cuatro casos con un SKU inventado y lo deshace todo al final (el
-- RAISE dentro del bloque BEGIN/EXCEPTION revierte lo que hizo). Nadie la
-- puede llamar desde la app: solo existe para el SQL Editor.
CREATE OR REPLACE FUNCTION public.preventa_autocierre_prueba()
RETURNS text
LANGUAGE plpgsql SET search_path = public
AS $fn$
DECLARE
  s   constant text := '1217';
  k   constant text := 'PRUEBA-AUTOCIERRE';
  a1 boolean; a2 boolean; a3 boolean; a4 boolean; quien text;
  r  text;
BEGIN
  BEGIN
    INSERT INTO preventa_cupo (store_id, sku, cupo, producto, activa)
    VALUES (s, k, NULL, 'prueba', true);

    -- 1) Primera vez que aparece, en cero: sigue abierta.
    INSERT INTO inventario (store_id, sku, onhand) VALUES (s, k, 0);
    SELECT activa INTO a1 FROM preventa_cupo WHERE store_id = s AND sku = k;

    -- 2) Llega el embarque (0 → 2): se cierra.
    UPDATE inventario SET onhand = 2 WHERE store_id = s AND sku = k;
    SELECT activa, cerrada_por INTO a2, quien
      FROM preventa_cupo WHERE store_id = s AND sku = k;

    -- 3) El gerente la reabre con stock y el informe trae 3: NO se cierra.
    UPDATE preventa_cupo SET activa = true, cerrada_en = NULL, cerrada_por = NULL
     WHERE store_id = s AND sku = k;
    UPDATE inventario SET onhand = 3 WHERE store_id = s AND sku = k;
    SELECT activa INTO a3 FROM preventa_cupo WHERE store_id = s AND sku = k;

    -- 4) Se agota (3 → 0) y vuelve a llegar (0 → 1): se cierra otra vez.
    UPDATE inventario SET onhand = 0 WHERE store_id = s AND sku = k;
    UPDATE inventario SET onhand = 1 WHERE store_id = s AND sku = k;
    SELECT activa INTO a4 FROM preventa_cupo WHERE store_id = s AND sku = k;

    r := CASE
      WHEN a1 IS DISTINCT FROM true  THEN 'FALLA 1: se cerró con On Hand en cero'
      WHEN a2 IS DISTINCT FROM false THEN 'FALLA 2: llegó stock y no se cerró'
      WHEN quien IS DISTINCT FROM 'inventario' THEN 'FALLA 2: no dice quién la cerró'
      WHEN a3 IS DISTINCT FROM true  THEN 'FALLA 3: pisó una reapertura a mano'
      WHEN a4 IS DISTINCT FROM false THEN 'FALLA 4: la segunda llegada no la cerró'
      ELSE 'OK: los 4 casos pasan (y la prueba no dejó nada escrito)'
    END;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = r;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    r := SQLERRM;
  END;
  RETURN r;
END $fn$;

REVOKE ALL ON FUNCTION public.preventa_autocierre_prueba() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.preventa_cierra_al_llegar()  FROM public, anon, authenticated;

SELECT public.preventa_autocierre_prueba() AS resultado;
