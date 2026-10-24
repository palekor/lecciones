-- =====================================================================
-- Pruebas de la v1.2 (códigos de acceso y journal en línea). Se ejecutan
-- después de test_schema.sql y test_v11.sql sobre la misma base.
-- =====================================================================
\set QUIET on
set client_min_messages = warning;

create or replace function pg_temp.ok(cond boolean, name text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', name; end if;
  raise warning 'PASS: %', name;
end $$;

create temporary table t12 (k text primary key, v text);
grant all on t12 to anon, authenticated;
create or replace function pg_temp.put(k text, v text) returns void language sql as $$
  insert into t12 values (k, v) on conflict (k) do update set v = excluded.v;
$$;
create or replace function pg_temp.get(k text) returns text language sql as $$ select v from t12 where t12.k = $1 $$;

select set_config('request.headers', '{"x-forwarded-for":"200.9.9.9"}', false);

-- Estudiante de prueba
reset role;
insert into public.sms_students (full_name, email, whatsapp, status)
values ('Laura Mejía', 'laura.journal@correo.com', '+573001112233', 'active'),
       ('Laura M. (duplicado)', 'laura.dup@correo.com', '+573001112244', 'prospect');
select pg_temp.put('stu', (select id::text from public.sms_students where email = 'laura.journal@correo.com'));
select pg_temp.put('dup', (select id::text from public.sms_students where email = 'laura.dup@correo.com'));

-- ---------------------------------------------------------- seguridad
do $$ declare t text; begin
  foreach t in array array['sms_access_codes','sms_access_devices','sms_journal','sms_journal_texts','sms_journal_reports'] loop
    perform pg_temp.ok((select relrowsecurity from pg_class where relname = t), 'RLS activo en ' || t);
    perform pg_temp.ok(not has_table_privilege('anon', 'public.' || t, 'select'), 'anon sin lectura en ' || t);
    perform pg_temp.ok(not has_table_privilege('authenticated', 'public.' || t, 'insert'), 'sin inserción directa en ' || t);
  end loop;
  perform pg_temp.ok(not has_column_privilege('authenticated', 'public.sms_access_devices', 'token_hash', 'select'),
                     'la huella de la llave no es legible desde la API');
  perform pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                       where n.nspname = 'public' and p.proname like 'sms\_%'
                         and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')) = 0,
                     'todas las funciones con search_path fijo');
end $$;

-- ---------------------------------------------------------- panel: crear códigos
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', false);
do $$ begin
  begin perform public.sms_access_create(pg_temp.get('stu')::uuid, 'essential', null); raise exception 'FAIL: equipo creó código';
  exception when insufficient_privilege then raise warning 'PASS: el rol Equipo no crea códigos'; end;
  perform pg_temp.ok((select count(*) from public.sms_access_codes) = 0, 'Equipo puede leer códigos (vacío)');
end $$;

select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', false);
do $$ begin
  begin perform public.sms_journal_overview(); raise exception 'FAIL: ajeno vio resumen';
  exception when insufficient_privilege then raise warning 'PASS: usuario ajeno no ve el resumen del journal'; end;
end $$;

select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', false);
do $$ declare c jsonb; c2 jsonb; begin
  c := public.sms_access_create(pg_temp.get('stu')::uuid, 'companion', (current_date + 90), 'Plan Impulso');
  perform pg_temp.ok(c->>'code' ~ '^PG-[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}$', 'código generado con el formato PG-XXXX-XXXX');
  perform pg_temp.ok(c->>'tier' = 'companion' and (c->>'valid_until')::date = current_date + 90, 'programa y vigencia guardados');
  perform pg_temp.put('code', c->>'code'); perform pg_temp.put('code_id', c->>'id');

  c2 := public.sms_access_create(pg_temp.get('stu')::uuid, 'mastery', null, null, 'pg-abcd efgh');
  perform pg_temp.ok(c2->>'code' = 'PG-ABCD-EFGH' and c2->>'valid_until' is null, 'registrar un código existente (normalizado, sin vencimiento)');
  perform pg_temp.put('code2_id', c2->>'id');
  begin perform public.sms_access_create(pg_temp.get('stu')::uuid, 'mastery', null, null, 'PG-ABCD-EFGH'); raise exception 'FAIL: duplicado';
  exception when unique_violation then raise warning 'PASS: no se puede registrar dos veces el mismo código'; end;
  begin perform public.sms_access_create(pg_temp.get('stu')::uuid, 'gold', null); raise exception 'FAIL: tier';
  exception when invalid_parameter_value then raise warning 'PASS: programa inválido rechazado'; end;
  perform pg_temp.ok((select count(*) from public.sms_activity where student_id = pg_temp.get('stu')::uuid and kind = 'access') = 2,
                     'creación de códigos queda en el historial');
end $$;
-- Códigos únicos al generar muchos
reset role;
do $$ declare i int; begin
  for i in 1..300 loop perform pg_temp.put('gen' || i, public.sms__new_code()); end loop;
  perform pg_temp.ok((select count(distinct v) from t12 where k like 'gen%') = 300, '300 códigos generados sin repetirse');
  delete from t12 where k like 'gen%';
end $$;

-- ---------------------------------------------------------- público: activar
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
do $$ declare r jsonb; begin
  r := public.sms_access_redeem('PG-ZZZZ-ZZZZ', 'Chrome · Android');
  perform pg_temp.ok(r->>'ok' = 'false' and r->>'reason' = 'invalid', 'código inexistente rechazado');
  r := public.sms_access_redeem('', null);
  perform pg_temp.ok(r->>'reason' = 'invalid', 'código vacío rechazado');
  r := public.sms_access_redeem(lower(replace(pg_temp.get('code'), '-', ' ')), 'Chrome · Android');
  perform pg_temp.ok(r->>'ok' = 'true' and char_length(r->>'token') = 64, 'código válido (minúsculas y espacios) entrega llave de dispositivo');
  perform pg_temp.ok(r->>'tier' = 'companion' and r->>'first_name' = 'Laura' and r->>'can_share' = 'true' and r->>'sharing' = 'false',
                     'activación devuelve programa, nombre y que aún no comparte');
  perform pg_temp.put('tok', r->>'token');
  r := public.sms_access_status(pg_temp.get('tok'));
  perform pg_temp.ok(r->>'state' = 'active' and r->>'tier' = 'companion', 'estado activo con la llave');
  r := public.sms_access_status('x');
  perform pg_temp.ok(r->>'state' = 'revoked', 'llave inválida = sin acceso');
  r := public.sms_access_status(repeat('a', 64));
  perform pg_temp.ok(r->>'state' = 'revoked', 'llave desconocida = sin acceso');
end $$;

-- ---------------------------------------------------------- consentimiento y envío
do $$ declare r jsonb; p jsonb; begin
  r := public.sms_journal_sync(pg_temp.get('tok'), '{"stats":{"missions":3}}');
  perform pg_temp.ok(r->>'ok' = 'false' and r->>'reason' = 'no_consent', 'sin autorización no se guarda nada');
  r := public.sms_journal_consent(pg_temp.get('tok'), true);
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'sharing' = 'true', 'autorización registrada');

  p := jsonb_build_object('app', '11.2', 'name', 'Laura', 'streak', 4, 'last_active', current_date::text, 'mission', 3,
    'completed', '[0,1,2,"x",2]'::jsonb,
    'profile', '{"level":"B1","goal":"Job interviews"}'::jsonb,
    'stats', '{"missions":3,"classesAttended":5,"stars":2,"secs":900,"words":420}'::jsonb,
    'texts', jsonb_build_array(
      jsonb_build_object('id', 'w-1', 'kind', 'writing', 'sub', 'class', 'title', 'Deep work', 'prompt', 'Evaluate your week',
                         'content', E'My week has\nmany meetings.', 'words', 5, 'at', '2026-10-20T15:00:00Z'),
      jsonb_build_object('id', 'rf-1', 'kind', 'reflection', 'title', 'Mission 3', 'content', 'I managed to explain my job.'),
      jsonb_build_object('id', 'bad-1', 'kind', 'virus', 'content', 'x'),
      jsonb_build_object('id', 'empty-1', 'kind', 'writing', 'content', '   '),
      jsonb_build_object('id', 'big-1', 'kind', 'writing', 'content', repeat('a', 40000))),
    'reports', jsonb_build_array(
      jsonb_build_object('day', current_date::text, 'content', E'Day report\n★ Attended', 'sent_at', now()::text),
      jsonb_build_object('day', (current_date + 30)::text, 'content', 'future'),
      jsonb_build_object('day', '2026-02-31', 'content', 'bad date')));
  r := public.sms_journal_sync(pg_temp.get('tok'), p);
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'state' = 'active' and jsonb_array_length(r->'feedback') = 0, 'envío aceptado');
  perform pg_temp.put('since', r->>'server_time');
end $$;
reset role;
do $$ declare s uuid := pg_temp.get('stu')::uuid; begin
  perform pg_temp.ok((select (stats->>'missions')::int = 3 and streak = 4 and current_mission = 3 and completed_missions = '{0,1,2}'
                             and profile->>'level' = 'B1' and last_seen_at > now() - interval '1 minute' and app_version = '11.2'
                        from public.sms_journal where student_id = s), 'avance, racha y última conexión guardados');
  perform pg_temp.ok((select count(*) from public.sms_journal_texts where student_id = s) = 3, 'textos válidos guardados, inválidos descartados');
  perform pg_temp.ok((select content from public.sms_journal_texts where student_id = s and client_id = 'w-1') = E'My week has\nmany meetings.',
                     'el texto conserva sus saltos de línea');
  perform pg_temp.ok((select char_length(content) from public.sms_journal_texts where student_id = s and client_id = 'big-1') = 30000,
                     'texto demasiado largo se recorta');
  perform pg_temp.ok((select count(*) from public.sms_journal_reports where student_id = s) = 1, 'solo reportes con fecha válida y no futura');
  perform pg_temp.ok((select count(*) from public.sms_consents where student_id = s and kind = 'journal_sharing' and granted) = 1,
                     'autorización guardada con versión del aviso');
  perform pg_temp.put('upd', (select updated_at::text from public.sms_journal_texts where student_id = s and client_id = 'w-1'));
end $$;

-- Reenviar lo mismo no cambia nada; editar sí actualiza.
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
do $$ declare r jsonb; begin
  perform pg_sleep(0.05);
  r := public.sms_journal_sync(pg_temp.get('tok'), jsonb_build_object('texts', jsonb_build_array(
         jsonb_build_object('id', 'w-1', 'kind', 'writing', 'sub', 'class', 'title', 'Deep work', 'prompt', 'Evaluate your week',
                            'content', E'My week has\nmany meetings.', 'words', 5))));
  perform pg_temp.ok(r->>'ok' = 'true', 'reenvío idéntico aceptado');
end $$;
reset role;
do $$ begin
  perform pg_temp.ok((select updated_at::text from public.sms_journal_texts where client_id = 'w-1') = pg_temp.get('upd'), 'reenvío idéntico no reescribe el texto');
end $$;
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
do $$ declare r jsonb; begin
  r := public.sms_journal_sync(pg_temp.get('tok'), jsonb_build_object('texts', jsonb_build_array(
         jsonb_build_object('id', 'w-1', 'kind', 'writing', 'title', 'Deep work', 'prompt', 'Evaluate your week',
                            'content', 'My week has many meetings and one deep block.', 'words', 9))));
end $$;
reset role;
do $$ begin
  perform pg_temp.ok((select content from public.sms_journal_texts where client_id = 'w-1') like '%deep block.', 'texto editado se actualiza');
end $$;

-- ---------------------------------------------------------- retroalimentación del profesor
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', false);
do $$ declare t jsonb; ov jsonb; begin
  t := public.sms_journal_feedback((select id from public.sms_journal_texts where client_id = 'w-1'), E'Great structure.\nUse "although" once.');
  perform pg_temp.ok(t->>'feedback' like 'Great structure.%' and t->>'feedback_seen_at' is null, 'el equipo deja retroalimentación');
  ov := public.sms_journal_overview();
  perform pg_temp.ok((ov->>'online_now')::int = 1 and (ov->>'reports_today')::int = 1 and (ov->>'texts_pending')::int = 2
                     and jsonb_array_length(ov->'recent') = 1, 'resumen: en línea, reportes de hoy y textos sin revisar');
  perform pg_temp.ok((select count(*) from public.sms_journal_texts) = 3, 'el equipo lee los textos');
  begin perform public.sms_journal_purge(pg_temp.get('stu')::uuid); raise exception 'FAIL: equipo borró';
  exception when insufficient_privilege then raise warning 'PASS: solo admin borra datos del journal'; end;
end $$;
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
do $$ declare r jsonb; begin
  r := public.sms_journal_sync(pg_temp.get('tok'), jsonb_build_object('since', pg_temp.get('since')));
  perform pg_temp.ok(jsonb_array_length(r->'feedback') = 1 and r->'feedback'->0->>'id' = 'w-1'
                     and r->'feedback'->0->>'feedback' like 'Great structure.%', 'la retroalimentación vuelve al journal');
  perform pg_temp.put('since', r->>'server_time');
  r := public.sms_journal_sync(pg_temp.get('tok'), jsonb_build_object('since', pg_temp.get('since')));
  perform pg_temp.ok(jsonb_array_length(r->'feedback') = 0, 'no se repite la retroalimentación ya entregada');
  r := public.sms_journal_sync(pg_temp.get('tok'), '{}');
  perform pg_temp.ok(jsonb_array_length(r->'feedback') = 1, 'un dispositivo nuevo (sin fecha) recibe toda la retroalimentación');
end $$;
reset role;
do $$ begin
  perform pg_temp.ok((select feedback_seen_at is not null from public.sms_journal_texts where client_id = 'w-1'), 'queda marcada como recibida');
end $$;

-- ---------------------------------------------------------- renovar, vencer, revocar
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', false);
do $$ declare c jsonb; begin
  c := public.sms_access_update(pg_temp.get('code_id')::uuid, jsonb_build_object('valid_until', (current_date - 1)::text));
  perform pg_temp.ok((c->>'valid_until')::date = current_date - 1, 'vigencia editada');
end $$;
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
do $$ declare r jsonb; begin
  r := public.sms_access_status(pg_temp.get('tok'));
  perform pg_temp.ok(r->>'state' = 'expired' and (r->>'valid_until')::date = current_date - 1, 'código vencido se refleja en el dispositivo');
  r := public.sms_journal_sync(pg_temp.get('tok'), '{"stats":{"missions":9}}');
  perform pg_temp.ok(r->>'ok' = 'false' and r->>'reason' = 'expired', 'vencido: no se guarda el envío');
  r := public.sms_access_redeem(pg_temp.get('code'), null);
  perform pg_temp.ok(r->>'reason' = 'expired' and (r->>'valid_until')::date = current_date - 1, 'activar un código vencido informa la fecha');
end $$;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', false);
do $$ declare c jsonb; begin
  c := public.sms_access_update(pg_temp.get('code_id')::uuid, jsonb_build_object('valid_until', (current_date + 30)::text, 'tier', 'mastery'));
  perform pg_temp.ok(c->>'tier' = 'mastery', 'renovado y cambiado de programa');
  perform pg_temp.ok((select summary from public.sms_activity where kind = 'access' order by id desc limit 1) like '%programa Mastery Program%vigente hasta%',
                     'renovación queda en el historial');
  begin perform public.sms_access_update(pg_temp.get('code_id')::uuid, '{"code":"PG-HACK-HACK"}'); raise exception 'FAIL: campo';
  exception when invalid_parameter_value then raise warning 'PASS: no se puede cambiar el código en sí'; end;
end $$;
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
do $$ declare r jsonb; begin
  r := public.sms_access_status(pg_temp.get('tok'));
  perform pg_temp.ok(r->>'state' = 'active' and r->>'tier' = 'mastery', 'la renovación llega al dispositivo sin volver a escribir el código');
end $$;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', false);
do $$ begin perform public.sms_access_update(pg_temp.get('code_id')::uuid, '{"status":"revoked"}'); end $$;
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
do $$ declare r jsonb; begin
  r := public.sms_access_status(pg_temp.get('tok'));
  perform pg_temp.ok(r->>'state' = 'revoked', 'revocado en el panel = sin acceso en el dispositivo');
  r := public.sms_access_redeem(pg_temp.get('code'), null);
  perform pg_temp.ok(r->>'reason' = 'revoked', 'un código revocado no se puede activar');
end $$;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', false);
do $$ begin perform public.sms_access_update(pg_temp.get('code_id')::uuid, '{"status":"active"}'); end $$;
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
do $$ declare r jsonb; i int; begin
  r := public.sms_access_status(pg_temp.get('tok'));
  perform pg_temp.ok(r->>'state' = 'active', 'reactivado');
  -- Máximo 5 dispositivos: el sexto retira el menos usado
  perform pg_temp.put('tok_old', pg_temp.get('tok'));
  for i in 1..5 loop
    perform pg_sleep(0.01);
    r := public.sms_access_redeem(pg_temp.get('code'), 'Dispositivo ' || i);
  end loop;
  perform pg_temp.put('tok', r->>'token');
  r := public.sms_access_status(pg_temp.get('tok_old'));
  perform pg_temp.ok(r->>'state' = 'revoked', 'el dispositivo usado hace más tiempo cede su lugar al sexto');
end $$;
reset role;
do $$ begin
  perform pg_temp.ok((select count(*) from public.sms_access_devices where code_id = pg_temp.get('code_id')::uuid and revoked_at is null) = 5
                     and (select count(*) from public.sms_access_devices where code_id = pg_temp.get('code_id')::uuid) = 6,
                     'máximo 5 dispositivos activos por código');
end $$;

-- ---------------------------------------------------------- límites
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
select set_config('request.headers', '{"x-forwarded-for":"201.1.1.1"}', false);
do $$ declare r jsonb; i int; begin
  for i in 1..20 loop r := public.sms_access_redeem('PG-NOPE-' || lpad(i::text, 4, '0'), null); end loop;
  r := public.sms_access_redeem(pg_temp.get('code'), null);
  perform pg_temp.ok(r->>'reason' = 'rate_limited', 'más de 20 intentos en 10 min desde la misma IP se bloquean');
end $$;
select set_config('request.headers', '{}', false);
reset role;
insert into public.sms_rate_events (bucket) select 'redeem:fail' from generate_series(1, 300);
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
do $$ declare r jsonb; begin
  r := public.sms_access_redeem(pg_temp.get('code'), null);
  perform pg_temp.ok(r->>'reason' = 'rate_limited', 'tope global de intentos fallidos (sin IP)');
  r := public.sms_access_status(pg_temp.get('tok'));
  perform pg_temp.ok(r->>'state' = 'active', 'el tope de intentos no afecta a dispositivos ya activados');
end $$;
reset role;
delete from public.sms_rate_events where bucket like 'redeem:%';
select set_config('request.headers', '{"x-forwarded-for":"200.9.9.9"}', false);

-- ---------------------------------------------------------- retiro de autorización
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
do $$ declare r jsonb; begin
  r := public.sms_journal_consent(pg_temp.get('tok'), false);
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'sharing' = 'false', 'retiro de autorización');
  r := public.sms_journal_sync(pg_temp.get('tok'), '{"stats":{"missions":10}}');
  perform pg_temp.ok(r->>'reason' = 'no_consent', 'tras el retiro no se recibe nada');
end $$;
reset role;
do $$ begin
  perform pg_temp.ok((select (stats->>'missions')::int from public.sms_journal where student_id = pg_temp.get('stu')::uuid) = 3, 'nada se actualizó tras el retiro');
  perform pg_temp.ok((select count(*) from public.sms_consents where student_id = pg_temp.get('stu')::uuid and kind = 'journal_sharing') = 2,
                     'el retiro también queda registrado');
end $$;

-- Código para la ficha duplicada (se fusiona más abajo)
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', false);
do $$ declare c jsonb; begin
  c := public.sms_access_create(pg_temp.get('dup')::uuid, 'essential', null);
  perform pg_temp.put('dupcode', c->>'code');
end $$;

-- ---------------------------------------------------------- exportar, fusionar, eliminar
do $$ declare e jsonb; b jsonb; begin
  e := public.sms_student_export(pg_temp.get('stu')::uuid);
  perform pg_temp.ok(jsonb_array_length(e->'access_codes') = 2 and jsonb_array_length(e->'journal_texts') = 3
                     and jsonb_array_length(e->'journal_reports') = 1 and e->'journal'->>'streak' = '4',
                     'la exportación de la persona incluye códigos y journal');
  b := public.sms_backup_export();
  perform pg_temp.ok(b->>'version' = '1.2' and jsonb_array_length(b->'journal_texts') = 3
                     and not (b->'access_devices'->0) ? 'token_hash', 'respaldo con journal y sin huellas de llaves');
end $$;
-- Fusionar: el duplicado trae un texto propio que debe pasar a la ficha que queda
reset role;
insert into public.sms_journal (student_id, sharing) values (pg_temp.get('dup')::uuid, true);
insert into public.sms_journal_texts (student_id, client_id, kind, content) values
  (pg_temp.get('dup')::uuid, 'w-dup', 'writing', 'From the duplicate'),
  (pg_temp.get('dup')::uuid, 'w-1', 'writing', 'Same id, should not overwrite');
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', false);
do $$ begin perform public.sms_merge_students(pg_temp.get('stu')::uuid, pg_temp.get('dup')::uuid); end $$;
reset role;
do $$ declare s uuid := pg_temp.get('stu')::uuid; begin
  perform pg_temp.ok((select count(*) from public.sms_access_codes where student_id = s) = 3, 'fusión: los códigos pasan a la ficha que queda');
  perform pg_temp.ok((select count(*) from public.sms_journal_texts where student_id = s) = 4
                     and (select content from public.sms_journal_texts where student_id = s and client_id = 'w-1') like '%deep block.',
                     'fusión: textos nuevos se suman sin pisar los existentes');
end $$;
-- Eliminar datos personales
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', false);
do $$ declare r jsonb; begin
  r := public.sms_journal_purge(pg_temp.get('stu')::uuid);
  perform pg_temp.ok((r->>'texts')::int = 4 and (r->>'reports')::int = 1, 'admin borra los datos del journal en el servidor');
  perform public.sms_anonymize_student(pg_temp.get('stu')::uuid);
end $$;
reset role;
do $$ declare s uuid := pg_temp.get('stu')::uuid; begin
  perform pg_temp.ok(not exists (select 1 from public.sms_access_codes where student_id = s and status = 'active'), 'eliminación: códigos revocados');
  perform pg_temp.ok(not exists (select 1 from public.sms_journal where student_id = s)
                     and not exists (select 1 from public.sms_journal_texts where student_id = s), 'eliminación: journal borrado');
end $$;
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
do $$ declare r jsonb; begin
  r := public.sms_access_status(pg_temp.get('tok'));
  perform pg_temp.ok(r->>'state' = 'revoked', 'eliminación: los dispositivos pierden el acceso');
end $$;
reset role;

\echo V12_TESTS_PASSED
