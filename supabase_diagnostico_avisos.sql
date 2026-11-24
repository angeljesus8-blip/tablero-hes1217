-- ============================================================
--  DIAGNÓSTICO DE NOTIFICACIONES  ·  24-nov-2026
--  Solo LEE: no cambia nada en la base ni manda ningún aviso.
-- ============================================================
--  Antes de construir los recordatorios de comida y Ley Silla hay que saber
--  desde dónde se parte:
--    · ¿está la llave de OneSignal?   · ¿cuántos celulares están suscritos?
--    · ¿llegaron los últimos envíos?  · ¿está encendido pg_cron (el reloj)?
--
--  Se pega completo en Supabase → SQL Editor → Run. Sale una tabla de
--  renglones «paso / resultado». La llave NUNCA se imprime.
--
--  Va dentro de una función temporal (pg_temp) porque `cron.job` no existe si
--  pg_cron está apagado, y una consulta directa reventaría entera.
-- ============================================================

CREATE OR REPLACE FUNCTION pg_temp.diag_avisos()
RETURNS TABLE (paso text, resultado text)
LANGUAGE plpgsql AS $fn$
DECLARE
  cfg   public.notif_config%ROWTYPE;
  resp  extensions.http_response;
  j     jsonb;
  p     jsonb;
  n     int;
BEGIN
  -- 1 · Extensiones
  paso := '1 extensión http';
  resultado := CASE WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname='http')
                    THEN 'sí' ELSE 'NO — sin ella no sale ningún aviso' END;
  RETURN NEXT;

  paso := '2 extensión pg_cron';
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    EXECUTE 'SELECT count(*) FROM cron.job' INTO n;
    resultado := 'sí · ' || n || ' tarea(s) programada(s)';
    RETURN NEXT;
    FOR paso, resultado IN EXECUTE
      $q$SELECT '2 · tarea', jobname || ' → ' || schedule || CASE WHEN active THEN '' ELSE ' (APAGADA)' END
         FROM cron.job ORDER BY jobid$q$
    LOOP RETURN NEXT; END LOOP;
  ELSE
    resultado := 'NO — hay que encenderla (Database → Extensions → pg_cron)';
    RETURN NEXT;
  END IF;

  -- 3 · Llave de OneSignal (sin enseñarla)
  SELECT * INTO cfg FROM public.notif_config WHERE store_id = '1217';
  paso := '3 llave OneSignal';
  IF NOT FOUND THEN
    resultado := 'NO está en notif_config';
    RETURN NEXT;
    RETURN;
  END IF;
  resultado := 'sí · app ' || cfg.app_id || ' · guardada ' || to_char(cfg.actualizado, 'DD-MM-YYYY');
  RETURN NEXT;

  PERFORM extensions.http_set_curlopt('CURLOPT_TIMEOUT', '20');

  -- 4 · Celulares suscritos
  SELECT * INTO resp FROM extensions.http((
    'GET', 'https://onesignal.com/api/v1/players?app_id=' || cfg.app_id || '&limit=300',
    ARRAY[extensions.http_header('Authorization','Basic ' || cfg.api_key)], NULL, NULL
  )::extensions.http_request);
  paso := '4 dispositivos';
  IF resp.status <> 200 THEN
    resultado := 'OneSignal respondió ' || resp.status || ': ' || left(coalesce(resp.content,''), 150);
    RETURN NEXT;
  ELSE
    j := resp.content::jsonb;
    SELECT count(*) FILTER (WHERE coalesce((x->>'invalid_identifier')::boolean,false) = false
                              AND coalesce((x->>'notification_types')::int, 1) > 0),
           count(*)
      INTO n, resultado
      FROM jsonb_array_elements(coalesce(j->'players','[]')) x;
    resultado := n || ' suscrito(s) de verdad · ' || resultado || ' registrado(s) en total';
    RETURN NEXT;

    -- Uno por renglón: tipo, sistema, última vez activo y si ya tiene dueño.
    FOR p IN SELECT x FROM jsonb_array_elements(coalesce(j->'players','[]')) x
             ORDER BY (x->>'last_active')::bigint DESC NULLS LAST LIMIT 40
    LOOP
      paso := '4 · dispositivo';
      resultado :=
        CASE (p->>'device_type')::int
          WHEN 0 THEN 'iPhone app' WHEN 1 THEN 'Android app' WHEN 5 THEN 'Chrome'
          WHEN 7 THEN 'Safari'     WHEN 8 THEN 'Firefox'     WHEN 17 THEN 'Edge'
          ELSE 'tipo ' || coalesce(p->>'device_type','?') END
        || ' · ' || coalesce(p->>'device_os','')
        || ' · activo ' || coalesce(to_char(to_timestamp((p->>'last_active')::bigint)
                                    AT TIME ZONE 'America/Mexico_City', 'DD-MM-YYYY'), '?')
        || CASE WHEN coalesce((p->>'invalid_identifier')::boolean,false)
                  OR coalesce((p->>'notification_types')::int, 1) <= 0
                THEN ' · DADO DE BAJA' ELSE ' · ok' END
        || CASE WHEN coalesce(p->>'external_user_id','') <> ''
                THEN ' · ligado a ' || (p->>'external_user_id') ELSE ' · sin dueño' END;
      RETURN NEXT;
    END LOOP;
  END IF;

  -- 5 · Últimos envíos: `successful` = Google/Apple lo aceptó;
  --     `received` = el teléfono lo mostró.
  SELECT * INTO resp FROM extensions.http((
    'GET', 'https://onesignal.com/api/v1/notifications?app_id=' || cfg.app_id || '&limit=5',
    ARRAY[extensions.http_header('Authorization','Basic ' || cfg.api_key)], NULL, NULL
  )::extensions.http_request);
  IF resp.status = 200 THEN
    FOR p IN SELECT x FROM jsonb_array_elements(coalesce(resp.content::jsonb->'notifications','[]')) x
    LOOP
      paso := '5 envío';
      resultado := coalesce(to_char(to_timestamp((p->>'queued_at')::bigint)
                              AT TIME ZONE 'America/Mexico_City', 'DD-MM-YYYY HH24:MI'), '?')
        || ' · aceptados ' || coalesce(p->>'successful','0')
        || ' · fallidos '  || coalesce(p->>'failed','0')
        || ' · mostrados ' || coalesce(p->>'received', '?')
        || ' · «' || left(coalesce(p->'contents'->>'es', p->'contents'->>'en', ''), 50) || '»';
      RETURN NEXT;
    END LOOP;
  ELSE
    paso := '5 envíos';
    resultado := 'OneSignal respondió ' || resp.status;
    RETURN NEXT;
  END IF;
EXCEPTION WHEN OTHERS THEN
  paso := 'ERROR';
  resultado := SQLSTATE || ': ' || left(SQLERRM, 200);
  RETURN NEXT;
END $fn$;

SELECT * FROM pg_temp.diag_avisos();
