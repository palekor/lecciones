-- =====================================================================
-- Pruebas de la v1.3 (mensajes del profesor al journal). Se ejecutan
-- después de las anteriores sobre la misma base (usa sus usuarios).
-- =====================================================================
\set QUIET on
set client_min_messages = warning;

create or replace function pg_temp.ok(cond boolean, name text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', name; end if;
  raise warning 'PASS: %', name;
end $$;
create temporary table t13 (k text primary key, v text);
grant all on t13 to anon, authenticated;
create or replace function pg_temp.put(k text, v text) returns void language sql as $$
  insert into t13 values (k, v) on conflict (k) do update set v = excluded.v;
$$;
create or replace function pg_temp.get(k text) returns text language sql as $$ select v from t13 where t13.k = $1 $$;

select set_config('request.headers', '{"x-forwarded-for":"200.13.13.13"}', false);
reset role;
delete from public.sms_rate_events where bucket like 'redeem:%';
insert into public.sms_students (full_name, email, status) values ('Mario Díaz', 'mario.msg@correo.com', 'active'),
                                                                  ('Otra Persona', 'otra.msg@correo.com', 'active');
select pg_temp.put('stu', (select id::text from public.sms_students where email = 'mario.msg@correo.com'));
select pg_temp.put('otra', (select id::text from public.sms_students where email = 'otra.msg@correo.com'));

do $$ begin
  perform pg_temp.ok((select relrowsecurity from pg_class where relname = 'sms_journal_messages'), 'RLS activo en mensajes');
  perform pg_temp.ok(not has_table_privilege('anon', 'public.sms_journal_messages', 'select'), 'anon no lee mensajes');
  perform pg_temp.ok(not has_table_privilege('authenticated', 'public.sms_journal_messages', 'insert'), 'sin inserción directa de mensajes');
end $$;

-- Código del estudiante y activación en su teléfono
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', false);
do $$ begin
  perform pg_temp.put('code', public.sms_access_create(pg_temp.get('stu')::uuid, 'essential', current_date + 30)->>'code');
  perform pg_temp.put('code2', public.sms_access_create(pg_temp.get('otra')::uuid, 'essential', null)->>'code');
end $$;
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
do $$ declare r jsonb; begin
  perform pg_temp.put('tok', public.sms_access_redeem(pg_temp.get('code'), 'Test')->>'token');
  perform pg_temp.put('tok2', public.sms_access_redeem(pg_temp.get('code2'), 'Test')->>'token');
  r := public.sms_journal_inbox(pg_temp.get('tok'));
  perform pg_temp.ok(r->>'ok' = 'true' and jsonb_array_length(r->'messages') = 0, 'bandeja vacía al inicio');
end $$;

-- El equipo (rol staff) envía; el ajeno no
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', false);
do $$ begin
  begin perform public.sms_journal_message_send(pg_temp.get('stu')::uuid, 'Hola'); raise exception 'FAIL: ajeno';
  exception when insufficient_privilege then raise warning 'PASS: usuario ajeno no envía mensajes'; end;
end $$;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', false);
do $$ declare m jsonb; begin
  m := public.sms_journal_message_send(pg_temp.get('stu')::uuid, E'Hola Mario 👋\nMañana repasamos el pasado simple.');
  perform pg_temp.ok(m->>'body' like E'Hola Mario%\nMañana%' and m->>'delivered_at' is null, 'el equipo envía un mensaje (con saltos de línea)');
  perform pg_temp.put('m1', m->>'id');
  m := public.sms_journal_message_send(pg_temp.get('stu')::uuid, 'Mensaje que voy a retirar');
  perform pg_temp.put('m2', m->>'id');
  perform public.sms_journal_message_send(pg_temp.get('otra')::uuid, 'Mensaje para otra persona');
  begin perform public.sms_journal_message_send(pg_temp.get('stu')::uuid, '   '); raise exception 'FAIL: vacío';
  exception when invalid_parameter_value then raise warning 'PASS: mensaje vacío rechazado'; end;
  perform public.sms_journal_message_withdraw(pg_temp.get('m2')::uuid);
  perform pg_temp.ok((select count(*) from public.sms_activity where student_id = pg_temp.get('stu')::uuid and kind = 'journal') = 3,
                     'enviar y retirar quedan en el historial');
end $$;

-- El journal recibe solo sus mensajes vigentes, sin necesitar "compartir"
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
do $$ declare r jsonb; begin
  r := public.sms_journal_inbox(pg_temp.get('tok'));
  perform pg_temp.ok(r->>'ok' = 'true' and jsonb_array_length(r->'messages') = 1 and r->'messages'->0->>'body' like 'Hola Mario%'
                     and r->'messages'->0->>'read' = 'false', 'el journal recibe su mensaje (el retirado no aparece)');
  perform pg_temp.ok(r->>'sharing' = 'false', 'no hace falta compartir el journal para recibir mensajes');
  r := public.sms_journal_inbox(pg_temp.get('tok2'));
  perform pg_temp.ok(jsonb_array_length(r->'messages') = 1 and r->'messages'->0->>'body' = 'Mensaje para otra persona', 'cada estudiante ve solo los suyos');
  r := public.sms_journal_inbox('x' || repeat('0', 63));
  perform pg_temp.ok(r->>'ok' = 'false' and r->>'state' = 'revoked', 'una llave falsa no recibe nada');
end $$;
reset role;
do $$ begin
  perform pg_temp.ok((select delivered_at is not null and read_at is null from public.sms_journal_messages where id = pg_temp.get('m1')::uuid),
                     'queda marcado como entregado');
  perform pg_temp.ok((select delivered_at is null from public.sms_journal_messages where id = pg_temp.get('m2')::uuid), 'el retirado nunca se entrega');
end $$;
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
do $$ declare r jsonb; begin
  -- Intentar marcar como leído el mensaje de otra persona no tiene efecto
  r := public.sms_journal_inbox(pg_temp.get('tok2'), array[pg_temp.get('m1')::uuid]);
  r := public.sms_journal_inbox(pg_temp.get('tok'), array[pg_temp.get('m1')::uuid]);
  perform pg_temp.ok(r->'messages'->0->>'read' = 'true', 'leído desde el journal');
end $$;
reset role;
do $$ begin
  perform pg_temp.ok((select read_at is not null from public.sms_journal_messages where id = pg_temp.get('m1')::uuid), 'el panel ve la hora de lectura');
end $$;

-- Vencido: sigue recibiendo mensajes; revocado: no
update public.sms_access_codes set valid_until = current_date - 1 where code = pg_temp.get('code');
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
do $$ declare r jsonb; begin
  r := public.sms_journal_inbox(pg_temp.get('tok'));
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'state' = 'expired' and jsonb_array_length(r->'messages') = 1, 'con el acceso vencido sigue recibiendo mensajes');
end $$;
reset role;
update public.sms_access_codes set status = 'revoked' where code = pg_temp.get('code');
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
do $$ declare r jsonb; begin
  r := public.sms_journal_inbox(pg_temp.get('tok'));
  perform pg_temp.ok(r->>'ok' = 'false' and r->>'reason' = 'revoked', 'con el código revocado no recibe mensajes');
end $$;

-- Exportar, respaldar, fusionar y eliminar
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', false);
do $$ declare e jsonb; b jsonb; begin
  e := public.sms_student_export(pg_temp.get('stu')::uuid);
  perform pg_temp.ok(jsonb_array_length(e->'journal_messages') = 1, 'la exportación incluye los mensajes vigentes');
  b := public.sms_backup_export();
  perform pg_temp.ok((b->>'version')::numeric >= 1.3 and jsonb_array_length(b->'journal_messages') >= 3, 'el respaldo incluye los mensajes');
  perform public.sms_merge_students(pg_temp.get('stu')::uuid, pg_temp.get('otra')::uuid);
  perform pg_temp.ok((select count(*) from public.sms_journal_messages where student_id = pg_temp.get('stu')::uuid) = 3, 'fusión: los mensajes pasan a la ficha que queda');
  perform public.sms_anonymize_student(pg_temp.get('stu')::uuid);
  perform pg_temp.ok((select count(*) from public.sms_journal_messages where student_id = pg_temp.get('stu')::uuid) = 0, 'eliminación: mensajes borrados');
end $$;
reset role;

\echo V13_TESTS_PASSED
