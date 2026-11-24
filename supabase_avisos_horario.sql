-- ============================================================
--  AVISOS DEL HORARIO — fase 1: mandar a UNA persona  ·  24-nov-2026
-- ============================================================
--  Depende de supabase_notificaciones.sql (tabla notif_config).
--
--  `notificar` manda a TODOS (included_segments = All). Para los recordatorios
--  de comida y Ley Silla hace falta mandarle a cada quien lo suyo. El horario
--  liga cada celular con `OneSignal.login('<tienda>-<número de empleado>')`, y
--  aquí se manda a esos ids con `include_aliases.external_id`.
--
--  Esta función NO la puede llamar la app (ni anon ni authenticated): la usarán
--  el reloj (pg_cron, fase 2) y el SQL Editor para probar. Si la app pudiera
--  llamarla, cualquiera con la clave pública le mandaría avisos a quien quisiera.
-- ============================================================

CREATE OR REPLACE FUNCTION public.avisar_a_(
  p_store  text,
  p_empnos text[],
  p_msg    text,
  p_titulo text DEFAULT NULL,
  p_url    text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE
  cfg      public.notif_config%ROWTYPE;
  v_ids    jsonb;
  v_titulo text;
  resp     extensions.http_response;
  cuerpo   jsonb;
BEGIN
  IF coalesce(trim(p_msg),'') = '' OR coalesce(array_length(p_empnos,1),0) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sin mensaje o sin destinatario');
  END IF;
  SELECT * INTO cfg FROM public.notif_config WHERE store_id = p_store;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'OneSignal no configurado');
  END IF;

  -- El mismo id que arma el horario: '<tienda>-<número>' (sin espacios).
  SELECT jsonb_agg(DISTINCT p_store || '-' || trim(e)) INTO v_ids
    FROM unnest(p_empnos) e WHERE coalesce(trim(e),'') <> '';

  SELECT 'HES ' || t.store_id || ' · ' || coalesce(t.nombre,'')
    INTO v_titulo FROM public.tiendas t WHERE t.store_id = p_store;
  v_titulo := coalesce(nullif(trim(coalesce(p_titulo,'')),''), v_titulo, 'HES');

  PERFORM extensions.http_set_curlopt('CURLOPT_TIMEOUT', '15');
  SELECT * INTO resp FROM extensions.http((
    'POST', 'https://onesignal.com/api/v1/notifications',
    ARRAY[extensions.http_header('Authorization', 'Basic ' || cfg.api_key)],
    'application/json',
    jsonb_build_object(
      'app_id',          cfg.app_id,
      'target_channel',  'push',                                   -- obligatorio (ver notificar)
      'include_aliases', jsonb_build_object('external_id', v_ids),
      'headings',        jsonb_build_object('en', v_titulo, 'es', v_titulo),   -- `en` obligatorio
      'contents',        jsonb_build_object('en', trim(p_msg), 'es', trim(p_msg)),
      'url',             coalesce(p_url, 'https://angeljesus8-blip.github.io/tablero-hes1217/horarios.html'),
      -- Un recordatorio de las 12:00 que llega a las 12:40 ya no sirve: que se
      -- descarte si el celular estuvo apagado más de 20 minutos.
      'ttl',             1200
    )::text
  )::extensions.http_request);

  BEGIN cuerpo := resp.content::jsonb;
  EXCEPTION WHEN OTHERS THEN cuerpo := jsonb_build_object('respuesta_no_json', left(coalesce(resp.content,''),200));
  END;

  -- 200 sin `id` = nadie con ese id tiene un celular ligado y suscrito.
  IF resp.status = 200 AND coalesce(cuerpo->>'id','') = '' THEN
    RETURN jsonb_build_object('ok', true, 'destinatarios', 0, 'sin_celular', true,
                              'detalle', left(cuerpo::text, 200));
  END IF;
  IF resp.status <> 200 OR (cuerpo ? 'errors' AND coalesce(cuerpo->>'id','') = '') THEN
    RETURN jsonb_build_object('ok', false, 'http', resp.status, 'error', left(cuerpo::text, 200));
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', cuerpo->>'id', 'destinatarios', cuerpo->'recipients',
                            'detalle', cuerpo->'errors');
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLSTATE || ': ' || left(SQLERRM, 140));
END $fn$;

REVOKE ALL ON FUNCTION public.avisar_a_(text, text[], text, text, text) FROM public, anon, authenticated;


-- ============================================================
--  COMPROBAR (después de abrir el horario nuevo en tu celular y tocar 🔔)
-- ============================================================
--  1) La app NO la puede llamar (debe decir `false` las dos):
--       select has_function_privilege('anon', 'public.avisar_a_(text,text[],text,text,text)', 'execute'),
--              has_function_privilege('authenticated', 'public.avisar_a_(text,text[],text,text,text)', 'execute');
--
--  2) Aviso de prueba SOLO a tu celular:
--       select public.avisar_a_('1217', array['TU_NUMERO'], '🔔 Prueba: este aviso es solo para ti');
--     -> {"ok": true, "id": "...", "destinatarios": 1}
--     Si sale `sin_celular`, tu celular aún no está ligado: abre el horario
--     desde el tablero y mira que la campana esté verde.
--
--  3) El diagnóstico (supabase_diagnostico_avisos.sql) debe enseñar tu
--     celular como «ligado a 1217-TU_NUMERO».
-- ============================================================
