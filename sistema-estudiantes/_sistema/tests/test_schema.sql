-- =====================================================================
-- Pruebas del esquema SMS sobre Postgres + stub de Supabase.
-- Ejecutar: psql -v ON_ERROR_STOP=1 -f test_schema.sql
-- Cada bloque lanza una excepción si algo falla; al final imprime ALL_TESTS_PASSED.
-- =====================================================================
\set QUIET on
set client_min_messages = warning;

create or replace function pg_temp.ok(cond boolean, name text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', name; end if;
  raise warning 'PASS: %', name;
end $$;

create or replace function pg_temp.payload(p_email text, p_name text, p_phone text, p_key uuid default gen_random_uuid())
returns jsonb language sql as $$
  select jsonb_build_object(
    'client_key', p_key, 'elapsed_ms', 6000, 'website', '',
    'full_name', p_name, 'email', p_email, 'whatsapp', p_phone, 'country', 'co',
    'english_level', 'intermediate', 'objective', 'professional', 'preferred_format', 'individual',
    'availability', jsonb_build_object('days', jsonb_build_array('mon','wed','xxx'), 'times', jsonb_build_array('evening'), 'tz', 'America/Bogota'),
    'preferred_contact', 'whatsapp', 'comments', 'Quiero hablar en reuniones',
    'consent_privacy', true, 'consent_marketing', false,
    'notice_version', '2026-10-23')
$$;

-- Cabeceras HTTP simuladas (IP del visitante)
select set_config('request.headers', '{"x-forwarded-for":"190.1.1.1"}', false);

-- ---------------------------------------------------------------- anon
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);

do $$ begin
  begin perform count(*) from public.sms_students; raise exception 'FAIL: anon leyó sms_students';
  exception when insufficient_privilege then raise warning 'PASS: anon no puede leer sms_students'; end;
  begin perform count(*) from public.sms_leads_v; raise exception 'FAIL: anon leyó sms_leads_v';
  exception when insufficient_privilege then raise warning 'PASS: anon no puede leer vistas'; end;
  begin perform count(*) from public.sms_submissions; raise exception 'FAIL: anon leyó submissions';
  exception when insufficient_privilege then raise warning 'PASS: anon no puede leer submissions'; end;
  begin perform public.sms_dashboard(); raise exception 'FAIL: anon ejecutó dashboard';
  exception when insufficient_privilege then raise warning 'PASS: anon no ejecuta funciones del panel'; end;
  begin perform public.sms__intake('{}'::jsonb, 'register', null); raise exception 'FAIL: anon ejecutó función interna';
  exception when insufficient_privilege then raise warning 'PASS: anon no ejecuta funciones internas'; end;
  begin insert into public.sms_students(full_name, email) values ('X Y', 'x@y.co'); raise exception 'FAIL: anon insertó';
  exception when insufficient_privilege then raise warning 'PASS: anon no inserta directo'; end;
end $$;

do $$ declare r jsonb; begin
  -- Config pública sin datos internos
  r := public.sms_public_config();
  perform pg_temp.ok(r ? 'privacy_notice_version' and not (r ? 'wa_templates') and not (r ? 'ip_salt'), 'config pública sin datos internos');

  -- Validación: todo vacío
  r := public.sms_register(jsonb_build_object('client_key', gen_random_uuid(), 'elapsed_ms', 5000));
  perform pg_temp.ok(r->>'ok' = 'false' and r->'errors' ?& array['full_name','email','whatsapp','country','english_level',
          'objective','preferred_format','availability','preferred_contact','consent_privacy'], 'campos requeridos');

  -- Formatos inválidos
  r := public.sms_register(pg_temp.payload('correo-malo', 'Ana 123', '3001234', gen_random_uuid()) || '{"country":"Colombia","objective":"foo"}');
  perform pg_temp.ok(r->'errors'->>'email' = 'format' and r->'errors'->>'full_name' = 'format'
          and r->'errors'->>'whatsapp' = 'format' and r->'errors'->>'country' = 'invalid'
          and r->'errors'->>'objective' = 'invalid', 'formatos inválidos detectados');

  -- Objetivo "otro" exige detalle
  r := public.sms_register(pg_temp.payload('a@b.co', 'Ana Pérez', '+573001112233') || '{"objective":"other"}');
  perform pg_temp.ok(r->'errors'->>'objective_other' = 'required', 'objetivo otro requiere detalle');

  -- Consentimiento obligatorio y versión vigente
  r := public.sms_register(pg_temp.payload('a@b.co', 'Ana Pérez', '+573001112233') || '{"consent_privacy":false}');
  perform pg_temp.ok(r->'errors'->>'consent_privacy' = 'required', 'consentimiento obligatorio');
  r := public.sms_register(pg_temp.payload('a@b.co', 'Ana Pérez', '+573001112233') || '{"notice_version":"2001-01-01"}');
  perform pg_temp.ok(r->'errors'->>'consent_privacy' = 'outdated', 'versión del aviso desactualizada');

  -- Demasiado rápido (bot)
  r := public.sms_register(pg_temp.payload('a@b.co', 'Ana Pérez', '+573001112233') || '{"elapsed_ms":300}');
  perform pg_temp.ok(r->'errors'->>'form' = 'too_fast', 'envío demasiado rápido bloqueado');

  -- Disponibilidad vacía
  r := public.sms_register(pg_temp.payload('a@b.co', 'Ana Pérez', '+573001112233') || '{"availability":{"days":[],"times":[]}}');
  perform pg_temp.ok(r->'errors'->>'availability' = 'required', 'disponibilidad requerida');
end $$;

reset role;
do $$ begin
  perform pg_temp.ok((select count(*) from public.sms_students) = 0, 'errores de validación no escriben nada');
end $$;
set role anon;

-- Honeypot
do $$ declare r jsonb; begin
  r := public.sms_register(pg_temp.payload('bot@spam.co', 'Bot Spam', '+15550001111') || '{"website":"http://spam"}');
  perform pg_temp.ok(r->>'ok' = 'true', 'honeypot responde éxito falso');
end $$;
reset role;
do $$ begin
  perform pg_temp.ok((select count(*) from public.sms_students) = 0 and (select count(*) from public.sms_submissions) = 0,
                     'honeypot no guarda nada');
end $$;

-- ------------------------------------------------------- registro OK
set role anon;
do $$ declare r jsonb; r2 jsonb; k uuid := 'aaaaaaaa-0000-4000-8000-000000000001'; begin
  r := public.sms_register(pg_temp.payload('  Ana.Perez@Gmail.COM ', '  Ana   María  Pérez ', '+57 (300) 111-2233', k));
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'first_name' = 'Ana' and (r->>'ref') is not null, 'registro exitoso');
  perform pg_temp.ok((r->'next'->>'waitlist')::boolean and (r->'next'->>'booking')::boolean, 'siguiente paso ofrecido');
  -- reintento idéntico (doble clic / red)
  r2 := public.sms_register(pg_temp.payload('ana.perez@gmail.com', 'Ana María Pérez', '+573001112233', k));
  perform pg_temp.ok(r2->>'ref' = r->>'ref', 'idempotencia: mismo client_key devuelve el mismo resultado');
end $$;
reset role;

do $$ declare s record; begin
  perform pg_temp.ok((select count(*) from public.sms_students) = 1, 'un solo estudiante tras reintento');
  select * into s from public.sms_students;
  perform pg_temp.ok(s.email = 'ana.perez@gmail.com' and s.whatsapp = '+573001112233' and s.country = 'CO'
                     and s.full_name = 'Ana María Pérez', 'normalización de correo, teléfono, país y nombre');
  perform pg_temp.ok(s.availability->'days' = '["mon","wed"]'::jsonb, 'disponibilidad limpia (descarta valores desconocidos)');
  perform pg_temp.ok(s.consent_privacy and s.consent_notice_version = '2026-10-23' and s.consent_privacy_at is not null
                     and not s.consent_marketing, 'consentimiento registrado con versión y fecha');
  perform pg_temp.ok((select count(*) from public.sms_consents where student_id = s.id) = 2, 'bitácora de consentimientos (privacidad + marketing)');
  perform pg_temp.ok((select count(*) from public.sms_leads where student_id = s.id and status = 'new') = 1, 'lead creado en estado Nuevo');
  perform pg_temp.ok((select count(*) from public.sms_notifications where kind = 'register') = 1, 'notificación al administrador');
  perform pg_temp.ok((select count(*) from public.sms_activity where student_id = s.id and kind = 'intake') = 1, 'historial de registro');
  perform pg_temp.ok((select ip_hash from public.sms_consents limit 1) ~ '^[0-9a-f]{64}$', 'IP guardada solo como hash');
end $$;

-- Mismo correo, nuevo envío con datos distintos: no se sobrescribe la identidad
set role anon;
do $$ declare r jsonb; begin
  r := public.sms_register(pg_temp.payload('ana.perez@gmail.com', 'Impostor Total', '+573009999999'));
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'first_name' = 'Impostor', 'respuesta genérica (no revela si ya existía)');
end $$;
reset role;
do $$ declare s record; begin
  select * into s from public.sms_students where email = 'ana.perez@gmail.com';
  perform pg_temp.ok((select count(*) from public.sms_students) = 1, 'sin duplicado por correo');
  perform pg_temp.ok(s.full_name = 'Ana María Pérez' and s.whatsapp = '+573001112233', 'identidad no sobrescrita desde formulario público');
  perform pg_temp.ok(s.needs_review, 'diferencias marcadas para revisión');
  perform pg_temp.ok((select count(*) from public.sms_leads where student_id = s.id) = 1, 'sin lead duplicado');
end $$;

-- Mismo WhatsApp, otro correo → posible duplicado
set role anon;
do $$ declare r jsonb; begin
  r := public.sms_register(pg_temp.payload('ana.trabajo@empresa.com', 'Ana Pérez', '0057 300 111 2233'));
  perform pg_temp.ok(r->>'ok' = 'true', 'registro con WhatsApp repetido');
end $$;
reset role;
do $$ begin
  perform pg_temp.ok((select possible_duplicate_of from public.sms_students where email = 'ana.trabajo@empresa.com')
                     = (select id from public.sms_students where email = 'ana.perez@gmail.com'), 'posible duplicado detectado por WhatsApp');
end $$;

-- ------------------------------------------------------- lista de espera
set role anon;
do $$ declare r jsonb; ref text; w jsonb; w2 jsonb; begin
  r := public.sms_register(pg_temp.payload('beto@correo.com', 'Beto Gómez', '+525512345678'));
  ref := r->>'ref';
  w := public.sms_join_waitlist(jsonb_build_object('ref', ref, 'client_key', gen_random_uuid()));
  perform pg_temp.ok(w->>'ok' = 'true' and w->>'state' = 'waitlist' and (w->>'position')::int = 1, 'unirse a lista con ref (posición 1)');
  w2 := public.sms_join_waitlist(jsonb_build_object('ref', gen_random_uuid(), 'client_key', gen_random_uuid()));
  perform pg_temp.ok(w2->'errors'->>'ref' = 'invalid', 'ref inexistente rechazado');
  -- Formulario dedicado (sin registro previo): solo lo necesario
  w := public.sms_join_waitlist(jsonb_build_object('client_key', gen_random_uuid(), 'elapsed_ms', 4000,
        'full_name', 'Carla Ruiz', 'email', 'carla@correo.com', 'whatsapp', '+34600111222', 'country', 'ES',
        'objective', 'travel', 'preferred_format', 'self_study',
        'availability', jsonb_build_object('notes', 'Fines de semana'),
        'consent_privacy', true, 'notice_version', '2026-10-23'));
  perform pg_temp.ok(w->>'ok' = 'true' and (w->>'position')::int = 2, 'formulario dedicado de lista (posición 2)');
end $$;
reset role;
do $$ declare carla uuid; begin
  perform pg_temp.ok((select english_level from public.sms_students where email = 'carla@correo.com') is null,
                     'lista de espera no exige datos innecesarios');
  -- Prioridad manual reordena de forma transparente
  update public.sms_leads set priority_boost = 10
   where student_id = (select id from public.sms_students where email = 'carla@correo.com') returning student_id into carla;
  perform pg_temp.ok((select waitlist_position from public.sms_leads_v where student_id = carla) = 1, 'prioridad manual reordena la lista');
  perform pg_temp.ok((select count(*) from public.sms_activity where student_id = carla and summary like 'Prioridad manual%') = 1,
                     'cambio de prioridad auditado');
  update public.sms_leads set priority_boost = 0 where student_id = carla;
end $$;

-- ------------------------------------------------------- reservas
reset role;
insert into public.sms_availability_rules (weekday, start_time, end_time, slot_minutes, session_type, active)
select d, '08:00', '12:00', 60, 'diagnostic', true from generate_series(1, 7) d;
insert into public.sms_availability_exceptions (on_date, kind)
values (((now() at time zone 'America/Bogota')::date + 3), 'block');

select set_config('request.headers', '{"x-forwarded-for":"190.2.2.2"}', false);
set role anon;
do $$ declare s jsonb; n int; first_slot text; r jsonb; r2 jsonb; blocked date := ((now() at time zone 'America/Bogota')::date + 3);
              ref text;
begin
  s := public.sms_public_slots(null, 7);
  n := jsonb_array_length(s->'slots');
  perform pg_temp.ok(s->>'enabled' = 'true' and n between 20 and 32, 'horarios públicos generados (' || n || ')');
  perform pg_temp.ok(not exists (select 1 from jsonb_array_elements(s->'slots') x
                                 where ((x->>'start')::timestamptz at time zone 'America/Bogota')::date = blocked), 'día bloqueado excluido');
  perform pg_temp.ok(not exists (select 1 from jsonb_array_elements(s->'slots') x
                                 where (x->>'start')::timestamptz < now() + interval '12 hours'), 'antelación mínima respetada');
  perform pg_temp.ok(not (s::text ~ '@'), 'horarios sin datos personales');
  first_slot := s->'slots'->0->>'start';

  -- Reserva sin registro previo (datos mínimos)
  r := public.sms_request_booking(jsonb_build_object('client_key', gen_random_uuid(), 'elapsed_ms', 4000,
        'slot_start', first_slot, 'full_name', 'Diego Mora', 'email', 'diego@correo.com',
        'whatsapp', '+5491155554444', 'country', 'AR', 'message', 'Quiero preparar una entrevista',
        'consent_privacy', true, 'notice_version', '2026-10-23'));
  perform pg_temp.ok(r->>'ok' = 'true' and r->'booking'->>'status' = 'requested', 'solicitud de reserva creada');

  -- Mismo horario por otra persona → ya no está disponible
  r2 := public.sms_request_booking(jsonb_build_object('client_key', gen_random_uuid(), 'elapsed_ms', 4000,
        'slot_start', first_slot, 'full_name', 'Eva Lin', 'email', 'eva@correo.com',
        'whatsapp', '+13055550100', 'country', 'US', 'consent_privacy', true, 'notice_version', '2026-10-23'));
  perform pg_temp.ok(r2->'errors'->>'slot' = 'unavailable', 'sin doble reserva del mismo horario');

  -- Horario arbitrario (no ofrecido)
  r2 := public.sms_request_booking(jsonb_build_object('client_key', gen_random_uuid(), 'elapsed_ms', 4000,
        'slot_start', (now() + interval '2 days')::text, 'full_name', 'Eva Lin', 'email', 'eva@correo.com',
        'whatsapp', '+13055550100', 'country', 'US', 'consent_privacy', true, 'notice_version', '2026-10-23'));
  perform pg_temp.ok(r2->'errors'->>'slot' = 'unavailable', 'horarios arbitrarios rechazados');

  -- Con ref y límite de solicitudes pendientes (2)
  ref := r->>'ref';
  r2 := public.sms_request_booking(jsonb_build_object('client_key', gen_random_uuid(), 'ref', ref, 'slot_start', s->'slots'->1->>'start'));
  perform pg_temp.ok(r2->>'ok' = 'true', 'segunda solicitud con ref');
  r2 := public.sms_request_booking(jsonb_build_object('client_key', gen_random_uuid(), 'ref', r2->>'ref', 'slot_start', s->'slots'->2->>'start'));
  perform pg_temp.ok(r2->'errors'->>'slot' = 'too_many_pending', 'límite de solicitudes pendientes por persona');

  s := public.sms_public_slots(null, 7);
  perform pg_temp.ok(jsonb_array_length(s->'slots') = n - 2, 'horarios reservados desaparecen de la oferta');
end $$;
reset role;
do $$ declare d uuid; b record; begin
  select id into d from public.sms_students where email = 'diego@correo.com';
  perform pg_temp.ok((select status from public.sms_leads where student_id = d) = 'booking_requested', 'lead pasa a Reserva solicitada');
  perform pg_temp.ok((select count(*) from public.sms_bookings where student_id = d and lead_id is not null) = 2, 'reservas ligadas al lead');
  select * into b from public.sms_bookings where student_id = d order by starts_at limit 1;
  begin
    insert into public.sms_bookings (student_id, starts_at, ends_at, status)
    values (d, b.starts_at + interval '30 minutes', b.ends_at + interval '30 minutes', 'confirmed');
    raise exception 'FAIL: se permitió solapamiento';
  exception when exclusion_violation then raise warning 'PASS: restricción anti-solapamiento en la base de datos';
  end;
  -- Cancelada libera el horario
  update public.sms_bookings set status = 'cancelled' where id = b.id;
  insert into public.sms_bookings (student_id, starts_at, ends_at, status) values (d, b.starts_at, b.ends_at, 'confirmed');
  perform pg_temp.ok(true, 'horario cancelado se puede volver a usar');
end $$;

-- Límite de frecuencia por IP
select set_config('request.headers', '{"x-forwarded-for":"200.9.9.9"}', false);
set role anon;
do $$ declare r jsonb; n int := 0; blocked_at int; begin
  for i in 1..12 loop
    r := public.sms_register(pg_temp.payload('spam' || i || '@correo.com', 'Persona Prueba', '+5730055500' || lpad(i::text, 2, '0')));
    if r->'errors'->>'form' = 'rate_limited' then blocked_at := i; exit; end if;
    n := n + 1;
  end loop;
  perform pg_temp.ok(blocked_at = 11 and n = 10, 'límite de frecuencia por IP (10 / 10 min)');
end $$;
reset role;
select set_config('request.headers', '{"x-forwarded-for":"190.1.1.1"}', false);

-- ------------------------------------------------------- panel / RLS
reset role;
insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-4111-8111-111111111111', 'profgermandario@gmail.com', now()),
  ('22222222-2222-4222-8222-222222222222', 'intruso@correo.com', now()),
  ('33333333-3333-4333-8333-333333333333', 'asistente@correo.com', now());
insert into public.sms_staff_invites (email, role, display_name) values ('asistente@correo.com', 'staff', 'Asistente');

-- Usuario autenticado que NO es del equipo
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', false);
do $$ declare w jsonb; begin
  w := public.sms_whoami();
  perform pg_temp.ok(w->>'signed_in' = 'true' and w->'staff' = 'null'::jsonb, 'usuario sin invitación no es staff');
  perform pg_temp.ok((select count(*) from public.sms_students) = 0 and (select count(*) from public.sms_leads_v) = 0,
                     'RLS: usuario ajeno no ve estudiantes');
  begin perform public.sms_dashboard(); raise exception 'FAIL';
  exception when insufficient_privilege then raise warning 'PASS: usuario ajeno no accede al dashboard'; end;
  update public.sms_students set full_name = 'Hackeado';
  perform pg_temp.ok(true, 'update sin efecto para usuario ajeno');
end $$;
reset role;
do $$ begin perform pg_temp.ok(not exists (select 1 from public.sms_students where full_name = 'Hackeado'), 'RLS bloquea escritura ajena'); end $$;

-- Dueño (invitado por el instalador)
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', false);
do $$ declare w jsonb; d jsonb; l uuid; s uuid; c jsonb; begin
  w := public.sms_whoami();
  perform pg_temp.ok(w->'staff'->>'role' = 'owner', 'dueño reclamado por invitación');
  d := public.sms_dashboard();
  perform pg_temp.ok((d->>'waitlist')::int = 2 and (d->>'pending_bookings')::int >= 1 and d ? 'revenue_month', 'dashboard con KPIs');
  perform pg_temp.ok((select count(*) from public.sms_leads_v) >= 5, 'dueño ve leads');

  -- Notas y contactos
  select id, student_id into l, s from public.sms_leads_v where email = 'ana.perez@gmail.com';
  insert into public.sms_activity (student_id, lead_id, kind, summary) values (s, l, 'note', 'Prefiere clases por la noche');
  insert into public.sms_activity (student_id, lead_id, kind, summary, data) values (s, l, 'contact', 'Escribí por WhatsApp', '{"channel":"whatsapp"}');
  perform pg_temp.ok((select status from public.sms_leads where id = l) = 'contacted'
                     and (select last_contact_at from public.sms_leads where id = l) is not null, 'registrar contacto actualiza el lead');
  begin
    insert into public.sms_activity (student_id, kind, summary) values (s, 'conversion', 'falso');
    raise exception 'FAIL: historial falsificable';
  exception when insufficient_privilege then raise warning 'PASS: el historial automático no se puede falsificar'; end;

  -- Seguimiento
  update public.sms_leads set next_follow_up_at = now() + interval '2 hours' where id = l;
  perform pg_temp.ok((select count(*) from public.sms_activity where lead_id = l and kind = 'follow_up') = 1, 'seguimiento programado y auditado');

  -- Conversión sin duplicados
  c := public.sms_convert_lead(l, (select id from public.sms_plans where name = 'Impulso'), current_date);
  c := public.sms_convert_lead(l, null, null);
  perform pg_temp.ok((select status from public.sms_students where id = s) = 'active'
                     and (select status from public.sms_leads where id = l) = 'converted'
                     and (select count(*) from public.sms_students where email = 'ana.perez@gmail.com') = 1
                     and (select count(*) from public.sms_activity where student_id = s and kind = 'conversion') = 1,
                     'conversión a estudiante sin duplicados e idempotente');
  perform pg_temp.ok((select plan_name from public.sms_students_v where id = s) = 'Impulso', 'plan asignado');

  begin perform public.sms__lead_rank('converted'); raise exception 'FAIL';
  exception when insufficient_privilege then raise warning 'PASS: funciones internas cerradas también para el equipo'; end;

  -- Pagos
  insert into public.sms_payments (student_id, concept, amount, currency, method, status, paid_at, period_start, period_end)
  values (s, 'Impulso — noviembre', 140, 'USD', 'transfer', 'paid', now(), current_date, current_date + 30);
  perform pg_temp.ok((select plan_renews_at from public.sms_students where id = s) = current_date + 30, 'pago extiende renovación');
  perform pg_temp.ok((public.sms_dashboard()->'revenue_month'->>'USD')::numeric = 140, 'ingresos del mes en dashboard');

  -- Progreso en la ruta de 18 pasos
  insert into public.sms_progress (student_id, step_no, status, score) values (s, 1, 'completed', 90);
  insert into public.sms_progress (student_id, step_no, status) values (s, 2, 'in_progress');
  perform pg_temp.ok((select current_step from public.sms_students where id = s) = 2
                     and (select steps_completed from public.sms_students_v where id = s) = 1, 'progreso actualiza el paso actual');

  -- Ajustes
  perform public.sms_update_settings('{"waitlist_order":"joined","extra_questions":[{"id":"empresa","label":"¿En qué empresa trabajas?","type":"text","required":true}]}');
  perform pg_temp.ok((public.sms_public_config()->'extra_questions'->0->>'id') = 'empresa', 'preguntas adicionales configurables');
  begin perform public.sms_update_settings('{"ip_salt":"x"}'); raise exception 'FAIL';
  exception when invalid_parameter_value then raise warning 'PASS: ajustes desconocidos rechazados'; end;
  begin perform public.sms_update_settings('{"booking_max_days_ahead":"mucho"}'); raise exception 'FAIL';
  exception when invalid_parameter_value then raise warning 'PASS: ajustes con tipo inválido rechazados'; end;

  -- El último owner no puede quitarse el rol
  begin
    update public.sms_staff set role = 'admin' where user_id = '11111111-1111-4111-8111-111111111111';
    raise exception 'FAIL: se quitó el último owner';
  exception when insufficient_privilege then raise warning 'PASS: siempre queda al menos un owner'; end;
end $$;

-- Pregunta adicional obligatoria ahora exigida en el registro público
select set_config('request.headers', '{"x-forwarded-for":"190.3.3.3"}', false);
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
do $$ declare r jsonb; begin
  r := public.sms_register(pg_temp.payload('fer@correo.com', 'Fernanda Ríos', '+56912345678'));
  perform pg_temp.ok(r->'errors'->>'extra_empresa' = 'required', 'pregunta adicional obligatoria validada en servidor');
  r := public.sms_register(pg_temp.payload('fer@correo.com', 'Fernanda Ríos', '+56912345678')
         || '{"extra":{"empresa":"Acme","hack":"<script>"}}');
  perform pg_temp.ok(r->>'ok' = 'true', 'registro con pregunta adicional');
end $$;
reset role;
do $$ begin
  perform pg_temp.ok((select extra_answers from public.sms_students where email = 'fer@correo.com') = '{"empresa":"Acme"}'::jsonb,
                     'respuestas desconocidas descartadas');
end $$;

-- Asistente (rol staff): ve leads, NO ve pagos ni cambia ajustes
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', false);
do $$ declare w jsonb; begin
  w := public.sms_whoami();
  perform pg_temp.ok(w->'staff'->>'role' = 'staff', 'asistente aceptado con rol staff');
  perform pg_temp.ok((select count(*) from public.sms_leads_v) > 0, 'staff ve leads');
  perform pg_temp.ok((select count(*) from public.sms_payments) = 0 and (select count(*) from public.sms_payments_v) = 0, 'staff no ve pagos');
  perform pg_temp.ok((select count(*) from public.sms_activity where kind = 'payment') = 0, 'staff no ve historial de pagos');
  perform pg_temp.ok(public.sms_dashboard()->'revenue_month' = 'null'::jsonb, 'staff no ve ingresos');
  begin perform public.sms_update_settings('{"waitlist_order":"registered"}'); raise exception 'FAIL';
  exception when insufficient_privilege then raise warning 'PASS: staff no cambia ajustes'; end;
  begin perform public.sms_anonymize_student((select id from public.sms_students limit 1)); raise exception 'FAIL';
  exception when insufficient_privilege then raise warning 'PASS: staff no borra datos personales'; end;
  update public.sms_staff set role = 'owner' where user_id = '33333333-3333-4333-8333-333333333333';
end $$;
reset role;
do $$ begin
  perform pg_temp.ok((select role from public.sms_staff where user_id = '33333333-3333-4333-8333-333333333333') = 'staff',
                     'staff no puede auto-promoverse');
end $$;

-- Derechos de la persona: exportar, fusionar y suprimir
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', false);
do $$ declare e jsonb; keep uuid; dropme uuid; begin
  select id into keep from public.sms_students where email = 'ana.perez@gmail.com';
  e := public.sms_student_export(keep);
  perform pg_temp.ok(e->'student'->>'email' = 'ana.perez@gmail.com' and jsonb_array_length(e->'consents') >= 2
                     and jsonb_array_length(e->'payments') = 1, 'exportación de datos de la persona');

  select id into dropme from public.sms_students where email = 'ana.trabajo@empresa.com';
  perform public.sms_merge_students(keep, dropme);
  perform pg_temp.ok(not exists (select 1 from public.sms_students where id = dropme)
                     and (select count(*) from public.sms_consents where student_id = keep) >= 4, 'fusión de duplicados');

  perform public.sms_anonymize_student(keep);
  perform pg_temp.ok((select full_name from public.sms_students where id = keep) = 'Persona eliminada'
                     and (select whatsapp from public.sms_students where id = keep) is null
                     and not exists (select 1 from public.sms_activity where student_id = keep and kind = 'note')
                     and (select count(*) from public.sms_payments where student_id = keep) = 1, 'supresión conserva solo lo contable');
end $$;
reset role;

-- La tabla docs (palekor-sync.js) no fue tocada
do $$ begin
  perform pg_temp.ok(not exists (select 1 from information_schema.columns where table_name = 'docs' and column_name like 'sms%')
                     and has_table_privilege('anon', 'public.docs', 'select'), 'tabla docs intacta');
end $$;

\echo ALL_TESTS_PASSED
