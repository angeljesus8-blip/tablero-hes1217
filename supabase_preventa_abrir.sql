-- ============================================================
--  ABRIR Y CERRAR UNA PREVENTA SIN TOCAR CÓDIGO
--  17-sep-2026
-- ============================================================
--
--  QUÉ PROBLEMA CIERRA
--  -------------------
--  El 5-sep un cliente quiso apartar un PURA 90S PRO MAX NJ y la app no lo
--  dejó: «Cupo agotado: 6 de 6 piezas ya apartadas». Los 6 no eran apartados
--  vivos — eran equipos ENTREGADOS hacía semanas. El trigger `apartado_cabe`
--  cuenta todo lo que no esté Cancelado, así que el SKU se bloqueó justamente
--  por haberse vendido bien.
--
--  Y no había dónde arreglarlo: el cupo se escribía a mano en
--  `supabase_preventa_cupo.sql` con `preventa_cupo_gen.py`, se pegaba en el
--  SQL Editor, y para retirarlo había que volver a pegar SQL. Una preventa
--  que dura tres semanas no puede depender de que yo esté disponible.
--
--  Desde aquí la preventa es un dato, no código:
--    · `activa = false`  → el tope deja de aplicar (la preventa terminó).
--    · `cupo IS NULL`    → hay preventa pero sin límite de piezas.
--    · `producto` y `precio` viven en la fila, para que el tablero pueda
--      dibujar la tarjeta de un equipo que TODAVÍA NO EXISTE en el catálogo
--      ni en el inventario. Sin esas dos columnas no hay preventa posible
--      antes del embarque, que es el único momento en que sirve.
--
--  LO QUE NO CAMBIA, A PROPÓSITO
--  -----------------------------
--  Se sigue contando todo lo no-Cancelado contra el cupo, entregados
--  incluidos. El cupo es el número de piezas que Puebla tiene asignadas: una
--  pieza entregada consumió su lugar de verdad. Lo que faltaba no era una
--  cuenta distinta, era poder decir «ya se acabó la preventa».
--
--  Se pega completo en el SQL Editor del proyecto "HES"
--  (rjdrljtujbwooejrpyqv). Es idempotente.
-- ============================================================


-- ── 1 · Las columnas que faltaban ───────────────────────────
-- `activa` arranca en true para no cambiarle el significado a las 12 filas que
-- ya están: hoy aplican tope, y así se quedan hasta que alguien las termine
-- desde Admin.
ALTER TABLE public.preventa_cupo
  ADD COLUMN IF NOT EXISTS producto   text,
  ADD COLUMN IF NOT EXISTS precio     numeric(12,2),
  ADD COLUMN IF NOT EXISTS activa     boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS abierta_en timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS cerrada_en timestamptz,
  ADD COLUMN IF NOT EXISTS subido_por text;

-- Sin esto no se puede abrir una preventa «sin tope», que es el caso normal
-- cuando el corporativo todavía no dice cuántas piezas toca por tienda.
ALTER TABLE public.preventa_cupo
  ALTER COLUMN cupo DROP NOT NULL;


-- ── 2 · El tope, ahora con interruptor ──────────────────────
-- Dos salidas nuevas antes de contar: preventa terminada o cupo sin definir.
-- El resto es el trigger del 5-ago tal cual, incluida la exclusión del propio
-- renglón en los UPDATE (`id <> coalesce(NEW.id,-1)`), que es lo que permite
-- corregir un apartado sin que se estorbe a sí mismo.
CREATE OR REPLACE FUNCTION public.apartado_cabe()
RETURNS trigger LANGUAGE plpgsql AS $trg$
DECLARE tope integer; viva boolean; usado integer;
BEGIN
  IF NEW.estatus = 'Cancelado' THEN RETURN NEW; END IF;

  SELECT cupo, activa INTO tope, viva
    FROM public.preventa_cupo
   WHERE store_id = NEW.store_id AND sku = NEW.sku;

  IF viva IS NULL THEN RETURN NEW; END IF;   -- este SKU no está en preventa
  IF viva = false THEN RETURN NEW; END IF;   -- la preventa ya terminó
  IF tope IS NULL THEN RETURN NEW; END IF;   -- preventa abierta, sin límite

  SELECT coalesce(sum(piezas),0) INTO usado
    FROM public.apartados
   WHERE store_id = NEW.store_id AND sku = NEW.sku
     AND estatus <> 'Cancelado' AND id <> coalesce(NEW.id, -1);

  IF usado + NEW.piezas > tope THEN
    RAISE EXCEPTION 'Cupo agotado: % de % piezas ya apartadas', usado, tope;
  END IF;
  RETURN NEW;
END $trg$;


-- ── 3 · Abrir preventa  ←  Admin, a mano o desde el archivo ─
-- Recibe las filas como jsonb para que el día que se lea el PDF del
-- corporativo sea la MISMA función: el lector solo tiene que armar el arreglo.
--   [{ "sku":"100295475", "producto":"PURA 90S 12+512 NJ",
--      "precio":19999, "cupo":36 }]
-- `cupo` ausente o null = sin límite. Un sku repetido se actualiza; volver a
-- subir una preventa terminada la revive (activa = true), que es lo que uno
-- espera al recargar la lista.
CREATE OR REPLACE FUNCTION public.carga_preventa(
  p_store text,
  p_token text,
  p_filas jsonb,
  p_by    text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE f jsonb; sku_ text; n integer := 0;
BEGIN
  IF NOT public.escritura_ok_(p_store, p_token) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_autorizado');
  END IF;
  IF p_filas IS NULL OR jsonb_typeof(p_filas) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sin filas');
  END IF;

  FOR f IN SELECT * FROM jsonb_array_elements(p_filas) LOOP
    sku_ := trim(coalesce(f->>'sku',''));
    CONTINUE WHEN sku_ = '';

    INSERT INTO public.preventa_cupo
      (store_id, sku, cupo, producto, precio, activa, abierta_en,
       cerrada_en, subido_por)
    VALUES
      (p_store, sku_,
       nullif(trim(coalesce(f->>'cupo','')),'')::integer,
       nullif(trim(coalesce(f->>'producto','')),''),
       nullif(trim(coalesce(f->>'precio','')),'')::numeric,
       true, now(), NULL, nullif(trim(coalesce(p_by,'')),''))
    ON CONFLICT (store_id, sku) DO UPDATE SET
      -- El cupo se pisa tal cual, incluso con null: subir la lista sin cupo es
      -- la forma de quitarle el tope a un SKU sin terminar la preventa.
      cupo       = EXCLUDED.cupo,
      -- El nombre y el precio no: si el archivo nuevo no los trae, se conserva
      -- lo que ya se había escrito a mano. Perderlos deja la tarjeta muda.
      producto   = coalesce(EXCLUDED.producto, preventa_cupo.producto),
      precio     = coalesce(EXCLUDED.precio,   preventa_cupo.precio),
      activa     = true,
      cerrada_en = NULL,
      subido_por = coalesce(EXCLUDED.subido_por, preventa_cupo.subido_por);

    n := n + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'filas', n);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false,
                            'error', SQLSTATE || ': ' || left(SQLERRM, 140));
END $fn$;


-- ── 4 · Terminar preventa  ←  el botón que faltaba el 5-sep ─
-- Con p_sku en null termina TODAS las activas de la tienda: la preventa suele
-- cerrarse completa (llegó el embarque), no equipo por equipo.
-- No borra la fila: cuánto se apartó y a qué precio es justo lo que se mira
-- cuando llega la siguiente preventa.
CREATE OR REPLACE FUNCTION public.preventa_terminar(
  p_store text,
  p_token text,
  p_sku   text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE n integer;
BEGIN
  IF NOT public.escritura_ok_(p_store, p_token) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_autorizado');
  END IF;

  UPDATE public.preventa_cupo
     SET activa = false, cerrada_en = now()
   WHERE store_id = p_store
     AND activa = true
     AND (p_sku IS NULL OR sku = trim(p_sku));
  GET DIAGNOSTICS n = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'cerradas', n);
END $fn$;


-- ── 5 · La lectura ──────────────────────────────────────────
-- Devuelve TODAS las filas, activas y terminadas, con la cuenta hecha aquí:
-- `apartadas` es la misma suma que mira el trigger, así que lo que el asesor
-- ve en pantalla y lo que la base va a permitir no pueden discrepar.
-- `quedan` en null significa «sin límite», no «cero»: quien la pinte tiene que
-- distinguirlo o va a mostrar un agotado que no existe.
CREATE OR REPLACE FUNCTION public.preventa_lista(p_store text)
RETURNS TABLE (
  sku        text,
  producto   text,
  precio     numeric,
  cupo       integer,
  activa     boolean,
  apartadas  integer,
  quedan     integer,
  abierta_en timestamptz,
  cerrada_en timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT p.sku,
         p.producto,
         p.precio,
         p.cupo,
         p.activa,
         coalesce(a.piezas, 0)::integer AS apartadas,
         CASE WHEN p.cupo IS NULL THEN NULL
              ELSE greatest(p.cupo - coalesce(a.piezas, 0), 0) END::integer
           AS quedan,
         p.abierta_en,
         p.cerrada_en
    FROM public.preventa_cupo p
    LEFT JOIN LATERAL (
      SELECT sum(x.piezas)::integer AS piezas
        FROM public.apartados x
       WHERE x.store_id = p.store_id AND x.sku = p.sku
         AND x.estatus <> 'Cancelado'
    ) a ON true
   WHERE p.store_id = p_store
   ORDER BY p.activa DESC, p.producto NULLS LAST, p.sku;
$fn$;


-- ── 5-bis · Por qué NO va dentro de `tablero_todo` ──────────
-- La tentación era meter la preventa en el viaje único del tablero, que es lo
-- que hace todo lo demás. Se descartó: `tablero_todo` vive en
-- `supabase_funciones_lectura_resto.sql`, y tenerlo definido TAMBIÉN aquí deja
-- dos versiones de la misma función. El día que alguien repegue el otro archivo
-- —cosa que pasa— la preventa se cae del tablero sin un solo error: la sección
-- simplemente deja de aparecer. `verificar.py` ya marca ese caso con
-- `resincronizar`, y tiene razón.
-- El tablero pide `preventa_lista` en su propia llamada, en paralelo. Cuesta un
-- viaje más (~0.2 s, sin bloquear al resto) y a cambio esta función solo está
-- escrita en un sitio.


-- ── 6 · Permisos ────────────────────────────────────────────
-- La lista es pública para la tienda (la lee el tablero de cualquier asesor,
-- igual que el catálogo); abrir y terminar exigen el token.
REVOKE ALL ON FUNCTION public.preventa_lista(text)                 FROM public;
REVOKE ALL ON FUNCTION public.carga_preventa(text,text,jsonb,text) FROM public;
REVOKE ALL ON FUNCTION public.preventa_terminar(text,text,text)    FROM public;

GRANT EXECUTE ON FUNCTION public.preventa_lista(text)                 TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.carga_preventa(text,text,jsonb,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preventa_terminar(text,text,text)    TO anon, authenticated;


-- ── 7 · Para comprobar que quedó ────────────────────────────
--   SELECT * FROM public.preventa_lista('1217');
-- Las 12 filas de los Pura 90S deben salir con activa = true y su cuenta de
-- apartadas. Terminar la preventa de agosto (lo que no se pudo el 5-sep) es
-- una línea desde Admin, o aquí:
--   SELECT public.preventa_terminar('1217', '<gas_token>', NULL);
