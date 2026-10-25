-- =====================================================================
-- Pruebas de la v1.4 (entradas al journal y tablero del profesor).
-- Se ejecutan después de las anteriores sobre la misma base.
-- =====================================================================
\set QUIET on
set client_min_messages = warning;

create or replace function pg_temp.ok(cond boolean, name text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', name; end if;
  raise warning 'PASS: %', name;
end $$;
create temporary table t14 (k text primary key, v text);
grant all on t14 to anon, authenticated;
create or replace function pg_temp.put(k text, v text) returns void language sql as $$
  insert into t14 values (k, v) on conflict (k) do update set v = excluded.v;
$$;
create or replace function pg_temp.get(k text) returns text language sql as $$ select v from t14 where t14.k = $1 $$;

select set_config('request.headers', '{"x-forwarded-for":"200.14.14.14"}', false);
reset role;
delete from public.sms_rate_events where bucket like 'redeem:%';
insert into public.sms_students (full_name, email, status) values
  ('Julia Comparte', 'julia.board@correo.com', 'active'),
  ('Pedro NoComparte', 'pedro.board@correo.com', 'active');
select pg_temp.put('julia', (select id::text from public.sms_students where email = 'julia.board@correo.com'));
select pg_temp.put('pedro', (select id::text from public.sms_students where email = 'pedro.board@correo.com'));

do $$ begin
  perform pg_temp.ok((select relrowsecurity from pg_class where relname = 'sms_journal_visits'), 'RLS activo en entradas');
  perform pg_temp.ok(not has_table_privilege('anon', 'public.sms_journal_visits', 'select'), 'anon no lee entradas');
  perform pg_temp.ok(not has_table_privilege('authenticated', 'public.sms_journal_visits', 'insert'), 'sin escritura directa de entradas');
end $$;

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', false);
do $$ begin
  perform pg_temp.put('cj', public.sms_access_create(pg_temp.get('julia')::uuid, 'mastery', current_date + 30)->>'code');
  perform pg_temp.put('cp', public.sms_access_create(pg_temp.get('pedro')::uuid, 'essential', current_date + 3)->>'code');
end $$;
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
do $$ declare r jsonb; begin
  perform pg_temp.put('tj', public.sms_access_redeem(pg_temp.get('cj'), 'Julia phone')->>'token');
  perform pg_temp.put('tp', public.sms_access_redeem(pg_temp.get('cp'), 'Pedro phone')->>'token');
  perform public.sms_journal_consent(pg_temp.get('tj'), true);
  r := public.sms_journal_sync(pg_temp.get('tj'), '{"streak":5,"completed":[0,1,2,3],"stats":{"stars":4,"classesAttended":6,"secs":1260,"words":900,"samples":7}}');
  perform pg_temp.ok(r->>'ok' = 'true', 'envío con autorización');
  -- Pedro no autoriza: su journal no envía nada (ni entradas)
  r := public.sms_journal_sync(pg_temp.get('tp'), '{"streak":9}');
  perform pg_temp.ok(r->>'reason' = 'no_consent', 'sin autorización no se registra la entrada');
  perform public.sms_journal_inbox(pg_temp.get('tp'));
end $$;
reset role;
do $$ begin
  perform pg_temp.ok((select sessions = 1 and active_seconds = 0 from public.sms_journal_visits where student_id = pg_temp.get('julia')::uuid),
                     'primera entrada del día: 1 sesión');
  perform pg_temp.ok(not exists (select 1 from public.sms_journal_visits where student_id = pg_temp.get('pedro')::uuid),
                     'abrir el journal sin compartir (bandeja de mensajes) no deja rastro de entradas');
end $$;
-- Señal 3 minutos después (misma sesión) y otra 30 minutos después (sesión nueva)
update public.sms_journal_visits set last_at = now() - interval '3 minutes' where student_id = pg_temp.get('julia')::uuid;
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
do $$ begin perform public.sms_journal_sync(pg_temp.get('tj'), '{}'); end $$;
reset role;
do $$ begin
  perform pg_temp.ok((select sessions = 1 and active_seconds between 175 and 190 from public.sms_journal_visits where student_id = pg_temp.get('julia')::uuid),
                     'señal dentro de 7 min suma tiempo activo (~3 min)');
end $$;
update public.sms_journal_visits set last_at = now() - interval '30 minutes' where student_id = pg_temp.get('julia')::uuid;
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
do $$ begin perform public.sms_journal_sync(pg_temp.get('tj'), '{}'); end $$;
reset role;
do $$ begin
  perform pg_temp.ok((select sessions = 2 and active_seconds between 175 and 190 from public.sms_journal_visits where student_id = pg_temp.get('julia')::uuid),
                     'volver después de 30 min cuenta como otra entrada (sin sumar el tiempo ausente)');
end $$;
-- Día anterior para ver la tira de días
insert into public.sms_journal_visits (student_id, day, first_at, last_at, sessions, active_seconds)
values (pg_temp.get('julia')::uuid, public.sms__today() - 1, now() - interval '1 day', now() - interval '1 day' + interval '20 minutes', 1, 1200);

-- Tablero
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', false);
do $$ begin
  begin perform public.sms_journal_board(); raise exception 'FAIL: ajeno';
  exception when insufficient_privilege then raise warning 'PASS: usuario ajeno no ve el tablero'; end;
end $$;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', false);
do $$ declare b jsonb; j jsonb; p jsonb; o jsonb; begin
  b := public.sms_journal_board(14);
  select x into j from jsonb_array_elements(b->'students') x where x->>'student_id' = pg_temp.get('julia');
  select x into p from jsonb_array_elements(b->'students') x where x->>'student_id' = pg_temp.get('pedro');
  perform pg_temp.ok(j is not null and p is not null, 'el equipo ve en el tablero a quienes tienen código');
  perform pg_temp.ok(j->>'sharing' = 'true' and (j->>'missions')::int = 4 and (j->>'streak')::int = 5
                     and (j->'stats'->>'stars')::int = 4 and (j->'stats'->>'minutes_spoken')::int = 21 and j->>'tier' = 'mastery',
                     'progreso de quien comparte: misiones, racha, estrellas, minutos hablados, programa');
  perform pg_temp.ok(jsonb_array_length(j->'visits') = 2 and (j->'visits'->1->>'sessions')::int = 2 and (j->'visits'->0->>'minutes')::int = 20,
                     'entradas por día (hoy 2 sesiones, ayer ~20 min)');
  perform pg_temp.ok(p->>'sharing' = 'false' and p->>'last_seen' is null and p->>'missions' is null and jsonb_array_length(p->'visits') = 0
                     and (p->>'devices')::int = 1, 'quien no comparte: solo su acceso, sin conexión ni progreso');
  perform pg_temp.ok((b->'entries'->0->>'student_id') = pg_temp.get('julia') and (b->'entries'->0->>'sessions')::int = 2,
                     'entradas recientes: la más reciente primero');
  perform pg_temp.ok(not exists (select 1 from jsonb_array_elements(b->'entries') e where e->>'student_id' = pg_temp.get('pedro')),
                     'entradas recientes sin quienes no comparten');
  o := public.sms_journal_overview();
  perform pg_temp.ok((o->>'active_7d')::int >= 1, 'resumen: activos en 7 días');
end $$;

-- Retirar la autorización oculta sus entradas del tablero
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
do $$ begin perform public.sms_journal_consent(pg_temp.get('tj'), false); end $$;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', false);
do $$ declare b jsonb; j jsonb; e jsonb; begin
  b := public.sms_journal_board();
  select x into j from jsonb_array_elements(b->'students') x where x->>'student_id' = pg_temp.get('julia');
  perform pg_temp.ok(j->>'sharing' = 'false' and jsonb_array_length(j->'visits') = 0 and j->>'missions' is null, 'tras retirar la autorización, el tablero ya no muestra sus entradas ni progreso');
  e := public.sms_student_export(pg_temp.get('julia')::uuid);
  perform pg_temp.ok(jsonb_array_length(e->'journal_visits') = 2, 'la exportación de la persona incluye sus entradas');
  perform pg_temp.ok((public.sms_backup_export()->>'version') = '1.4', 'respaldo v1.4');
  perform public.sms_journal_purge(pg_temp.get('julia')::uuid);
  perform pg_temp.ok(not exists (select 1 from public.sms_journal_visits where student_id = pg_temp.get('julia')::uuid), 'borrar datos del journal borra también las entradas');
end $$;
reset role;

\echo V14_TESTS_PASSED
