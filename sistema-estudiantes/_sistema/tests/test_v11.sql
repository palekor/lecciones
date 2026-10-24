-- =====================================================================
-- Pruebas de la v1.1 (especificación completa). Se ejecutan después de
-- test_schema.sql sobre la misma base (usa sus usuarios de prueba).
-- =====================================================================
\set QUIET on
set client_min_messages = warning;

create or replace function pg_temp.ok(cond boolean, name text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', name; end if;
  raise warning 'PASS: %', name;
end $$;

create or replace function pg_temp.as_owner() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', false);
$$;
create or replace function pg_temp.as_staff() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', false);
$$;

select set_config('request.headers', '{"x-forwarded-for":"191.4.4.4"}', false);

-- ---------------------------------------------------------- público
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
do $$ declare c jsonb; r jsonb; begin
  c := public.sms_public_config();
  perform pg_temp.ok(jsonb_array_length(c->'session_types') = 3
                     and not (c->'session_types')::text like '%"other"%', 'tipos de sesión públicos en la configuración');
  perform pg_temp.ok(c->>'cancellation_policy' like 'Puedes cancelar%', 'política de cancelación pública');

  r := public.sms_register(jsonb_build_object(
    'client_key', gen_random_uuid(), 'elapsed_ms', 5000, 'full_name', 'Gabriela Soto', 'email', 'gabi@correo.com',
    'whatsapp', '+51987654321', 'country', 'PE', 'english_level', 'elementary', 'objective', 'interviews',
    'preferred_format', 'individual', 'preferred_contact', 'email', 'availability', '{"days":["tue"],"times":["morning"]}'::jsonb,
    'occupation', 'Ingeniera de datos', 'urgency', 'asap', 'timezone', 'America/Lima',
    'consent_privacy', true, 'notice_version', '2026-10-23', 'extra', '{"en_que_empresa_trabajas":"x","empresa":"Acme"}'::jsonb));
  perform pg_temp.ok(r->>'ok' = 'true', 'registro con ocupación, urgencia y zona horaria');

  r := public.sms_register(jsonb_build_object(
    'client_key', gen_random_uuid(), 'elapsed_ms', 5000, 'full_name', 'Hugo Paz', 'email', 'hugo@correo.com',
    'whatsapp', '+51911111111', 'country', 'PE', 'english_level', 'elementary', 'objective', 'travel',
    'preferred_format', 'individual', 'preferred_contact', 'whatsapp', 'availability', '{"notes":"noches"}'::jsonb,
    'urgency', 'mañana', 'consent_privacy', true, 'notice_version', '2026-10-23', 'extra', '{"empresa":"Acme"}'::jsonb));
  perform pg_temp.ok(r->'errors'->>'urgency' = 'invalid', 'urgencia inválida rechazada');

  r := public.sms_register(jsonb_build_object(
    'client_key', gen_random_uuid(), 'elapsed_ms', 5000, 'full_name', 'Hugo Paz', 'email', 'hugo@correo.com',
    'whatsapp', '+51911111111', 'country', 'PE', 'english_level', 'elementary', 'objective', 'travel',
    'preferred_format', 'individual', 'preferred_contact', 'whatsapp', 'availability', '{"notes":"noches"}'::jsonb,
    'timezone', 'Marte/Olympus', 'consent_privacy', true, 'notice_version', '2026-10-23', 'extra', '{"empresa":"Acme"}'::jsonb));
  perform pg_temp.ok(r->>'ok' = 'true', 'zona horaria desconocida no bloquea el registro');
end $$;
reset role;
do $$ begin
  perform pg_temp.ok((select occupation || '|' || urgency || '|' || timezone from public.sms_students where email = 'gabi@correo.com')
                     = 'Ingeniera de datos|asap|America/Lima', 'ocupación, urgencia y zona horaria guardadas');
  perform pg_temp.ok((select l.urgency from public.sms_leads l join public.sms_students s on s.id = l.student_id where s.email = 'gabi@correo.com') = 'asap',
                     'urgencia también en el lead');
  perform pg_temp.ok((select timezone is null from public.sms_students where email = 'hugo@correo.com'), 'zona horaria inválida se descarta');
end $$;

-- ---------------------------------------------------------- horarios con pausa y tipos
begin;
update public.sms_availability_rules set active = false;
insert into public.sms_availability_rules (weekday, start_time, end_time, slot_minutes, buffer_minutes, session_type, active)
values (extract(isodow from (now() at time zone 'America/Bogota')::date + 10)::int, '08:00', '12:00', 60, 15, 'diagnostic', true),
       (extract(isodow from (now() at time zone 'America/Bogota')::date + 10)::int, '14:00', '15:00', 30, 0, 'other', true);
do $$ declare d date := (now() at time zone 'America/Bogota')::date + 10; times text; pub jsonb; adm int; begin
  select string_agg(to_char(starts_at at time zone 'America/Bogota', 'HH24:MI'), ',' order by starts_at) into times
    from public.sms__slots((d::timestamp) at time zone 'America/Bogota', ((d + 1)::timestamp) at time zone 'America/Bogota')
   where session_type = 'diagnostic';
  perform pg_temp.ok(times = '08:00,09:15,10:30', 'pausa de 15 min entre sesiones (' || times || ')');
  pub := public.sms_public_slots(d, 1);
  perform pg_temp.ok(not (pub::text like '%"other"%'), 'tipos no públicos no aparecen en /reservar');
  select count(*) into adm from public.sms__slots((d::timestamp) at time zone 'America/Bogota', ((d + 1)::timestamp) at time zone 'America/Bogota')
   where session_type = 'other';
  perform pg_temp.ok(adm = 2, 'el panel sí ve los horarios internos');
  update public.sms_session_types set active = false where code = 'diagnostic';
  perform pg_temp.ok(not exists (select 1 from public.sms__slots((d::timestamp) at time zone 'America/Bogota', ((d + 1)::timestamp) at time zone 'America/Bogota')
                                 where session_type = 'diagnostic'), 'tipo desactivado deja de ofrecer horarios');
  begin
    insert into public.sms_bookings (student_id, starts_at, ends_at, session_type)
    values ((select id from public.sms_students limit 1), now() + interval '40 days', now() + interval '40 days 1 hour', 'inventado');
    raise exception 'FAIL: tipo inexistente aceptado';
  exception when foreign_key_violation then raise warning 'PASS: solo tipos de sesión configurados'; end;
end $$;
rollback;

-- Reserva pública filtrando por tipo
select set_config('request.headers', '{"x-forwarded-for":"191.5.5.5"}', false);
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
do $$ declare s jsonb; r jsonb; begin
  s := public.sms_public_slots(null, 14);
  r := public.sms_request_booking(jsonb_build_object('client_key', gen_random_uuid(), 'elapsed_ms', 4000,
        'slot_start', s->'slots'->0->>'start', 'session_type', 'class', 'full_name', 'Iris Leal', 'email', 'iris@correo.com',
        'whatsapp', '+573015550303', 'country', 'CO', 'consent_privacy', true, 'notice_version', '2026-10-23'));
  perform pg_temp.ok(r->'errors'->>'slot' = 'unavailable', 'el tipo pedido debe coincidir con el horario');
end $$;
reset role;

-- ---------------------------------------------------------- estados nuevos y cola de mensajes
do $$ declare sid uuid; lid uuid; bid uuid; o record; n int; begin
  select s.id, l.id into sid, lid from public.sms_students s join public.sms_leads l on l.student_id = s.id where s.email = 'gabi@correo.com';
  update public.sms_leads set status = 'awaiting_response' where id = lid;
  perform pg_temp.ok((select last_contact_at is not null from public.sms_leads where id = lid), '"Pendiente de respuesta" registra último contacto');

  insert into public.sms_bookings (student_id, starts_at, ends_at, status, session_type, meeting_url)
  values (sid, now() + interval '30 days', now() + interval '30 days 1 hour', 'requested', 'diagnostic', 'https://meet.google.com/abc-defg-hij')
  returning id into bid;
  perform pg_temp.ok(not exists (select 1 from public.sms_outbox where booking_id = bid), 'una solicitud no genera mensaje de confirmación');

  update public.sms_bookings set status = 'confirmed' where id = bid;
  perform pg_temp.ok((select status from public.sms_leads where id = lid) = 'booking_confirmed', 'confirmar la sesión mueve el lead a "Reserva confirmada"');
  select * into o from public.sms_outbox where booking_id = bid and kind = 'booking_confirmed';
  perform pg_temp.ok(o.channel = 'email' and o.recipient = 'gabi@correo.com' and o.body like 'Hola Gabriela,%'
                     and o.body like '%America/Lima%' and o.body like '%meet.google.com%', 'mensaje de confirmación en el canal y zona de la persona');

  update public.sms_bookings set starts_at = starts_at + interval '1 day', ends_at = ends_at + interval '1 day' where id = bid;
  perform pg_temp.ok((select count(*) from public.sms_outbox where booking_id = bid and kind = 'booking_rescheduled' and status = 'pending') = 1
                     and (select status from public.sms_outbox where id = o.id) = 'skipped', 'reprogramar reemplaza el mensaje anterior');

  update public.sms_bookings set status = 'cancelled' where id = bid;
  perform pg_temp.ok((select count(*) from public.sms_outbox where booking_id = bid and status = 'pending') = 1
                     and exists (select 1 from public.sms_outbox where booking_id = bid and kind = 'booking_cancelled' and status = 'pending'),
                     'cancelar deja solo el aviso de cancelación pendiente');

  insert into public.sms_bookings (student_id, starts_at, ends_at, status, session_type)
  values (sid, now() + interval '5 hours', now() + interval '6 hours', 'confirmed', 'class') returning id into bid;
  n := public.sms__enqueue_reminders();
  n := public.sms__enqueue_reminders();
  perform pg_temp.ok((select count(*) from public.sms_outbox where booking_id = bid and kind = 'booking_reminder') = 1, 'recordatorio de 24 h, una sola vez');
end $$;

-- ---------------------------------------------------------- panel: cola, tareas, evaluaciones, alta manual
set role authenticated;
select pg_temp.as_staff();
do $$ declare oid uuid; pend int; sid uuid; tid uuid; r jsonb; d jsonb; begin
  pend := public.sms_outbox_refresh();
  perform pg_temp.ok(pend >= 2, 'el equipo ve los mensajes pendientes (' || pend || ')');
  select id into oid from public.sms_outbox where status = 'pending' and kind = 'booking_reminder' limit 1;
  perform public.sms_outbox_mark(oid, 'sent');
  perform pg_temp.ok((select status from public.sms_outbox where id = oid) = 'sent'
                     and exists (select 1 from public.sms_activity where kind = 'message' and data->>'outbox_id' = oid::text), 'mensaje marcado como enviado y registrado');
  begin
    update public.sms_outbox set status = 'sent' where status = 'pending';
    raise exception 'FAIL: la cola se editó directamente';
  exception when insufficient_privilege then raise warning 'PASS: la cola no se edita directamente'; end;

  select id into sid from public.sms_students where email = 'gabi@correo.com';
  insert into public.sms_tasks (student_id, kind, title, due_at) values (sid, 'contact', 'Llamar a Gabriela', now() - interval '1 hour') returning id into tid;
  insert into public.sms_tasks (student_id, kind, title, due_at) values (sid, 'assessment', 'Evaluar speaking', now() + interval '3 days');
  d := public.sms_dashboard();
  perform pg_temp.ok((d->>'tasks_overdue')::int = 1 and jsonb_array_length(d->'tasks') = 1, 'tareas vencidas en el panel');
  perform pg_temp.ok((select open_tasks from public.sms_students_v where id = sid) = 2, 'tareas abiertas en la ficha');
  update public.sms_tasks set status = 'done' where id = tid;
  perform pg_temp.ok((select completed_at is not null from public.sms_tasks where id = tid)
                     and exists (select 1 from public.sms_activity where student_id = sid and summary like 'Tarea completada%'), 'tarea completada y auditada');

  insert into public.sms_assessments (student_id, skill, assessed_on, criterion, result, score)
  values (sid, 'speaking', current_date - 30, 'Rúbrica de fluidez 1-5', '2/5', 40),
         (sid, 'speaking', current_date, 'Rúbrica de fluidez 1-5', '3/5', 60),
         (sid, 'listening', current_date, 'Dictado nivel A2', '8/10', 80);
  perform pg_temp.ok((select count(distinct skill) from public.sms_assessments where student_id = sid) = 2
                     and (select count(*) from public.sms_activity where student_id = sid and kind = 'assessment') = 3, 'evaluaciones por habilidad con historial');
  begin
    insert into public.sms_assessments (student_id, skill, criterion, result) values (sid, 'global', 'x', 'y');
    raise exception 'FAIL';
  exception when check_violation then raise warning 'PASS: no existe una nota "global" única'; end;

  r := public.sms_admin_create_contact('{"full_name":"Julián Cruz","email":"julian@correo.com","whatsapp":"+57 310 999 8888","country":"co","objective":"professional","lead_status":"contacted","note":"Llegó por recomendación de Ana"}');
  perform pg_temp.ok(r->>'ok' = 'true', 'alta manual de un contacto desde el panel');
  perform pg_temp.ok((select l.status from public.sms_leads l where l.id = (r->>'lead_id')::uuid) = 'contacted'
                     and (select source from public.sms_students where id = (r->>'student_id')::uuid) = 'panel'
                     and exists (select 1 from public.sms_activity where student_id = (r->>'student_id')::uuid and kind = 'note'), 'alta manual con lead, fuente y nota');
  r := public.sms_admin_create_contact('{"full_name":"Otro Julián","email":"JULIAN@correo.com"}');
  perform pg_temp.ok(r->'errors'->>'email' = 'duplicate' and r ? 'student_id', 'alta manual detecta el duplicado y enlaza la ficha existente');
  r := public.sms_admin_create_contact('{"full_name":"X","email":"malo"}');
  perform pg_temp.ok(r->'errors' ?& array['full_name','email'], 'alta manual valida los datos');

  begin perform public.sms_backup_export(); raise exception 'FAIL';
  exception when insufficient_privilege then raise warning 'PASS: el equipo no descarga el respaldo completo'; end;
  perform pg_temp.ok(public.sms_dashboard()->'agreed_active' = 'null'::jsonb, 'el equipo no ve importes acordados');
end $$;

-- Usuario ajeno: sin acceso a lo nuevo
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', false);
do $$ begin
  perform pg_temp.ok((select count(*) from public.sms_tasks) = 0 and (select count(*) from public.sms_assessments) = 0
                     and (select count(*) from public.sms_outbox) = 0, 'RLS: usuario ajeno no ve tareas, evaluaciones ni mensajes');
  begin perform public.sms_admin_create_contact('{"full_name":"Hack Er","email":"h@x.co"}'); raise exception 'FAIL';
  exception when insufficient_privilege then raise warning 'PASS: usuario ajeno no crea contactos'; end;
  begin perform public.sms_outbox_refresh(); raise exception 'FAIL';
  exception when insufficient_privilege then raise warning 'PASS: usuario ajeno no accede a la cola'; end;
end $$;
reset role;
set role anon;
do $$ begin
  begin perform count(*) from public.sms_tasks_v; raise exception 'FAIL';
  exception when insufficient_privilege then raise warning 'PASS: anon no lee tareas'; end;
end $$;
reset role;

-- Dueño: respaldo, ajustes nuevos, comercial
set role authenticated;
select pg_temp.as_owner();
do $$ declare b jsonb; sid uuid; d jsonb; begin
  b := public.sms_backup_export();
  perform pg_temp.ok(b->>'format' = 'profgermandario-sms-backup' and jsonb_array_length(b->'students') > 5
                     and not (b ? 'secrets') and not (b::text like '%ip_salt%'), 'respaldo completo sin secretos');
  perform public.sms_update_settings('{"status_labels":{"lead":{"waitlist":"En fila"}},"cancellation_policy":"Avisa con 12 horas."}');
  perform pg_temp.ok((public.sms_public_config()->>'cancellation_policy') = 'Avisa con 12 horas.', 'política de cancelación configurable');
  begin perform public.sms_update_settings('{"status_labels":{"lead":{"waitlist":""}}}'); raise exception 'FAIL';
  exception when invalid_parameter_value then raise warning 'PASS: nombres de estado validados'; end;
  begin perform public.sms_update_settings('{"status_labels":{"pagos":{"x":"y"}}}'); raise exception 'FAIL';
  exception when invalid_parameter_value then raise warning 'PASS: solo estados de leads y estudiantes'; end;

  select id into sid from public.sms_students where email = 'gabi@correo.com';
  update public.sms_students set status = 'active', agreed_price = 140, agreed_currency = 'USD', contracted_at = current_date,
         level_initial = 'a2', level_current = 'b1', skills_focus = array['speaking','listening'], next_goals = 'Entrevista en inglés'
   where id = sid;
  begin
    update public.sms_students set skills_focus = array['magia'] where id = sid;
    raise exception 'FAIL';
  exception when check_violation then raise warning 'PASS: habilidades limitadas a la lista definida'; end;
  insert into public.sms_payments (student_id, concept, amount, currency, status, due_date) values (sid, 'Impulso — diciembre', 140, 'USD', 'pending', current_date + 10);
  d := public.sms_dashboard();
  perform pg_temp.ok((d->'agreed_active'->>'USD')::numeric >= 140 and (d->'billed_pending'->>'USD')::numeric >= 140,
                     'acordado y facturado pendiente separados de lo recibido');
  perform pg_temp.ok((d->>'total_prospects')::int >= 1 and d ? 'sessions_completed_30d' and (d->>'outbox_pending')::int >= 0, 'indicadores nuevos en el panel');

  update public.sms_leads set registered_at = now() - interval '3 days', status = 'new', last_contact_at = null
   where student_id = (select id from public.sms_students where email = 'hugo@correo.com');
  perform pg_temp.ok((select needs_attention from public.sms_leads_v where email = 'hugo@correo.com'), 'lead sin contacto en 48 h necesita atención');

  perform public.sms_anonymize_student(sid);
  perform pg_temp.ok((select occupation is null and timezone is null and next_goals is null from public.sms_students where id = sid)
                     and not exists (select 1 from public.sms_outbox where student_id = sid), 'supresión incluye los datos nuevos');
end $$;
reset role;

\echo V11_TESTS_PASSED
