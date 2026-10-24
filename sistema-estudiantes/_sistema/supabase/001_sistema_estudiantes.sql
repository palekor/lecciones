-- =====================================================================
--  ProfGermandario · Sistema de Gestión de Estudiantes (SMS) · v1.0
--  Migración 001 — esquema completo
--
--  DÓNDE SE EJECUTA: Supabase → SQL Editor del proyecto que ya usa
--  palekor-sync.js. Pegar este archivo completo y ejecutar UNA vez.
--
--  ES ADITIVO: solo crea objetos con prefijo sms_. No modifica la tabla
--  docs, ni la autenticación, ni nada que usen las apps existentes.
--
--  SEGURIDAD (resumen):
--   * RLS activado en todas las tablas sms_.
--   * El público (rol anon) NO tiene acceso a ninguna tabla. Solo puede
--     llamar 5 funciones: sms_public_config, sms_register,
--     sms_join_waitlist, sms_public_slots y sms_request_booking.
--     Esas funciones validan, normalizan, limitan frecuencia y nunca
--     devuelven datos privados.
--   * El panel exige iniciar sesión y estar en sms_staff.
--   * Pagos, ajustes, equipo y borrados: solo owner/admin.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. CONFIGURACIÓN INICIAL — revisa esta línea antes de ejecutar
-- ---------------------------------------------------------------------
--  Correo que será OWNER del panel (la primera vez que entre a /admin
--  con el código del correo, queda registrado como dueño).
create temporary table _sms_install on commit drop as
select 'profgermandario@gmail.com'::text as owner_email,
       'Germandario'::text              as owner_name;


-- ---------------------------------------------------------------------
-- 1. TABLAS
-- ---------------------------------------------------------------------

create table if not exists public.sms_settings (
  id          smallint primary key default 1 check (id = 1),
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

-- Valores internos que nunca salen al navegador (sal para hashear IPs).
create table if not exists public.sms_secrets (
  key   text primary key,
  value text not null
);

create table if not exists public.sms_staff (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  email         text not null,
  display_name  text check (char_length(display_name) <= 80),
  role          text not null check (role in ('owner','admin','staff')),
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table if not exists public.sms_staff_invites (
  email         text primary key check (email = lower(btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  role          text not null check (role in ('owner','admin','staff')),
  display_name  text check (char_length(display_name) <= 80),
  invited_by    uuid,
  created_at    timestamptz not null default now(),
  accepted_at   timestamptz
);

create table if not exists public.sms_plans (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (char_length(name) between 1 and 80),
  price            numeric(12,2) not null default 0 check (price >= 0),
  currency         text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  billing          text not null default 'monthly' check (billing in ('monthly','yearly','one_time')),
  hours_per_month  numeric(6,2) check (hours_per_month is null or hours_per_month >= 0),
  description      text check (char_length(description) <= 500),
  active           boolean not null default true,
  sort             smallint not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.sms_students (
  id                     uuid primary key default gen_random_uuid(),
  full_name              text not null check (char_length(full_name) between 2 and 120),
  email                  text not null check (email = lower(email) and char_length(email) <= 254
                                              and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  whatsapp               text check (whatsapp ~ '^\+[1-9][0-9]{7,14}$'),
  country                text check (country ~ '^[A-Z]{2}$'),
  english_level          text check (english_level in ('beginner','elementary','intermediate','advanced','not_sure')),
  objective              text check (objective in ('conversation','professional','interviews','academic','travel','from_zero','other')),
  objective_other        text check (char_length(objective_other) <= 200),
  preferred_format       text check (preferred_format in ('individual','self_study','not_sure')),
  availability           jsonb not null default '{}'::jsonb,
  preferred_contact      text check (preferred_contact in ('whatsapp','email','call')),
  comments               text check (char_length(comments) <= 1000),
  professional_goals     text check (char_length(professional_goals) <= 1000),
  referral_source        text check (char_length(referral_source) <= 120),
  extra_answers          jsonb not null default '{}'::jsonb,
  status                 text not null default 'prospect'
                           check (status in ('prospect','active','paused','completed','inactive')),
  plan_id                uuid references public.sms_plans(id) on delete set null,
  plan_started_at        date,
  plan_renews_at         date,
  current_step           smallint check (current_step between 1 and 99),
  next_follow_up_at      timestamptz,
  assigned_to            uuid references public.sms_staff(user_id) on delete set null,
  consent_privacy        boolean not null default false,
  consent_privacy_at     timestamptz,
  consent_marketing      boolean not null default false,
  consent_marketing_at   timestamptz,
  consent_notice_version text,
  possible_duplicate_of  uuid references public.sms_students(id) on delete set null,
  needs_review           boolean not null default false,
  locale                 text not null default 'es' check (locale in ('es','en')),
  source                 text check (char_length(source) <= 60),
  converted_at           timestamptz,
  anonymized_at          timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create unique index if not exists sms_students_email_uq on public.sms_students (email);
create index if not exists sms_students_whatsapp_idx on public.sms_students (whatsapp);
create index if not exists sms_students_status_idx  on public.sms_students (status);

create table if not exists public.sms_leads (
  id                  uuid primary key default gen_random_uuid(),
  student_id          uuid not null references public.sms_students(id) on delete cascade,
  registered_at       timestamptz not null default clock_timestamp(),  -- orden exacto (FIFO)
  source              text not null default 'registro' check (char_length(source) <= 60),
  objective           text check (objective in ('conversation','professional','interviews','academic','travel','from_zero','other')),
  objective_other     text check (char_length(objective_other) <= 200),
  preferred_format    text check (preferred_format in ('individual','self_study','not_sure')),
  availability        jsonb not null default '{}'::jsonb,
  status              text not null default 'new' check (status in
                        ('new','contact_pending','contacted','waitlist','invitation_sent',
                         'booking_requested','converted','not_interested','archived')),
  priority_boost      smallint not null default 0 check (priority_boost between -100 and 100),
  waitlist_joined_at  timestamptz,
  invitation_sent_at  timestamptz,
  last_contact_at     timestamptz,
  next_follow_up_at   timestamptz,
  assigned_to         uuid references public.sms_staff(user_id) on delete set null,
  converted_at        timestamptz,
  closed_reason       text check (char_length(closed_reason) <= 200),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
-- Una persona solo puede tener UN lead abierto a la vez (evita duplicados).
create unique index if not exists sms_leads_one_open_uq on public.sms_leads (student_id)
  where status not in ('converted','not_interested','archived');
create index if not exists sms_leads_status_idx    on public.sms_leads (status, registered_at);
create index if not exists sms_leads_followup_idx  on public.sms_leads (next_follow_up_at) where next_follow_up_at is not null;

create table if not exists public.sms_consents (
  id              bigint generated always as identity primary key,
  student_id      uuid not null references public.sms_students(id) on delete cascade,
  kind            text not null check (kind in ('privacy','marketing')),
  granted         boolean not null,
  notice_version  text not null,
  source          text not null check (char_length(source) <= 40),
  ip_hash         text,
  created_at      timestamptz not null default now()
);
create index if not exists sms_consents_student_idx on public.sms_consents (student_id, created_at);

create table if not exists public.sms_submissions (
  id          uuid primary key default gen_random_uuid(),
  client_key  uuid not null unique,              -- idempotencia (reintentos / doble clic)
  token       uuid not null unique default gen_random_uuid(),  -- "ref" para el siguiente paso
  kind        text not null check (kind in ('register','waitlist','booking')),
  student_id  uuid references public.sms_students(id) on delete cascade,
  lead_id     uuid references public.sms_leads(id) on delete set null,
  first_name  text,
  result      jsonb,
  ip_hash     text,
  created_at  timestamptz not null default now()
);

create table if not exists public.sms_rate_events (
  id          bigint generated always as identity primary key,
  bucket      text not null,
  created_at  timestamptz not null default now()
);
create index if not exists sms_rate_events_idx on public.sms_rate_events (bucket, created_at);

create table if not exists public.sms_journey_steps (
  step_no  smallint primary key check (step_no between 1 and 99),
  code     text check (char_length(code) <= 20),
  title    text not null check (char_length(title) between 1 and 120),
  url      text check (url ~ '^https://' and char_length(url) <= 300),
  active   boolean not null default true
);

create table if not exists public.sms_progress (
  student_id    uuid not null references public.sms_students(id) on delete cascade,
  step_no       smallint not null references public.sms_journey_steps(step_no) on update cascade,
  status        text not null default 'not_started' check (status in ('not_started','in_progress','completed')),
  score         smallint check (score between 0 and 100),
  started_at    timestamptz,
  completed_at  timestamptz,
  notes         text check (char_length(notes) <= 1000),
  updated_by    uuid default auth.uid(),
  updated_at    timestamptz not null default now(),
  primary key (student_id, step_no)
);

create table if not exists public.sms_availability_rules (
  id            uuid primary key default gen_random_uuid(),
  weekday       smallint not null check (weekday between 1 and 7),   -- ISO: 1=lunes … 7=domingo
  start_time    time not null,
  end_time      time not null,
  slot_minutes  smallint not null default 60 check (slot_minutes between 15 and 240),
  session_type  text not null default 'diagnostic' check (session_type in ('diagnostic','class','follow_up','other')),
  valid_from    date,
  valid_until   date,
  active        boolean not null default true,
  note          text check (char_length(note) <= 200),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (end_time > start_time),
  check (valid_until is null or valid_from is null or valid_until >= valid_from)
);

create table if not exists public.sms_availability_exceptions (
  id            uuid primary key default gen_random_uuid(),
  on_date       date not null,
  kind          text not null check (kind in ('block','extra')),
  start_time    time,
  end_time      time,
  slot_minutes  smallint check (slot_minutes between 15 and 240),
  session_type  text check (session_type in ('diagnostic','class','follow_up','other')),
  note          text check (char_length(note) <= 200),
  created_at    timestamptz not null default now(),
  check ((start_time is null and end_time is null) or (start_time is not null and end_time is not null and end_time > start_time)),
  check (kind = 'block' or start_time is not null)
);
create index if not exists sms_av_exc_date_idx on public.sms_availability_exceptions (on_date);

create table if not exists public.sms_bookings (
  id               uuid primary key default gen_random_uuid(),
  student_id       uuid not null references public.sms_students(id) on delete cascade,
  lead_id          uuid references public.sms_leads(id) on delete set null,
  submission_id    uuid references public.sms_submissions(id) on delete set null,
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  status           text not null default 'requested'
                     check (status in ('requested','confirmed','rejected','cancelled','completed','no_show')),
  session_type     text not null default 'class' check (session_type in ('diagnostic','class','follow_up','other')),
  channel          text check (channel in ('meet','zoom','whatsapp','in_person','other')),
  meeting_url      text check (meeting_url ~ '^https://' and char_length(meeting_url) <= 500),
  student_message  text check (char_length(student_message) <= 500),
  origin           text not null default 'admin' check (origin in ('public','admin')),
  cancel_reason    text check (char_length(cancel_reason) <= 300),
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (ends_at > starts_at and ends_at - starts_at <= interval '8 hours'),
  -- Nunca dos sesiones activas (solicitada/confirmada) que se crucen.
  constraint sms_bookings_no_overlap exclude using gist
    (tstzrange(starts_at, ends_at, '[)') with &&)
    where (status in ('requested','confirmed'))
);
create index if not exists sms_bookings_student_idx on public.sms_bookings (student_id, starts_at);
create index if not exists sms_bookings_time_idx    on public.sms_bookings (starts_at);

create table if not exists public.sms_payments (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references public.sms_students(id) on delete cascade,
  plan_id       uuid references public.sms_plans(id) on delete set null,
  concept       text not null check (char_length(concept) between 1 and 160),
  amount        numeric(12,2) not null check (amount > 0),
  currency      text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  method        text check (method in ('transfer','nequi','daviplata','paypal','card','cash','other')),
  status        text not null default 'pending' check (status in ('pending','paid','refunded','void')),
  due_date      date,
  paid_at       timestamptz,
  period_start  date,
  period_end    date,
  reference     text check (char_length(reference) <= 120),
  notes         text check (char_length(notes) <= 1000),
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (period_end is null or period_start is null or period_end >= period_start)
);
create index if not exists sms_payments_student_idx on public.sms_payments (student_id, created_at);
create index if not exists sms_payments_status_idx  on public.sms_payments (status, due_date);

create table if not exists public.sms_activity (
  id          bigint generated always as identity primary key,
  student_id  uuid references public.sms_students(id) on delete cascade,
  lead_id     uuid references public.sms_leads(id) on delete set null,
  booking_id  uuid references public.sms_bookings(id) on delete set null,
  payment_id  uuid references public.sms_payments(id) on delete set null,
  kind        text not null check (kind in ('note','contact','follow_up','status','intake','booking',
                                            'payment','progress','conversion','system','export')),
  summary     text not null check (char_length(summary) between 1 and 2000),
  data        jsonb not null default '{}'::jsonb,
  actor_id    uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists sms_activity_student_idx on public.sms_activity (student_id, created_at desc);

create table if not exists public.sms_notifications (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('register','waitlist','booking','system')),
  title       text not null check (char_length(title) <= 200),
  body        text check (char_length(body) <= 1000),
  student_id  uuid references public.sms_students(id) on delete cascade,
  lead_id     uuid references public.sms_leads(id) on delete set null,
  booking_id  uuid references public.sms_bookings(id) on delete set null,
  read_at     timestamptz,
  read_by     uuid,
  created_at  timestamptz not null default now()
);
create index if not exists sms_notifications_unread_idx on public.sms_notifications (created_at desc) where read_at is null;


-- ---------------------------------------------------------------------
-- 1b. EVOLUCIÓN DEL ESQUEMA v1.1 (especificación completa)
--     Idempotente: deja el mismo resultado en una instalación nueva y en
--     una que ya tenía la v1.0. Por eso este archivo se puede re-ejecutar.
-- ---------------------------------------------------------------------

-- Tipos de sesión configurables (nombre, duración sugerida, visibles al público)
create table if not exists public.sms_session_types (
  code             text primary key check (code ~ '^[a-z0-9_]{2,30}$'),
  name             text not null check (char_length(name) between 1 and 60),
  default_minutes  smallint not null default 60 check (default_minutes between 15 and 240),
  is_public        boolean not null default true,
  active           boolean not null default true,
  sort             smallint not null default 0,
  created_at       timestamptz not null default now()
);
insert into public.sms_session_types (code, name, default_minutes, is_public, sort) values
  ('diagnostic', 'Sesión de diagnóstico', 60, true, 1),
  ('class',      'Clase',                 60, true, 2),
  ('follow_up',  'Seguimiento',           30, true, 3),
  ('other',      'Otra',                  60, false, 4)
on conflict (code) do nothing;

alter table public.sms_availability_rules      drop constraint if exists sms_availability_rules_session_type_check;
alter table public.sms_availability_exceptions drop constraint if exists sms_availability_exceptions_session_type_check;
alter table public.sms_bookings                drop constraint if exists sms_bookings_session_type_check;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sms_rules_session_type_fk') then
    alter table public.sms_availability_rules add constraint sms_rules_session_type_fk
      foreign key (session_type) references public.sms_session_types(code) on update cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sms_exceptions_session_type_fk') then
    alter table public.sms_availability_exceptions add constraint sms_exceptions_session_type_fk
      foreign key (session_type) references public.sms_session_types(code) on update cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sms_bookings_session_type_fk') then
    alter table public.sms_bookings add constraint sms_bookings_session_type_fk
      foreign key (session_type) references public.sms_session_types(code) on update cascade;
  end if;
end $$;

-- Pausa entre sesiones dentro de una franja
alter table public.sms_availability_rules
  add column if not exists buffer_minutes smallint not null default 0 check (buffer_minutes between 0 and 120);

-- Persona: datos opcionales, perfil educativo y datos comerciales
alter table public.sms_students
  add column if not exists occupation      text check (char_length(occupation) <= 120),
  add column if not exists timezone        text check (char_length(timezone) <= 64),
  add column if not exists urgency         text check (urgency in ('asap','1_3_months','3_6_months','exploring')),
  add column if not exists level_initial   text check (level_initial in ('pre_a1','a1','a2','b1','b2','c1','c2')),
  add column if not exists level_current   text check (level_current in ('pre_a1','a1','a2','b1','b2','c1','c2')),
  add column if not exists skills_focus    text[] not null default '{}'
    check (skills_focus <@ array['listening','speaking','reading','writing','vocabulary','grammar','pronunciation','confidence']),
  add column if not exists teacher_notes   text check (char_length(teacher_notes) <= 2000),
  add column if not exists next_goals      text check (char_length(next_goals) <= 1000),
  add column if not exists review_date     date,
  add column if not exists contracted_at   date,
  add column if not exists plan_ends_at    date,
  add column if not exists agreed_price    numeric(12,2) check (agreed_price >= 0),
  add column if not exists agreed_currency text check (agreed_currency ~ '^[A-Z]{3}$'),
  add column if not exists next_action     text check (char_length(next_action) <= 300);

-- Lead: urgencia declarada, fecha estimada de incorporación, próxima acción y estados nuevos
alter table public.sms_leads
  add column if not exists urgency         text check (urgency in ('asap','1_3_months','3_6_months','exploring')),
  add column if not exists expected_start  date,
  add column if not exists next_action     text check (char_length(next_action) <= 300);
alter table public.sms_leads drop constraint if exists sms_leads_status_check;
alter table public.sms_leads add constraint sms_leads_status_check check (status in
  ('new','contact_pending','contacted','awaiting_response','waitlist','invitation_sent',
   'booking_requested','booking_confirmed','converted','not_interested','archived'));

-- Pasos del método: contenido configurable (no se inventa: se llena desde el panel)
alter table public.sms_journey_steps
  add column if not exists description         text check (char_length(description) <= 1500),
  add column if not exists objective           text check (char_length(objective) <= 1500),
  add column if not exists resources           text check (char_length(resources) <= 1500),
  add column if not exists completion_criteria text check (char_length(completion_criteria) <= 1500);

alter table public.sms_bookings add column if not exists reminder_enqueued_at timestamptz;

alter table public.sms_activity drop constraint if exists sms_activity_kind_check;
alter table public.sms_activity add constraint sms_activity_kind_check check (kind in
  ('note','contact','follow_up','status','intake','booking','payment','progress','conversion',
   'system','export','task','assessment','message'));

-- Tareas y recordatorios internos
create table if not exists public.sms_tasks (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid references public.sms_students(id) on delete cascade,
  lead_id       uuid references public.sms_leads(id) on delete set null,
  kind          text not null default 'other' check (kind in
                  ('contact','confirm_booking','review_progress','send_resources','assessment','renewal','reactivate','other')),
  title         text not null check (char_length(title) between 1 and 200),
  notes         text check (char_length(notes) <= 1000),
  due_at        timestamptz not null,
  status        text not null default 'open' check (status in ('open','done','cancelled')),
  assigned_to   uuid references public.sms_staff(user_id) on delete set null,
  completed_at  timestamptz,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists sms_tasks_due_idx on public.sms_tasks (status, due_at);
create index if not exists sms_tasks_student_idx on public.sms_tasks (student_id, due_at);

-- Evaluaciones por habilidad (nunca una sola nota global)
create table if not exists public.sms_assessments (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references public.sms_students(id) on delete cascade,
  skill        text not null check (skill in
                 ('listening','speaking','reading','writing','vocabulary','grammar','pronunciation','confidence')),
  assessed_on  date not null default current_date,
  criterion    text not null check (char_length(criterion) between 1 and 200),
  result       text not null check (char_length(result) between 1 and 60),
  score        smallint check (score between 0 and 100),
  comments     text check (char_length(comments) <= 1000),
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists sms_assessments_student_idx on public.sms_assessments (student_id, skill, assessed_on);

-- Cola de mensajes para la persona (confirmación, cancelación, reprogramación,
-- recordatorio). Hoy se envían con un toque desde el panel; un servicio de envío
-- automático puede procesar la misma cola más adelante.
create table if not exists public.sms_outbox (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('booking_confirmed','booking_cancelled','booking_rescheduled','booking_reminder')),
  channel       text not null check (channel in ('whatsapp','email')),
  student_id    uuid references public.sms_students(id) on delete cascade,
  booking_id    uuid references public.sms_bookings(id) on delete set null,
  recipient     text not null check (char_length(recipient) <= 254),
  subject       text check (char_length(subject) <= 200),
  body          text not null check (char_length(body) <= 2000),
  status        text not null default 'pending' check (status in ('pending','sent','skipped','failed')),
  processed_at  timestamptz,
  processed_by  uuid,
  error         text check (char_length(error) <= 500),
  created_at    timestamptz not null default now()
);
create index if not exists sms_outbox_pending_idx on public.sms_outbox (created_at) where status = 'pending';


-- ---------------------------------------------------------------------
-- 2. FUNCIONES AUXILIARES (internas)
-- ---------------------------------------------------------------------

create or replace function public.sms__settings() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select data from public.sms_settings where id = 1), '{}'::jsonb)
$$;

create or replace function public.sms_is_staff() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.sms_staff where user_id = auth.uid() and active)
$$;

create or replace function public.sms_is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.sms_staff
                 where user_id = auth.uid() and active and role in ('owner','admin'))
$$;

create or replace function public.sms_is_owner() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.sms_staff
                 where user_id = auth.uid() and active and role = 'owner')
$$;

create or replace function public.sms__uuid(t text) returns uuid
language plpgsql immutable set search_path = public, pg_temp as $$
begin
  return t::uuid;
exception when others then
  return null;
end $$;

create or replace function public.sms__ts(t text) returns timestamptz
language plpgsql stable set search_path = public, pg_temp as $$
begin
  if t is null or t !~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}' then return null; end if;
  return t::timestamptz;
exception when others then
  return null;
end $$;

-- +57 300 123 4567 · 0057-300-1234567 · (+1) 305.555.0100  →  +573001234567
create or replace function public.sms__norm_phone(p text) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare v text;
begin
  if p is null then return null; end if;
  v := regexp_replace(p, '[[:space:]().-]', '', 'g');
  if v like '00%' then v := '+' || substr(v, 3); end if;
  if v ~ '^\+[1-9][0-9]{7,14}$' then return v; end if;
  return null;
end $$;

create or replace function public.sms__norm_email(p text) returns text
language sql immutable set search_path = public, pg_temp as $$ select lower(btrim(coalesce(p, ''))) $$;

create or replace function public.sms__clean_text(p text, maxlen int) returns text
language sql immutable set search_path = public, pg_temp as $$
  select nullif(left(btrim(regexp_replace(coalesce(p, ''), '[[:cntrl:]]', ' ', 'g')), maxlen), '')
$$;

create or replace function public.sms__clean_availability(a jsonb) returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'days', coalesce((
      select jsonb_agg(d order by array_position(array['mon','tue','wed','thu','fri','sat','sun'], d))
      from (select distinct x as d
            from jsonb_array_elements_text(case when jsonb_typeof(a->'days') = 'array' then a->'days' else '[]'::jsonb end) x
            where x in ('mon','tue','wed','thu','fri','sat','sun')) s), '[]'::jsonb),
    'times', coalesce((
      select jsonb_agg(t order by array_position(array['morning','afternoon','evening'], t))
      from (select distinct x as t
            from jsonb_array_elements_text(case when jsonb_typeof(a->'times') = 'array' then a->'times' else '[]'::jsonb end) x
            where x in ('morning','afternoon','evening')) s), '[]'::jsonb),
    'tz', case when coalesce(a->>'tz', '') ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+){0,2}$'
                    and char_length(a->>'tz') <= 64 then a->>'tz' end,
    'notes', nullif(left(btrim(regexp_replace(coalesce(a->>'notes', ''), '[[:cntrl:]]', ' ', 'g')), 300), '')
  )
$$;

create or replace function public.sms__ip_hash() returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare h jsonb; ip text; salt text;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    h := null;
  end;
  if h is null then return null; end if;
  ip := coalesce(nullif(h->>'cf-connecting-ip', ''), nullif(h->>'x-real-ip', ''),
                 nullif(btrim(split_part(coalesce(h->>'x-forwarded-for', ''), ',', 1)), ''));
  if ip is null then return null; end if;
  select value into salt from public.sms_secrets where key = 'ip_salt';
  return encode(sha256(convert_to(coalesce(salt, '') || '|' || ip, 'UTF8')), 'hex');
end $$;

-- Devuelve true si la acción está permitida (y la cuenta); false si excede el límite.
create or replace function public.sms__rate_hit(p_bucket text, p_max int, p_window interval) returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare n int;
begin
  if p_bucket is null then return true; end if;
  select count(*) into n from public.sms_rate_events
   where bucket = p_bucket and created_at > now() - p_window;
  if n >= p_max then return false; end if;
  insert into public.sms_rate_events (bucket) values (p_bucket);
  if random() < 0.02 then
    delete from public.sms_rate_events where created_at < now() - interval '2 days';
  end if;
  return true;
end $$;

create or replace function public.sms__lead_rank(s text) returns int
language sql immutable set search_path = public, pg_temp as $$
  select case s when 'new' then 1 when 'contact_pending' then 2 when 'contacted' then 3
                when 'awaiting_response' then 3 when 'waitlist' then 4 when 'invitation_sent' then 5
                when 'booking_requested' then 6 when 'booking_confirmed' then 7
                when 'converted' then 8 else 0 end
$$;

-- Etiquetas en español para los resúmenes del historial (la interfaz usa i18n propio).
create or replace function public.sms__label(entity text, c text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case entity
    when 'lead' then case c
      when 'new' then 'Nuevo' when 'contact_pending' then 'Contacto pendiente' when 'contacted' then 'Contactado'
      when 'waitlist' then 'Lista de espera' when 'invitation_sent' then 'Invitación enviada'
      when 'awaiting_response' then 'Pendiente de respuesta' when 'booking_confirmed' then 'Reserva confirmada'
      when 'booking_requested' then 'Reserva solicitada' when 'converted' then 'Convertido en estudiante'
      when 'not_interested' then 'No interesado' when 'archived' then 'Archivado' else c end
    when 'student' then case c
      when 'prospect' then 'Prospecto' when 'active' then 'Activo' when 'paused' then 'Pausado'
      when 'completed' then 'Finalizado' when 'inactive' then 'Inactivo' else c end
    when 'booking' then case c
      when 'requested' then 'Solicitada' when 'confirmed' then 'Confirmada' when 'rejected' then 'Rechazada'
      when 'cancelled' then 'Cancelada' when 'completed' then 'Completada' when 'no_show' then 'No asistió' else c end
    when 'payment' then case c
      when 'pending' then 'Pendiente' when 'paid' then 'Pagado' when 'refunded' then 'Reembolsado'
      when 'void' then 'Anulado' else c end
    when 'progress' then case c
      when 'not_started' then 'Sin iniciar' when 'in_progress' then 'En curso' when 'completed' then 'Completado' else c end
    when 'objective' then case c
      when 'conversation' then 'Conversación cotidiana' when 'professional' then 'Inglés profesional'
      when 'interviews' then 'Entrevistas de trabajo' when 'academic' then 'Inglés académico' when 'travel' then 'Viajes'
      when 'from_zero' then 'Inglés desde cero' when 'other' then 'Otro' else c end
    when 'urgency' then case c
      when 'asap' then 'Lo antes posible' when '1_3_months' then 'En 1 a 3 meses'
      when '3_6_months' then 'En 3 a 6 meses' when 'exploring' then 'Solo explorando' else c end
    when 'skill' then case c
      when 'listening' then 'Comprensión auditiva' when 'speaking' then 'Expresión oral' when 'reading' then 'Lectura'
      when 'writing' then 'Escritura' when 'vocabulary' then 'Vocabulario' when 'grammar' then 'Gramática'
      when 'pronunciation' then 'Pronunciación' when 'confidence' then 'Confianza comunicativa' else c end
    when 'task' then case c
      when 'contact' then 'Contactar' when 'confirm_booking' then 'Confirmar reserva' when 'review_progress' then 'Revisar progreso'
      when 'send_resources' then 'Enviar recursos' when 'assessment' then 'Evaluación' when 'renewal' then 'Renovación'
      when 'reactivate' then 'Reactivar estudiante' else 'Tarea' end
    when 'level' then case c
      when 'beginner' then 'Principiante' when 'elementary' then 'Básico' when 'intermediate' then 'Intermedio'
      when 'advanced' then 'Avanzado' when 'not_sure' then 'No sabe' else c end
    else c end
$$;

create or replace function public.sms__fmt(ts timestamptz) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select to_char(ts at time zone coalesce(public.sms__settings()->>'timezone', 'America/Bogota'), 'DD/MM/YYYY HH24:MI')
$$;


-- ---------------------------------------------------------------------
-- 3. VALIDACIÓN DEL LADO DEL SERVIDOR
--    Devuelve {} si todo está bien, o {campo: código} con todos los errores.
-- ---------------------------------------------------------------------
create or replace function public.sms__validate(p jsonb, p_kind text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  st            jsonb := public.sms__settings();
  e             jsonb := '{}'::jsonb;
  v             text;
  need_profile  boolean := p_kind = 'register';
  need_request  boolean := p_kind in ('register','waitlist');
  q             jsonb;
  a             jsonb;
  av            jsonb;
  qid           text;
begin
  if jsonb_typeof(p) is distinct from 'object' then
    return jsonb_build_object('form', 'invalid');
  end if;

  -- Nombre completo
  v := btrim(coalesce(p->>'full_name', ''));
  if v = '' then e := e || '{"full_name":"required"}';
  elsif char_length(v) not between 2 and 120 then e := e || '{"full_name":"length"}';
  elsif v ~ '[0-9<>{}@#$%^*=_|\\/:;"]' or v ~ '[[:cntrl:]]' or v !~ '[[:alpha:]]' then
    e := e || '{"full_name":"format"}';
  end if;

  -- Correo
  v := public.sms__norm_email(p->>'email');
  if v = '' then e := e || '{"email":"required"}';
  elsif char_length(v) > 254
     or v !~ '^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,24}$'
     or v ~ '\.\.' then
    e := e || '{"email":"format"}';
  end if;

  -- WhatsApp con indicativo
  v := btrim(coalesce(p->>'whatsapp', ''));
  if v = '' then e := e || '{"whatsapp":"required"}';
  elsif public.sms__norm_phone(v) is null then e := e || '{"whatsapp":"format"}';
  end if;

  -- País (ISO 3166-1 alfa-2)
  v := upper(btrim(coalesce(p->>'country', '')));
  if v = '' then e := e || '{"country":"required"}';
  elsif v !~ '^[A-Z]{2}$' then e := e || '{"country":"invalid"}';
  end if;

  -- Nivel de inglés
  v := coalesce(p->>'english_level', '');
  if v = '' then
    if need_profile then e := e || '{"english_level":"required"}'; end if;
  elsif v not in ('beginner','elementary','intermediate','advanced','not_sure') then
    e := e || '{"english_level":"invalid"}';
  end if;

  -- Objetivo
  v := coalesce(p->>'objective', '');
  if v = '' then
    if need_request then e := e || '{"objective":"required"}'; end if;
  elsif v not in ('conversation','professional','interviews','academic','travel','from_zero','other') then
    e := e || '{"objective":"invalid"}';
  elsif v = 'other' and btrim(coalesce(p->>'objective_other', '')) = '' then
    e := e || '{"objective_other":"required"}';
  end if;
  if char_length(coalesce(p->>'objective_other', '')) > 200 then e := e || '{"objective_other":"length"}'; end if;

  -- Formato preferido
  v := coalesce(p->>'preferred_format', '');
  if v = '' then
    if need_request then e := e || '{"preferred_format":"required"}'; end if;
  elsif v not in ('individual','self_study','not_sure') then
    e := e || '{"preferred_format":"invalid"}';
  end if;

  -- Medio de contacto preferido
  v := coalesce(p->>'preferred_contact', '');
  if v = '' then
    if need_profile then e := e || '{"preferred_contact":"required"}'; end if;
  elsif v not in ('whatsapp','email','call') then
    e := e || '{"preferred_contact":"invalid"}';
  end if;

  -- Disponibilidad general
  if p ? 'availability' and jsonb_typeof(p->'availability') is distinct from 'object' then
    e := e || '{"availability":"invalid"}';
  elsif char_length(coalesce(p->'availability'->>'notes', '')) > 300 then
    e := e || '{"availability":"length"}';
  elsif need_request then
    av := public.sms__clean_availability(coalesce(p->'availability', '{}'::jsonb));
    if not ((jsonb_array_length(av->'days') > 0 and jsonb_array_length(av->'times') > 0)
            or av->>'notes' is not null) then
      e := e || '{"availability":"required"}';
    end if;
  end if;

  -- Urgencia declarada (opcional)
  v := coalesce(p->>'urgency', '');
  if v <> '' and v not in ('asap','1_3_months','3_6_months','exploring') then
    e := e || '{"urgency":"invalid"}';
  end if;

  -- Opcionales con longitud máxima
  if char_length(coalesce(p->>'occupation', '')) > 120 then e := e || '{"occupation":"length"}'; end if;
  if char_length(coalesce(p->>'comments', '')) > 1000 then e := e || '{"comments":"length"}'; end if;
  if char_length(coalesce(p->>'professional_goals', '')) > 1000 then e := e || '{"professional_goals":"length"}'; end if;
  if char_length(coalesce(p->>'referral_source', '')) > 120 then e := e || '{"referral_source":"length"}'; end if;
  if char_length(coalesce(p->>'message', '')) > 500 then e := e || '{"message":"length"}'; end if;

  -- Consentimientos
  if p->'consent_privacy' is distinct from 'true'::jsonb then
    e := e || '{"consent_privacy":"required"}';
  elsif coalesce(p->>'notice_version', '') <> coalesce(st->>'privacy_notice_version', '') then
    e := e || '{"consent_privacy":"outdated"}';
  end if;
  if p ? 'consent_marketing' and jsonb_typeof(p->'consent_marketing') <> 'boolean' then
    e := e || '{"consent_marketing":"invalid"}';
  end if;

  -- Preguntas adicionales configurables (solo en el registro)
  if p_kind = 'register' and jsonb_typeof(st->'extra_questions') = 'array' then
    for q in select * from jsonb_array_elements(st->'extra_questions') loop
      continue when coalesce((q->>'active')::boolean, true) = false;
      qid := q->>'id';
      a := case when jsonb_typeof(p->'extra') = 'object' then p->'extra'->qid end;
      if a is null or a = 'null'::jsonb or (jsonb_typeof(a) = 'string' and btrim(a #>> '{}') = '')
         or (q->>'type' = 'checkbox' and a = 'false'::jsonb) then
        if coalesce((q->>'required')::boolean, false) then
          e := e || jsonb_build_object('extra_' || qid, 'required');
        end if;
        continue;
      end if;
      if q->>'type' = 'checkbox' then
        if jsonb_typeof(a) <> 'boolean' then e := e || jsonb_build_object('extra_' || qid, 'invalid'); end if;
      elsif q->>'type' = 'select' then
        if jsonb_typeof(a) <> 'string' or not exists (
             select 1 from jsonb_array_elements_text(coalesce(q->'options', '[]'::jsonb)) o where o = a #>> '{}') then
          e := e || jsonb_build_object('extra_' || qid, 'invalid');
        end if;
      else
        if jsonb_typeof(a) <> 'string'
           or char_length(a #>> '{}') > (case when q->>'type' = 'textarea' then 1000 else 200 end) then
          e := e || jsonb_build_object('extra_' || qid, 'length');
        end if;
      end if;
    end loop;
  end if;

  return e;
end $$;

-- Solo conserva respuestas de preguntas activas (descarta claves desconocidas).
create or replace function public.sms__clean_extra(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare st jsonb := public.sms__settings(); q jsonb; out jsonb := '{}'::jsonb; a jsonb;
begin
  if jsonb_typeof(p->'extra') is distinct from 'object' or jsonb_typeof(st->'extra_questions') is distinct from 'array' then
    return out;
  end if;
  for q in select * from jsonb_array_elements(st->'extra_questions') loop
    continue when coalesce((q->>'active')::boolean, true) = false;
    a := p->'extra'->(q->>'id');
    continue when a is null or a = 'null'::jsonb;
    if jsonb_typeof(a) = 'string' then
      a := to_jsonb(public.sms__clean_text(a #>> '{}', 1000));
      continue when a = 'null'::jsonb;
    end if;
    out := out || jsonb_build_object(q->>'id', a);
  end loop;
  return out;
end $$;


-- ---------------------------------------------------------------------
-- 4. NÚCLEO DE RECEPCIÓN (anti-spam, idempotencia, alta/actualización)
-- ---------------------------------------------------------------------

-- Corta el flujo devolviendo {ok:...} o deja continuar devolviendo {sub_id}.
create or replace function public.sms__guard(
  p jsonb, p_kind text, p_validate text, p_ip text, p_email text, p_ref uuid, p_min_ms int default 2500
) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_key  uuid := public.sms__uuid(p->>'client_key');
  v_res  jsonb;
  v_id   uuid;
  v_el   bigint;
  e      jsonb;
begin
  if jsonb_typeof(p) is distinct from 'object' then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_object('form', 'invalid'));
  end if;

  -- Honeypot: un humano nunca llena el campo oculto "website". Fingimos éxito y no guardamos nada.
  if btrim(coalesce(p->>'website', '')) <> '' then
    return jsonb_build_object('ok', true, 'ref', gen_random_uuid(),
                              'first_name', split_part(btrim(coalesce(p->>'full_name', '')), ' ', 1));
  end if;

  if v_key is null then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_object('form', 'invalid'));
  end if;

  -- Tiempo mínimo humano llenando el formulario.
  v_el := case when coalesce(p->>'elapsed_ms', '') ~ '^[0-9]{1,9}$' then (p->>'elapsed_ms')::bigint else 0 end;
  if v_el < p_min_ms then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_object('form', 'too_fast'));
  end if;

  if p_validate is not null then
    e := public.sms__validate(p, p_validate);
    if e <> '{}'::jsonb then
      return jsonb_build_object('ok', false, 'errors', e);
    end if;
  end if;

  -- Reintento del mismo envío (doble clic, red inestable): devolver el mismo resultado.
  select result into v_res from public.sms_submissions where client_key = v_key;
  if found then
    return coalesce(v_res, jsonb_build_object('ok', false, 'errors', jsonb_build_object('form', 'in_progress')));
  end if;

  -- Límites de frecuencia.
  if not public.sms__rate_hit('ip:' || p_ip, 10, interval '10 minutes')
     or not public.sms__rate_hit('email:' || nullif(p_email, ''), 6, interval '1 hour')
     or not public.sms__rate_hit('ref:' || p_ref::text, 10, interval '1 hour') then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_object('form', 'rate_limited'));
  end if;

  insert into public.sms_submissions (client_key, kind, ip_hash)
  values (v_key, p_kind, p_ip)
  on conflict (client_key) do nothing
  returning id into v_id;

  if v_id is null then
    select result into v_res from public.sms_submissions where client_key = v_key;
    return coalesce(v_res, jsonb_build_object('ok', false, 'errors', jsonb_build_object('form', 'in_progress')));
  end if;

  return jsonb_build_object('sub_id', v_id);
end $$;

-- Asegura el lead abierto de una persona y lo mueve hacia adelante (nunca hacia atrás).
create or replace function public.sms__ensure_lead(
  p_student uuid, p_target text, p jsonb, p_source text
) returns uuid
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  s  public.sms_students%rowtype;
  l  public.sms_leads%rowtype;
  v_av jsonb := case when jsonb_typeof(p->'availability') = 'object'
                     then public.sms__clean_availability(p->'availability') end;
begin
  select * into s from public.sms_students where id = p_student;
  if s.status = 'active' then
    return null;  -- ya es estudiante activo: no se crea un lead nuevo
  end if;

  select * into l from public.sms_leads
   where student_id = p_student and status not in ('converted','not_interested','archived')
   for update;

  if not found then
    insert into public.sms_leads (student_id, source, objective, objective_other, preferred_format, availability, status, urgency)
    values (p_student, coalesce(p_source, 'registro'),
            coalesce(nullif(p->>'objective', ''), s.objective),
            coalesce(public.sms__clean_text(p->>'objective_other', 200), s.objective_other),
            coalesce(nullif(p->>'preferred_format', ''), s.preferred_format),
            coalesce(v_av, s.availability, '{}'::jsonb),
            p_target,
            coalesce(nullif(p->>'urgency', ''), s.urgency))
    returning * into l;
  else
    update public.sms_leads set
      objective        = coalesce(nullif(p->>'objective', ''), objective),
      objective_other  = coalesce(public.sms__clean_text(p->>'objective_other', 200), objective_other),
      preferred_format = coalesce(nullif(p->>'preferred_format', ''), preferred_format),
      availability     = coalesce(v_av, availability),
      urgency          = coalesce(nullif(p->>'urgency', ''), urgency),
      status           = case when public.sms__lead_rank(p_target) > public.sms__lead_rank(status)
                              then p_target else status end
    where id = l.id
    returning * into l;
  end if;
  return l.id;
end $$;

-- Alta o actualización conservadora de la persona + consentimientos + lead.
create or replace function public.sms__intake(p jsonb, p_kind text, p_ip text)
returns table (student_id uuid, lead_id uuid, is_new boolean)
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  st         jsonb := public.sms__settings();
  v_email    text  := public.sms__norm_email(p->>'email');
  v_phone    text  := public.sms__norm_phone(p->>'whatsapp');
  v_name     text  := regexp_replace(btrim(p->>'full_name'), '[[:space:]]+', ' ', 'g');
  v_country  text  := upper(btrim(p->>'country'));
  v_av       jsonb := case when jsonb_typeof(p->'availability') = 'object'
                           then public.sms__clean_availability(p->'availability') end;
  v_mkt      boolean := coalesce(p->'consent_marketing' = 'true'::jsonb, false);
  v_version  text  := st->>'privacy_notice_version';
  v_source   text  := case when coalesce(p->>'source', '') ~ '^[a-z0-9_.-]{1,60}$' then p->>'source' end;
  -- Zona horaria: se guarda solo si existe; nunca bloquea el registro.
  v_tz       text  := (select name from pg_timezone_names
                        where name = coalesce(nullif(p->>'timezone', ''), p->'availability'->>'tz') limit 1);
  -- Para 'booking' el lead avanza a "Reserva solicitada" solo si la reserva se crea.
  v_target   text  := case p_kind when 'waitlist' then 'waitlist' else 'new' end;
  s          public.sms_students%rowtype;
  v_new      boolean := false;
  v_dup      uuid;
  v_diff     jsonb := '{}'::jsonb;
  v_lead     uuid;
begin
  select * into s from public.sms_students where email = v_email for update;

  if not found then
    select id into v_dup from public.sms_students
     where whatsapp = v_phone and anonymized_at is null
     order by created_at limit 1;

    insert into public.sms_students (
      full_name, email, whatsapp, country, english_level, objective, objective_other,
      preferred_format, availability, preferred_contact, comments, professional_goals,
      referral_source, extra_answers, consent_privacy, consent_privacy_at,
      consent_marketing, consent_marketing_at, consent_notice_version,
      possible_duplicate_of, needs_review, source, occupation, timezone, urgency)
    values (
      v_name, v_email, v_phone, v_country,
      nullif(p->>'english_level', ''), nullif(p->>'objective', ''),
      public.sms__clean_text(p->>'objective_other', 200),
      nullif(p->>'preferred_format', ''), coalesce(v_av, '{}'::jsonb),
      nullif(p->>'preferred_contact', ''),
      public.sms__clean_text(p->>'comments', 1000),
      public.sms__clean_text(p->>'professional_goals', 1000),
      public.sms__clean_text(p->>'referral_source', 120),
      public.sms__clean_extra(p),
      true, now(), v_mkt, case when v_mkt then now() end, v_version,
      v_dup, v_dup is not null, coalesce(v_source, p_kind),
      public.sms__clean_text(p->>'occupation', 120), v_tz, nullif(p->>'urgency', ''))
    returning * into s;
    v_new := true;
  else
    -- Persona ya registrada: NO se sobrescriben datos de identidad desde un
    -- formulario público (evita que un tercero altere el registro). Solo se
    -- completan campos vacíos y las diferencias quedan para revisión humana.
    if s.full_name is distinct from v_name then v_diff := v_diff || jsonb_build_object('full_name', v_name); end if;
    if s.whatsapp is not null and v_phone is not null and s.whatsapp <> v_phone then
      v_diff := v_diff || jsonb_build_object('whatsapp', v_phone);
    end if;
    if s.country is not null and s.country <> v_country then v_diff := v_diff || jsonb_build_object('country', v_country); end if;

    update public.sms_students set
      whatsapp            = coalesce(whatsapp, v_phone),
      country             = coalesce(country, v_country),
      english_level       = coalesce(english_level, nullif(p->>'english_level', '')),
      objective           = coalesce(objective, nullif(p->>'objective', '')),
      objective_other     = coalesce(objective_other, public.sms__clean_text(p->>'objective_other', 200)),
      preferred_format    = coalesce(preferred_format, nullif(p->>'preferred_format', '')),
      availability        = case when availability = '{}'::jsonb then coalesce(v_av, availability) else availability end,
      preferred_contact   = coalesce(preferred_contact, nullif(p->>'preferred_contact', '')),
      comments            = coalesce(comments, public.sms__clean_text(p->>'comments', 1000)),
      professional_goals  = coalesce(professional_goals, public.sms__clean_text(p->>'professional_goals', 1000)),
      referral_source     = coalesce(referral_source, public.sms__clean_text(p->>'referral_source', 120)),
      extra_answers       = public.sms__clean_extra(p) || extra_answers,
      occupation          = coalesce(occupation, public.sms__clean_text(p->>'occupation', 120)),
      timezone            = coalesce(timezone, v_tz),
      urgency             = coalesce(nullif(p->>'urgency', ''), urgency),
      consent_privacy     = true,
      consent_privacy_at  = now(),
      consent_notice_version = v_version,
      consent_marketing   = v_mkt,
      consent_marketing_at = now(),
      needs_review        = needs_review or v_diff <> '{}'::jsonb
    where id = s.id
    returning * into s;
  end if;

  -- Registro de consentimiento (prueba con versión del aviso y fecha/hora).
  insert into public.sms_consents (student_id, kind, granted, notice_version, source, ip_hash)
  values (s.id, 'privacy', true, coalesce(v_version, 'n/d'), p_kind, p_ip),
         (s.id, 'marketing', v_mkt, coalesce(v_version, 'n/d'), p_kind, p_ip);

  v_lead := public.sms__ensure_lead(s.id, v_target, p, coalesce(v_source, case p_kind
              when 'register' then 'registro' when 'waitlist' then 'lista_espera' else 'reserva' end));

  insert into public.sms_activity (student_id, lead_id, kind, summary, data, actor_id)
  values (s.id, v_lead, 'intake',
          case p_kind when 'register' then 'Registro recibido'
                      when 'waitlist' then 'Formulario de lista de espera recibido'
                      else 'Formulario de reserva recibido' end
          || case when v_new then '' else ' (persona ya registrada)' end,
          jsonb_build_object('form', p_kind, 'new', v_new, 'differences', v_diff,
                             'submitted', jsonb_strip_nulls(jsonb_build_object(
                               'english_level', p->>'english_level', 'objective', p->>'objective',
                               'preferred_format', p->>'preferred_format', 'availability', v_av,
                               'comments', public.sms__clean_text(p->>'comments', 1000),
                               'message', public.sms__clean_text(p->>'message', 500)))),
          null);

  return query select s.id, v_lead, v_new;
end $$;

create or replace function public.sms__notify(
  p_kind text, p_title text, p_body text, p_student uuid, p_lead uuid, p_booking uuid
) returns void
language sql volatile security definer set search_path = public, pg_temp as $$
  insert into public.sms_notifications (kind, title, body, student_id, lead_id, booking_id)
  values (p_kind, left(p_title, 200), left(p_body, 1000), p_student, p_lead, p_booking)
$$;


-- ---------------------------------------------------------------------
-- 5. AGENDA: generación de horarios disponibles
-- ---------------------------------------------------------------------
create or replace function public.sms__slots(p_from timestamptz, p_to timestamptz)
returns table (starts_at timestamptz, ends_at timestamptz, session_type text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare tz text := coalesce(public.sms__settings()->>'timezone', 'America/Bogota');
begin
  if p_to <= p_from or p_to - p_from > interval '62 days' then
    return;
  end if;
  return query
  with days as (
    select d::date as day
    from generate_series((p_from at time zone tz)::date, (p_to at time zone tz)::date, interval '1 day') d
  ),
  windows as (
    select dd.day, r.start_time, r.end_time, r.slot_minutes::int as mins, r.buffer_minutes::int as buf, r.session_type as stype
    from days dd
    join public.sms_availability_rules r
      on r.active and r.weekday = extract(isodow from dd.day)::int
     and (r.valid_from is null or dd.day >= r.valid_from)
     and (r.valid_until is null or dd.day <= r.valid_until)
    union all
    select x.on_date, x.start_time, x.end_time, coalesce(x.slot_minutes, 60)::int, 0, coalesce(x.session_type, 'diagnostic')
    from public.sms_availability_exceptions x
    join days dd on dd.day = x.on_date
    where x.kind = 'extra'
  ),
  cand as (
    -- Cada sesión empieza tras la anterior + la pausa configurada.
    select ((w.day + w.start_time) at time zone tz) + make_interval(mins => n * (w.mins + w.buf)) as s,
           make_interval(mins => w.mins) as len, w.stype, w.day
    from windows w
    cross join lateral generate_series(
      0, (floor((extract(epoch from (w.end_time - w.start_time)) / 60 + w.buf) / (w.mins + w.buf)))::int - 1) n
  )
  select distinct on (c.s) c.s, c.s + c.len, c.stype
  from cand c
  join public.sms_session_types t on t.code = c.stype and t.active
  where c.s >= p_from
    and c.s + c.len <= p_to
    and not exists (
      select 1 from public.sms_availability_exceptions b
      where b.kind = 'block' and b.on_date = c.day
        and (b.start_time is null
             or ((c.s at time zone tz)::time < b.end_time
                 and ((c.s + c.len) at time zone tz)::time > b.start_time)))
    and not exists (
      select 1 from public.sms_bookings bk
      where bk.status in ('requested','confirmed')
        and tstzrange(bk.starts_at, bk.ends_at, '[)') && tstzrange(c.s, c.s + c.len, '[)'))
  order by c.s;
end $$;


-- ---------------------------------------------------------------------
-- 6. API PÚBLICA (rol anon) — nunca devuelve datos privados
-- ---------------------------------------------------------------------

create or replace function public.sms_public_config() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'privacy_policy_url',     st->>'privacy_policy_url',
    'privacy_notice_version', st->>'privacy_notice_version',
    'controller_name',        st->>'controller_name',
    'contact_email',          st->>'contact_email',
    'contact_whatsapp',       st->>'contact_whatsapp',
    'timezone',               st->>'timezone',
    'show_optional_fields',   coalesce(st->'show_optional_fields', '{}'::jsonb),
    'referral_options',       coalesce(st->'referral_options', '[]'::jsonb),
    'extra_questions',        coalesce((select jsonb_agg(jsonb_build_object(
                                  'id', q->>'id', 'label', q->>'label', 'type', q->>'type',
                                  'options', coalesce(q->'options', '[]'::jsonb),
                                  'required', coalesce((q->>'required')::boolean, false)))
                                from jsonb_array_elements(coalesce(st->'extra_questions', '[]'::jsonb)) q
                                where coalesce((q->>'active')::boolean, true)), '[]'::jsonb),
    'waitlist_enabled',       coalesce((st->>'waitlist_enabled')::boolean, true),
    'waitlist_order',         coalesce(st->>'waitlist_order', 'registered'),
    'booking_enabled',        coalesce((st->>'booking_enabled')::boolean, true),
    'booking_min_notice_hours', coalesce((st->>'booking_min_notice_hours')::int, 12),
    'booking_max_days_ahead', coalesce((st->>'booking_max_days_ahead')::int, 21),
    'booking_auto_confirm',   coalesce((st->>'booking_auto_confirm')::boolean, false),
    'cancellation_policy',    st->>'cancellation_policy',
    'session_types',          coalesce((select jsonb_agg(jsonb_build_object('code', t.code, 'name', t.name) order by t.sort, t.name)
                                        from public.sms_session_types t where t.active and t.is_public), '[]'::jsonb)
  )
  from (select public.sms__settings() as st) x
$$;

create or replace function public.sms_register(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  st     jsonb := public.sms__settings();
  v_ip   text  := public.sms__ip_hash();
  g      jsonb;
  r      record;
  v_tok  uuid;
  v_first text := split_part(regexp_replace(btrim(coalesce(p->>'full_name', '')), '[[:space:]]+', ' ', 'g'), ' ', 1);
  res    jsonb;
begin
  g := public.sms__guard(p, 'register', 'register', v_ip, public.sms__norm_email(p->>'email'), null);
  if g ? 'ok' then return g; end if;

  select * into r from public.sms__intake(p, 'register', v_ip);
  select token into v_tok from public.sms_submissions where id = (g->>'sub_id')::uuid;

  res := jsonb_build_object(
    'ok', true, 'ref', v_tok, 'first_name', v_first,
    'next', jsonb_build_object(
      'waitlist', coalesce((st->>'waitlist_enabled')::boolean, true) and r.lead_id is not null,
      'booking',  coalesce((st->>'booking_enabled')::boolean, true)));

  update public.sms_submissions
     set student_id = r.student_id, lead_id = r.lead_id, first_name = v_first, result = res
   where id = (g->>'sub_id')::uuid;

  perform public.sms__notify('register',
    'Nuevo registro: ' || regexp_replace(btrim(p->>'full_name'), '[[:space:]]+', ' ', 'g'),
    case when r.is_new then 'Persona nueva' else 'Ya existía: revisar diferencias' end
      || ' · ' || public.sms__label('objective', p->>'objective') || ' · Nivel: ' || public.sms__label('level', p->>'english_level'),
    r.student_id, r.lead_id, null);
  return res;
end $$;

create or replace function public.sms_join_waitlist(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  st      jsonb := public.sms__settings();
  v_ip    text  := public.sms__ip_hash();
  v_ref   uuid  := public.sms__uuid(p->>'ref');
  g       jsonb;
  src     public.sms_submissions%rowtype;
  v_stu   uuid;
  v_lead  uuid;
  v_first text;
  v_tok   uuid;
  v_pos   bigint;
  v_stat  text;
  res     jsonb;
begin
  if not coalesce((st->>'waitlist_enabled')::boolean, true) then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_object('form', 'waitlist_closed'));
  end if;

  if v_ref is not null then
    -- Viene del registro: un toque, sin volver a escribir datos.
    g := public.sms__guard(p, 'waitlist', null, v_ip, null, v_ref, 0);
    if g ? 'ok' then return g; end if;
    select * into src from public.sms_submissions
     where token = v_ref and student_id is not null and created_at > now() - interval '30 days';
    if not found then
      delete from public.sms_submissions where id = (g->>'sub_id')::uuid;
      return jsonb_build_object('ok', false, 'errors', jsonb_build_object('ref', 'invalid'));
    end if;
    v_stu   := src.student_id;
    v_first := src.first_name;
    v_lead  := public.sms__ensure_lead(v_stu, 'waitlist', '{}'::jsonb, 'lista_espera');
    insert into public.sms_activity (student_id, lead_id, kind, summary, data, actor_id)
    values (v_stu, v_lead, 'intake', 'Se unió a la lista de espera desde la confirmación de registro',
            jsonb_build_object('form', 'waitlist', 'via', 'ref'), null);
  else
    g := public.sms__guard(p, 'waitlist', 'waitlist', v_ip, public.sms__norm_email(p->>'email'), null);
    if g ? 'ok' then return g; end if;
    select i.student_id, i.lead_id into v_stu, v_lead from public.sms__intake(p, 'waitlist', v_ip) i;
    v_first := split_part(regexp_replace(btrim(p->>'full_name'), '[[:space:]]+', ' ', 'g'), ' ', 1);
  end if;

  select l.waitlist_position, l.status into v_pos, v_stat from public.sms_leads_v l where l.id = v_lead;
  select token into v_tok from public.sms_submissions where id = (g->>'sub_id')::uuid;

  res := jsonb_build_object('ok', true, 'ref', v_tok, 'first_name', v_first,
                            'state', case when v_lead is null then 'active_student' else coalesce(v_stat, 'waitlist') end,
                            'position', v_pos);
  update public.sms_submissions
     set student_id = v_stu, lead_id = v_lead, first_name = v_first, result = res
   where id = (g->>'sub_id')::uuid;

  perform public.sms__notify('waitlist',
    'Lista de espera: ' || coalesce((select full_name from public.sms_students where id = v_stu), v_first),
    case when v_pos is not null then 'Posición ' || v_pos else 'Estado: ' || public.sms__label('lead', v_stat) end,
    v_stu, v_lead, null);
  return res;
end $$;

create or replace function public.sms_public_slots(p_from date default null, p_days int default 14) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  st     jsonb := public.sms__settings();
  tz     text  := coalesce(st->>'timezone', 'America/Bogota');
  v_min  timestamptz := now() + make_interval(hours => coalesce((st->>'booking_min_notice_hours')::int, 12));
  v_max  timestamptz := now() + make_interval(days => coalesce((st->>'booking_max_days_ahead')::int, 21));
  v_from timestamptz;
  v_to   timestamptz;
begin
  if not coalesce((st->>'booking_enabled')::boolean, true) then
    return jsonb_build_object('enabled', false, 'slots', '[]'::jsonb);
  end if;
  v_from := greatest(v_min, coalesce((p_from::timestamp) at time zone tz, v_min));
  v_to   := least(v_max, v_from + make_interval(days => least(greatest(coalesce(p_days, 14), 1), 31)));
  return jsonb_build_object(
    'enabled', true, 'timezone', tz,
    'slots', coalesce((select jsonb_agg(jsonb_build_object('start', s.starts_at, 'end', s.ends_at, 'type', s.session_type)
                                        order by s.starts_at)
                       from public.sms__slots(v_from, v_to) s
                       join public.sms_session_types t on t.code = s.session_type and t.is_public), '[]'::jsonb));
end $$;

create or replace function public.sms_request_booking(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  st       jsonb := public.sms__settings();
  v_ip     text  := public.sms__ip_hash();
  v_ref    uuid  := public.sms__uuid(p->>'ref');
  v_start  timestamptz := public.sms__ts(p->>'slot_start');
  v_min    timestamptz := now() + make_interval(hours => coalesce((st->>'booking_min_notice_hours')::int, 12));
  v_max    timestamptz := now() + make_interval(days => coalesce((st->>'booking_max_days_ahead')::int, 21));
  v_auto   boolean := coalesce((st->>'booking_auto_confirm')::boolean, false);
  v_maxp   int := coalesce((st->>'booking_max_pending_per_student')::int, 2);
  g        jsonb;
  slot     record;
  src      public.sms_submissions%rowtype;
  v_stu    uuid;
  v_lead   uuid;
  v_first  text;
  v_tok    uuid;
  v_bid    uuid;
  v_sub    uuid;
  res      jsonb;
begin
  if not coalesce((st->>'booking_enabled')::boolean, true) then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_object('form', 'booking_closed'));
  end if;
  if v_start is null then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_object('slot', 'required'));
  end if;
  if char_length(coalesce(p->>'message', '')) > 500 then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_object('message', 'length'));
  end if;

  if v_ref is not null then
    g := public.sms__guard(p, 'booking', null, v_ip, null, v_ref, 0);
  else
    g := public.sms__guard(p, 'booking', 'booking', v_ip, public.sms__norm_email(p->>'email'), null);
  end if;
  if g ? 'ok' then return g; end if;
  v_sub := (g->>'sub_id')::uuid;

  -- El horario debe ser uno de los ofrecidos (no se aceptan horas arbitrarias).
  select s.* into slot from public.sms__slots(v_min, v_max) s
    join public.sms_session_types t on t.code = s.session_type and t.is_public
   where s.starts_at = v_start
     and (coalesce(p->>'session_type', '') = '' or s.session_type = p->>'session_type');
  if not found then
    delete from public.sms_submissions where id = v_sub;
    return jsonb_build_object('ok', false, 'errors', jsonb_build_object('slot', 'unavailable'));
  end if;

  if v_ref is not null then
    select * into src from public.sms_submissions
     where token = v_ref and student_id is not null and created_at > now() - interval '30 days';
    if not found then
      delete from public.sms_submissions where id = v_sub;
      return jsonb_build_object('ok', false, 'errors', jsonb_build_object('ref', 'invalid'));
    end if;
    v_stu := src.student_id; v_first := src.first_name;
  else
    select i.student_id into v_stu from public.sms__intake(p, 'booking', v_ip) i;
    v_first := split_part(regexp_replace(btrim(p->>'full_name'), '[[:space:]]+', ' ', 'g'), ' ', 1);
  end if;

  if (select count(*) from public.sms_bookings b
       where b.student_id = v_stu and b.status = 'requested' and b.starts_at > now()) >= v_maxp then
    delete from public.sms_submissions where id = v_sub;
    return jsonb_build_object('ok', false, 'errors', jsonb_build_object('slot', 'too_many_pending'));
  end if;

  begin
    insert into public.sms_bookings (student_id, lead_id, submission_id, starts_at, ends_at, status,
                                     session_type, student_message, origin, created_by)
    values (v_stu, null, v_sub, slot.starts_at, slot.ends_at,
            case when v_auto then 'confirmed' else 'requested' end,
            slot.session_type, public.sms__clean_text(p->>'message', 500), 'public', null)
    returning id into v_bid;
  exception when exclusion_violation then
    delete from public.sms_submissions where id = v_sub;
    return jsonb_build_object('ok', false, 'errors', jsonb_build_object('slot', 'taken'));
  end;

  v_lead := public.sms__ensure_lead(v_stu, 'booking_requested', '{}'::jsonb, 'reserva');
  update public.sms_bookings set lead_id = v_lead where id = v_bid;

  select token into v_tok from public.sms_submissions where id = v_sub;
  res := jsonb_build_object('ok', true, 'ref', v_tok, 'first_name', v_first,
           'booking', jsonb_build_object('start', slot.starts_at, 'end', slot.ends_at, 'type', slot.session_type,
                                         'status', case when v_auto then 'confirmed' else 'requested' end));
  update public.sms_submissions
     set student_id = v_stu, lead_id = v_lead, first_name = v_first, result = res
   where id = v_sub;

  perform public.sms__notify('booking',
    'Solicitud de sesión: ' || coalesce((select full_name from public.sms_students where id = v_stu), v_first),
    public.sms__fmt(slot.starts_at) || ' · ' || case when v_auto then 'confirmada automáticamente' else 'por confirmar' end,
    v_stu, v_lead, v_bid);
  return res;
end $$;


-- ---------------------------------------------------------------------
-- 7. VISTAS PARA EL PANEL (security_invoker: respetan RLS)
-- ---------------------------------------------------------------------
-- Se recrean (no "replace") porque crecieron en columnas; no tienen dependencias.
drop view if exists public.sms_leads_v;
drop view if exists public.sms_students_v;
drop view if exists public.sms_bookings_v;
drop view if exists public.sms_payments_v;

create view public.sms_leads_v with (security_invoker = true) as
select l.*,
       s.full_name, s.email, s.whatsapp, s.country, s.english_level, s.preferred_contact,
       s.occupation, s.timezone,
       s.status as student_status, s.possible_duplicate_of, s.needs_review, s.consent_marketing,
       (select min(b.starts_at) from public.sms_bookings b
         where b.student_id = l.student_id and b.status in ('requested','confirmed') and b.starts_at > now()) as next_session_at,
       case when l.status = 'waitlist' then
         row_number() over (
           partition by (l.status = 'waitlist')
           order by l.priority_boost desc,
                    case when coalesce((select data->>'waitlist_order' from public.sms_settings where id = 1), 'registered') = 'joined'
                         then coalesce(l.waitlist_joined_at, l.registered_at) else l.registered_at end,
                    l.id)
       end as waitlist_position,
       -- Necesita atención: lead nuevo sin contacto en 48 h, o seguimiento vencido.
       ((l.status in ('new','contact_pending') and l.last_contact_at is null and l.registered_at < now() - interval '48 hours')
         or (l.next_follow_up_at < now() and l.status not in ('converted','not_interested','archived'))) as needs_attention
from public.sms_leads l
join public.sms_students s on s.id = l.student_id;

create view public.sms_students_v with (security_invoker = true) as
select s.*,
       p.name as plan_name, p.price as plan_price, p.currency as plan_currency, p.hours_per_month as plan_hours,
       ol.id as lead_id, ol.status as lead_status,
       (select count(*) from public.sms_progress pr where pr.student_id = s.id and pr.status = 'completed') as steps_completed,
       (select min(b.starts_at) from public.sms_bookings b
         where b.student_id = s.id and b.status in ('requested','confirmed') and b.starts_at > now()) as next_session_at,
       (select count(*) from public.sms_bookings b where b.student_id = s.id and b.status = 'completed') as sessions_completed,
       (select max(pa.paid_at) from public.sms_payments pa where pa.student_id = s.id and pa.status = 'paid') as last_paid_at,
       (select count(*) from public.sms_payments pa
         where pa.student_id = s.id and pa.status = 'pending' and pa.due_date < current_date) as payments_overdue,
       (select count(*) from public.sms_tasks t where t.student_id = s.id and t.status = 'open') as open_tasks,
       (select min(t.due_at) from public.sms_tasks t where t.student_id = s.id and t.status = 'open') as next_task_due
from public.sms_students s
left join public.sms_plans p on p.id = s.plan_id
left join lateral (
  select l.id, l.status from public.sms_leads l
  where l.student_id = s.id
  order by (l.status not in ('converted','not_interested','archived')) desc, l.registered_at desc
  limit 1) ol on true;

create view public.sms_bookings_v with (security_invoker = true) as
select b.*, s.full_name, s.email, s.whatsapp, s.country, s.status as student_status, s.timezone as student_timezone,
       t.name as session_type_name
from public.sms_bookings b
join public.sms_students s on s.id = b.student_id
left join public.sms_session_types t on t.code = b.session_type;

create view public.sms_payments_v with (security_invoker = true) as
select pa.*, s.full_name, s.email, p.name as plan_name,
       (pa.status = 'pending' and pa.due_date < current_date) as overdue
from public.sms_payments pa
join public.sms_students s on s.id = pa.student_id
left join public.sms_plans p on p.id = pa.plan_id;

create or replace view public.sms_tasks_v with (security_invoker = true) as
select t.*, s.full_name, s.whatsapp, s.status as student_status,
       (t.status = 'open' and t.due_at < now()) as overdue
from public.sms_tasks t
left join public.sms_students s on s.id = t.student_id;


-- ---------------------------------------------------------------------
-- 8. API DEL PANEL (requiere sesión + pertenecer al equipo)
-- ---------------------------------------------------------------------

create or replace function public.sms_whoami() returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  uid  uuid := auth.uid();
  em   text;
  s    public.sms_staff%rowtype;
  inv  public.sms_staff_invites%rowtype;
begin
  if uid is null then
    return jsonb_build_object('signed_in', false);
  end if;
  select lower(email) into em from auth.users where id = uid and email_confirmed_at is not null;
  select * into s from public.sms_staff where user_id = uid;
  if not found and em is not null then
    select * into inv from public.sms_staff_invites where email = em and accepted_at is null;
    if found then
      insert into public.sms_staff (user_id, email, display_name, role)
      values (uid, em, inv.display_name, inv.role)
      on conflict (user_id) do nothing;
      update public.sms_staff_invites set accepted_at = now() where email = em;
      select * into s from public.sms_staff where user_id = uid;
    end if;
  end if;
  return jsonb_build_object(
    'signed_in', true, 'user_id', uid, 'email', em,
    'staff', case when s.user_id is null or not s.active then null
                  else jsonb_build_object('role', s.role, 'display_name', s.display_name) end);
end $$;

create or replace function public.sms__require_staff() returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.sms_is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;

create or replace function public.sms__require_admin() returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.sms_is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;

create or replace function public.sms_settings_get() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.sms__require_staff();
  return public.sms__settings();
end $$;

create or replace function public.sms_update_settings(p_patch jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  allowed text[] := array['timezone','privacy_policy_url','privacy_notice_version','controller_name',
    'contact_email','contact_whatsapp','show_optional_fields','extra_questions','referral_options',
    'waitlist_enabled','waitlist_order','booking_enabled','booking_min_notice_hours',
    'booking_max_days_ahead','booking_auto_confirm','booking_max_pending_per_student',
    'wa_templates','status_labels','cancellation_policy'];
  k text; q jsonb; v jsonb;
begin
  perform public.sms__require_admin();
  if jsonb_typeof(p_patch) <> 'object' then raise exception 'invalid_settings' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if not k = any (allowed) then raise exception 'unknown_setting:%', k using errcode = '22023'; end if;
    v := p_patch->k;
    if k = 'timezone' and not exists (select 1 from pg_timezone_names where name = v #>> '{}') then
      raise exception 'invalid_setting:timezone' using errcode = '22023';
    elsif k = 'privacy_policy_url' and coalesce(v #>> '{}', '') !~ '^https://[^[:space:]]{3,300}$' then
      raise exception 'invalid_setting:privacy_policy_url' using errcode = '22023';
    elsif k in ('privacy_notice_version','controller_name','contact_email','contact_whatsapp')
          and (jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') not between 1 and 160) then
      raise exception 'invalid_setting:%', k using errcode = '22023';
    elsif k in ('waitlist_enabled','booking_enabled','booking_auto_confirm') and jsonb_typeof(v) <> 'boolean' then
      raise exception 'invalid_setting:%', k using errcode = '22023';
    elsif k = 'waitlist_order' and v #>> '{}' not in ('registered','joined') then
      raise exception 'invalid_setting:waitlist_order' using errcode = '22023';
    elsif k = 'booking_min_notice_hours'
          and (case when jsonb_typeof(v) = 'number' then (v #>> '{}')::numeric not between 0 and 336 else true end) then
      raise exception 'invalid_setting:%', k using errcode = '22023';
    elsif k = 'booking_max_days_ahead'
          and (case when jsonb_typeof(v) = 'number' then (v #>> '{}')::numeric not between 1 and 60 else true end) then
      raise exception 'invalid_setting:%', k using errcode = '22023';
    elsif k = 'booking_max_pending_per_student'
          and (case when jsonb_typeof(v) = 'number' then (v #>> '{}')::numeric not between 1 and 10 else true end) then
      raise exception 'invalid_setting:%', k using errcode = '22023';
    elsif k = 'show_optional_fields' and jsonb_typeof(v) <> 'object' then
      raise exception 'invalid_setting:%', k using errcode = '22023';
    elsif k = 'referral_options'
          and (case when jsonb_typeof(v) = 'array' then jsonb_array_length(v) > 30
                      or exists (select 1 from jsonb_array_elements(v) o
                                 where jsonb_typeof(o) <> 'string' or char_length(o #>> '{}') not between 1 and 60)
                   else true end) then
      raise exception 'invalid_setting:%', k using errcode = '22023';
    elsif k = 'wa_templates'
          and (jsonb_typeof(v) <> 'object'
               or exists (select 1 from jsonb_each(case when jsonb_typeof(v) = 'object' then v else '{}'::jsonb end) x
                          where jsonb_typeof(x.value) <> 'string' or char_length(x.value #>> '{}') > 800)) then
      raise exception 'invalid_setting:%', k using errcode = '22023';
    elsif k = 'cancellation_policy' and (jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') > 600) then
      raise exception 'invalid_setting:%', k using errcode = '22023';
    elsif k = 'status_labels'
          and (jsonb_typeof(v) <> 'object'
               or exists (select 1 from jsonb_each(case when jsonb_typeof(v) = 'object' then v else '{}'::jsonb end) g
                          where g.key not in ('lead','student') or jsonb_typeof(g.value) <> 'object'
                             or exists (select 1 from jsonb_each(case when jsonb_typeof(g.value) = 'object' then g.value else '{}'::jsonb end) x
                                        where jsonb_typeof(x.value) <> 'string' or char_length(x.value #>> '{}') not between 1 and 40))) then
      raise exception 'invalid_setting:%', k using errcode = '22023';
    elsif k = 'extra_questions' then
      if (case when jsonb_typeof(v) = 'array' then jsonb_array_length(v) > 15 else true end) then
        raise exception 'invalid_setting:extra_questions' using errcode = '22023';
      end if;
      for q in select * from jsonb_array_elements(v) loop
        if jsonb_typeof(q) <> 'object'
           or coalesce(q->>'id', '') !~ '^[a-z0-9_]{1,32}$'
           or char_length(coalesce(q->>'label', '')) not between 1 and 200
           or coalesce(q->>'type', '') not in ('text','textarea','select','checkbox')
           or coalesce(jsonb_typeof(q->'required'), 'boolean') <> 'boolean'
           or coalesce(jsonb_typeof(q->'active'), 'boolean') <> 'boolean'
           or (q->>'type' = 'select' and (case when jsonb_typeof(q->'options') = 'array'
                                              then jsonb_array_length(q->'options') not between 1 and 20
                                              else true end)) then
          raise exception 'invalid_setting:extra_questions' using errcode = '22023';
        end if;
      end loop;
      if (select count(distinct x->>'id') from jsonb_array_elements(v) x) <> jsonb_array_length(v) then
        raise exception 'invalid_setting:extra_questions' using errcode = '22023';
      end if;
    end if;
  end loop;
  update public.sms_settings set data = data || p_patch, updated_at = now(), updated_by = auth.uid() where id = 1;
  return public.sms__settings();
end $$;

create or replace function public.sms_dashboard() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  tz     text := coalesce(public.sms__settings()->>'timezone', 'America/Bogota');
  adm    boolean := public.sms_is_admin();
  today  date := (now() at time zone tz)::date;
  m0     timestamptz := (date_trunc('month', now() at time zone tz)) at time zone tz;
begin
  perform public.sms__require_staff();
  return jsonb_build_object(
    'today', today,
    'new_leads_7d', (select count(*) from public.sms_leads where registered_at > now() - interval '7 days'),
    'waitlist', (select count(*) from public.sms_leads where status = 'waitlist'),
    'pending_bookings', (select count(*) from public.sms_bookings where status = 'requested' and starts_at > now()),
    'sessions_7d', (select count(*) from public.sms_bookings
                    where status = 'confirmed' and starts_at between now() and now() + interval '7 days'),
    'active_students', (select count(*) from public.sms_students where status = 'active'),
    'follow_ups_due', (select count(*) from public.sms_leads
                         where next_follow_up_at < (today + 1)::timestamp at time zone tz
                           and status not in ('converted','not_interested','archived'))
                      + (select count(*) from public.sms_students
                         where next_follow_up_at < (today + 1)::timestamp at time zone tz and anonymized_at is null),
    'conversion_90d', jsonb_build_object(
        'leads', (select count(*) from public.sms_leads where registered_at > now() - interval '90 days'),
        'converted', (select count(*) from public.sms_leads where registered_at > now() - interval '90 days' and status = 'converted')),
    'pipeline', coalesce((select jsonb_object_agg(status, n) from
                  (select status, count(*) n from public.sms_leads group by status) x), '{}'::jsonb),
    'renewals_7d', (select count(*) from public.sms_students
                    where status = 'active' and plan_renews_at between today and today + 7),
    'revenue_month', case when adm then coalesce((select jsonb_object_agg(currency, total) from
                  (select currency, sum(amount) total from public.sms_payments
                    where status = 'paid' and paid_at >= m0 group by currency) x), '{}'::jsonb) end,
    'payments_overdue', case when adm then (select count(*) from public.sms_payments
                    where status = 'pending' and due_date < today) end,
    'unread_notifications', (select count(*) from public.sms_notifications where read_at is null),
    'total_prospects', (select count(*) from public.sms_students where status = 'prospect' and anonymized_at is null),
    'sessions_completed_30d', (select count(*) from public.sms_bookings
                               where status = 'completed' and starts_at > now() - interval '30 days'),
    'tasks_overdue', (select count(*) from public.sms_tasks where status = 'open' and due_at < now()),
    'outbox_pending', (select count(*) from public.sms_outbox where status = 'pending'),
    'billed_pending', case when adm then coalesce((select jsonb_object_agg(currency, total) from
                  (select currency, sum(amount) total from public.sms_payments where status = 'pending' group by currency) x), '{}'::jsonb) end,
    'agreed_active', case when adm then coalesce((select jsonb_object_agg(cur, total) from
                  (select coalesce(s.agreed_currency, p.currency, 'USD') cur, sum(coalesce(s.agreed_price, p.price)) total
                     from public.sms_students s left join public.sms_plans p on p.id = s.plan_id
                    where s.status = 'active' and coalesce(s.agreed_price, p.price) is not null
                    group by 1) x), '{}'::jsonb) end,
    'tasks', coalesce((select jsonb_agg(x order by x.due_at) from (
                  select t.id, t.title, t.kind, t.due_at, t.student_id, s.full_name
                  from public.sms_tasks t left join public.sms_students s on s.id = t.student_id
                  where t.status = 'open' and t.due_at < (today + 1)::timestamp at time zone tz
                  order by t.due_at limit 10) x), '[]'::jsonb),
    'upcoming', coalesce((select jsonb_agg(x order by x.starts_at) from (
                  select b.id, b.starts_at, b.ends_at, b.status, b.session_type, b.student_id, s.full_name, s.whatsapp
                  from public.sms_bookings b join public.sms_students s on s.id = b.student_id
                  where b.status in ('requested','confirmed') and b.ends_at > now()
                  order by b.starts_at limit 8) x), '[]'::jsonb),
    'follow_ups', coalesce((select jsonb_agg(x order by x.due) from (
                  select 'lead' as entity, l.id, l.student_id, s.full_name, s.whatsapp, l.status, l.next_follow_up_at as due
                  from public.sms_leads l join public.sms_students s on s.id = l.student_id
                  where l.next_follow_up_at < (today + 1)::timestamp at time zone tz
                    and l.status not in ('converted','not_interested','archived')
                  union all
                  select 'student', s.id, s.id, s.full_name, s.whatsapp, s.status, s.next_follow_up_at
                  from public.sms_students s
                  where s.next_follow_up_at < (today + 1)::timestamp at time zone tz and s.anonymized_at is null
                  order by 7 limit 10) x), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(x order by x.registered_at desc) from (
                  select l.id, l.student_id, s.full_name, l.status, l.registered_at, l.objective, s.country
                  from public.sms_leads l join public.sms_students s on s.id = l.student_id
                  order by l.registered_at desc limit 6) x), '[]'::jsonb)
  );
end $$;

create or replace function public.sms_admin_slots(p_from date, p_days int default 14) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare tz text := coalesce(public.sms__settings()->>'timezone', 'America/Bogota');
        v_from timestamptz;
begin
  perform public.sms__require_staff();
  v_from := greatest(now(), (coalesce(p_from, current_date)::timestamp) at time zone tz);
  return coalesce((select jsonb_agg(jsonb_build_object('start', s.starts_at, 'end', s.ends_at, 'type', s.session_type)
                                    order by s.starts_at)
                   from public.sms__slots(v_from, v_from + make_interval(days => least(greatest(coalesce(p_days, 14), 1), 31))) s),
                  '[]'::jsonb);
end $$;

create or replace function public.sms_convert_lead(p_lead uuid, p_plan uuid default null, p_start date default null)
returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare l public.sms_leads%rowtype;
begin
  perform public.sms__require_staff();
  select * into l from public.sms_leads where id = p_lead for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_plan is not null and not exists (select 1 from public.sms_plans where id = p_plan) then
    raise exception 'invalid_plan' using errcode = '22023';
  end if;

  -- Se reutiliza la MISMA ficha de la persona: no se crean registros duplicados.
  update public.sms_students set
    status          = 'active',
    converted_at    = coalesce(converted_at, now()),
    plan_id         = coalesce(p_plan, plan_id),
    plan_started_at = coalesce(p_start, plan_started_at, current_date)
  where id = l.student_id;

  if l.status <> 'converted' then
    update public.sms_leads set status = 'converted' where id = p_lead;
    insert into public.sms_activity (student_id, lead_id, kind, summary, data)
    values (l.student_id, p_lead, 'conversion', 'Convertido en estudiante activo',
            jsonb_build_object('plan_id', p_plan));
  end if;
  return jsonb_build_object('ok', true, 'student_id', l.student_id);
end $$;

create or replace function public.sms_mark_notifications_read(p_ids bigint[] default null) returns int
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare n int;
begin
  perform public.sms__require_staff();
  update public.sms_notifications set read_at = now(), read_by = auth.uid()
   where read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.sms_log_export(p_entity text, p_count int) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  perform public.sms__require_staff();
  if p_entity = 'payments' then perform public.sms__require_admin(); end if;
  insert into public.sms_activity (kind, summary, data)
  values ('export', 'Exportación CSV: ' || left(coalesce(p_entity, '?'), 40) || ' (' || coalesce(p_count, 0) || ' filas)',
          jsonb_build_object('entity', left(p_entity, 40), 'count', p_count));
end $$;

-- Exportación de los datos de una persona (derecho de acceso / portabilidad).
create or replace function public.sms_student_export(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare adm boolean := public.sms_is_admin();
begin
  perform public.sms__require_staff();
  if not exists (select 1 from public.sms_students where id = p_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'exported_at', now(),
    'student',  (select to_jsonb(s) from public.sms_students s where s.id = p_id),
    'leads',    coalesce((select jsonb_agg(to_jsonb(l) order by l.registered_at) from public.sms_leads l where l.student_id = p_id), '[]'::jsonb),
    'consents', coalesce((select jsonb_agg(jsonb_build_object('kind', c.kind, 'granted', c.granted,
                          'notice_version', c.notice_version, 'source', c.source, 'at', c.created_at) order by c.created_at)
                          from public.sms_consents c where c.student_id = p_id), '[]'::jsonb),
    'bookings', coalesce((select jsonb_agg(to_jsonb(b) order by b.starts_at) from public.sms_bookings b where b.student_id = p_id), '[]'::jsonb),
    'progress', coalesce((select jsonb_agg(to_jsonb(pr) order by pr.step_no) from public.sms_progress pr where pr.student_id = p_id), '[]'::jsonb),
    'assessments', coalesce((select jsonb_agg(to_jsonb(a) order by a.assessed_on) from public.sms_assessments a where a.student_id = p_id), '[]'::jsonb),
    'tasks', coalesce((select jsonb_agg(to_jsonb(t) order by t.due_at) from public.sms_tasks t where t.student_id = p_id), '[]'::jsonb),
    'activity', coalesce((select jsonb_agg(jsonb_build_object('kind', a.kind, 'summary', a.summary, 'at', a.created_at) order by a.created_at)
                          from public.sms_activity a where a.student_id = p_id and (a.kind <> 'payment' or adm)), '[]'::jsonb),
    'payments', case when adm then coalesce((select jsonb_agg(to_jsonb(pa) order by pa.created_at)
                          from public.sms_payments pa where pa.student_id = p_id), '[]'::jsonb) end
  );
end $$;

-- Derecho de supresión: borra los datos personales y conserva solo registros
-- contables/estadísticos sin identificar a la persona.
create or replace function public.sms_anonymize_student(p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  perform public.sms__require_admin();
  if not exists (select 1 from public.sms_students where id = p_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  update public.sms_students set
    full_name = 'Persona eliminada', email = 'eliminado+' || id || '@example.invalid',
    whatsapp = null, country = null, objective_other = null, availability = '{}'::jsonb,
    comments = null, professional_goals = null, referral_source = null, extra_answers = '{}'::jsonb,
    consent_marketing = false, next_follow_up_at = null, possible_duplicate_of = null,
    needs_review = false, status = 'inactive', anonymized_at = now(),
    occupation = null, timezone = null, teacher_notes = null, next_goals = null, next_action = null
  where id = p_id;
  update public.sms_tasks set notes = null, title = 'Tarea (datos eliminados)', status = case when status = 'open' then 'cancelled' else status end
   where student_id = p_id;
  update public.sms_assessments set comments = null where student_id = p_id;
  delete from public.sms_outbox where student_id = p_id;
  update public.sms_students set possible_duplicate_of = null where possible_duplicate_of = p_id;
  update public.sms_leads set availability = '{}'::jsonb, objective_other = null, next_follow_up_at = null, next_action = null,
         status = case when status in ('converted','not_interested','archived') then status else 'archived' end,
         closed_reason = 'Datos eliminados a solicitud'
   where student_id = p_id;
  update public.sms_bookings set student_message = null, meeting_url = null where student_id = p_id;
  update public.sms_payments set notes = null where student_id = p_id;
  update public.sms_progress set notes = null where student_id = p_id;
  update public.sms_submissions set first_name = null, result = null where student_id = p_id;
  delete from public.sms_activity where student_id = p_id and kind in ('note','contact','intake','follow_up');
  update public.sms_notifications set title = 'Registro eliminado', body = null where student_id = p_id;
  insert into public.sms_activity (student_id, kind, summary) values (p_id, 'system', 'Datos personales eliminados a solicitud');
  return jsonb_build_object('ok', true);
end $$;

-- Fusiona dos fichas de la misma persona (p_drop se integra en p_keep y se borra).
create or replace function public.sms_merge_students(p_keep uuid, p_drop uuid) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare k public.sms_students%rowtype; d public.sms_students%rowtype;
begin
  perform public.sms__require_admin();
  if p_keep = p_drop then raise exception 'same_student' using errcode = '22023'; end if;
  select * into k from public.sms_students where id = p_keep for update;
  select * into d from public.sms_students where id = p_drop for update;
  if k.id is null or d.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;

  -- Si ambos tienen lead abierto, se archiva el de la ficha que desaparece.
  if exists (select 1 from public.sms_leads where student_id = p_keep and status not in ('converted','not_interested','archived')) then
    update public.sms_leads set status = 'archived', closed_reason = 'Fusionado con otra ficha'
     where student_id = p_drop and status not in ('converted','not_interested','archived');
  end if;
  update public.sms_leads set student_id = p_keep where student_id = p_drop;
  update public.sms_bookings set student_id = p_keep where student_id = p_drop;
  update public.sms_payments set student_id = p_keep where student_id = p_drop;
  update public.sms_consents set student_id = p_keep where student_id = p_drop;
  update public.sms_activity set student_id = p_keep where student_id = p_drop;
  update public.sms_notifications set student_id = p_keep where student_id = p_drop;
  update public.sms_submissions set student_id = p_keep where student_id = p_drop;
  update public.sms_tasks set student_id = p_keep where student_id = p_drop;
  update public.sms_assessments set student_id = p_keep where student_id = p_drop;
  update public.sms_outbox set student_id = p_keep where student_id = p_drop;
  insert into public.sms_progress (student_id, step_no, status, score, started_at, completed_at, notes)
    select p_keep, step_no, status, score, started_at, completed_at, notes from public.sms_progress where student_id = p_drop
  on conflict (student_id, step_no) do update set
    status = case when excluded.status = 'completed' or public.sms_progress.status = 'completed' then 'completed'
                  when excluded.status = 'in_progress' or public.sms_progress.status = 'in_progress' then 'in_progress'
                  else 'not_started' end,
    score = greatest(public.sms_progress.score, excluded.score),
    completed_at = coalesce(public.sms_progress.completed_at, excluded.completed_at);
  delete from public.sms_progress where student_id = p_drop;
  update public.sms_students set possible_duplicate_of = null where possible_duplicate_of in (p_drop, p_keep);

  delete from public.sms_students where id = p_drop;
  update public.sms_students set
    whatsapp = coalesce(whatsapp, d.whatsapp), country = coalesce(country, d.country),
    english_level = coalesce(english_level, d.english_level), objective = coalesce(objective, d.objective),
    preferred_format = coalesce(preferred_format, d.preferred_format),
    preferred_contact = coalesce(preferred_contact, d.preferred_contact),
    comments = coalesce(comments, d.comments), professional_goals = coalesce(professional_goals, d.professional_goals),
    referral_source = coalesce(referral_source, d.referral_source),
    plan_id = coalesce(plan_id, d.plan_id),
    status = case when 'active' in (k.status, d.status) then 'active' else k.status end,
    created_at = least(created_at, d.created_at),
    needs_review = false
  where id = p_keep;
  insert into public.sms_activity (student_id, kind, summary, data)
  values (p_keep, 'system', 'Ficha fusionada con un duplicado (' || d.email || ')',
          jsonb_build_object('merged_id', p_drop, 'merged_email', d.email));
  return jsonb_build_object('ok', true, 'student_id', p_keep);
end $$;


-- ---------- Cola de mensajes ----------
-- Prepara el mensaje para la persona en su canal preferido. No envía nada.
create or replace function public.sms__enqueue_booking_message(p_booking uuid, p_kind text)
returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  b   public.sms_bookings%rowtype;
  s   public.sms_students%rowtype;
  st  jsonb := public.sms__settings();
  t   jsonb := coalesce(public.sms__settings()->'wa_templates', '{}'::jsonb);
  tz  text;
  tpl text; v_type text; v_channel text; v_to text; v_body text; v_subject text;
begin
  select * into b from public.sms_bookings where id = p_booking;
  if not found then return; end if;
  select * into s from public.sms_students where id = b.student_id;
  if s.id is null or s.anonymized_at is not null then return; end if;
  if p_kind = 'booking_reminder' and exists (
       select 1 from public.sms_outbox where booking_id = b.id and kind = 'booking_reminder' and status in ('pending','sent')) then
    return;
  end if;
  if s.preferred_contact = 'email' or s.whatsapp is null then
    v_channel := 'email'; v_to := s.email;
  else
    v_channel := 'whatsapp'; v_to := s.whatsapp;
  end if;
  -- Hora en la zona de la persona si la conocemos; si no, la del negocio.
  tz := coalesce(s.timezone, st->>'timezone', 'America/Bogota');
  select name into v_type from public.sms_session_types where code = b.session_type;
  tpl := case p_kind
    when 'booking_confirmed'   then coalesce(nullif(t->>'confirm', ''),    'Hola {nombre}, tu {tipo} quedó confirmada para el {fecha}. {enlace}')
    when 'booking_cancelled'   then coalesce(nullif(t->>'cancel', ''),     'Hola {nombre}, tu {tipo} del {fecha} fue cancelada. Escríbenos si quieres reprogramarla.')
    when 'booking_rescheduled' then coalesce(nullif(t->>'reschedule', ''), 'Hola {nombre}, tu {tipo} se movió al {fecha}. {enlace}')
    when 'booking_reminder'    then coalesce(nullif(t->>'reminder', ''),   'Hola {nombre}, te recuerdo tu {tipo} del {fecha}. {enlace}')
  end;
  v_body := replace(replace(replace(replace(tpl,
              '{nombre}', split_part(s.full_name, ' ', 1)),
              '{fecha}', to_char(b.starts_at at time zone tz, 'DD/MM/YYYY HH24:MI') || ' (hora de ' || replace(tz, '_', ' ') || ')'),
              '{tipo}', lower(coalesce(v_type, 'sesión'))),
              '{enlace}', coalesce(b.meeting_url, ''));
  -- Si la plantilla no menciona el enlace y la sesión lo tiene, se agrega al final.
  if b.meeting_url is not null and position('{enlace}' in tpl) = 0 and p_kind <> 'booking_cancelled' then
    v_body := v_body || E'\nEnlace: ' || b.meeting_url;
  end if;
  v_subject := case p_kind when 'booking_confirmed' then 'Tu sesión está confirmada'
                           when 'booking_cancelled' then 'Tu sesión fue cancelada'
                           when 'booking_rescheduled' then 'Tu sesión cambió de horario'
                           else 'Recordatorio de tu sesión' end || ' · ProfGermandario';
  -- Un mensaje nuevo sobre la misma sesión deja obsoletos los pendientes anteriores.
  if p_kind <> 'booking_reminder' then
    update public.sms_outbox set status = 'skipped', processed_at = now(), error = 'Reemplazado por un mensaje más reciente'
     where booking_id = b.id and status = 'pending'
       and (kind <> 'booking_reminder' or p_kind = 'booking_cancelled');
  end if;
  insert into public.sms_outbox (kind, channel, student_id, booking_id, recipient, subject, body)
  values (p_kind, v_channel, s.id, b.id, v_to, v_subject, left(btrim(v_body), 2000));
end $$;

-- Recordatorios de las sesiones confirmadas de las próximas 24 horas.
-- Lo llama el panel; también puede programarse con pg_cron (ver README).
create or replace function public.sms__enqueue_reminders() returns int
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare r record; n int := 0;
begin
  for r in select id from public.sms_bookings
            where status = 'confirmed' and reminder_enqueued_at is null
              and starts_at between now() and now() + interval '24 hours' loop
    perform public.sms__enqueue_booking_message(r.id, 'booking_reminder');
    update public.sms_bookings set reminder_enqueued_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.sms_outbox_refresh() returns int
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  perform public.sms__require_staff();
  perform public.sms__enqueue_reminders();
  return (select count(*) from public.sms_outbox where status = 'pending');
end $$;

-- Marca un mensaje como enviado (por la persona del equipo) u omitido.
create or replace function public.sms_outbox_mark(p_id uuid, p_status text) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare o public.sms_outbox%rowtype;
begin
  perform public.sms__require_staff();
  if p_status not in ('sent','skipped') then raise exception 'invalid_status' using errcode = '22023'; end if;
  update public.sms_outbox set status = p_status, processed_at = now(), processed_by = auth.uid()
   where id = p_id and status = 'pending'
  returning * into o;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_status = 'sent' and o.student_id is not null then
    insert into public.sms_activity (student_id, booking_id, kind, summary, data)
    values (o.student_id, o.booking_id, 'message',
            'Mensaje enviado por ' || case o.channel when 'email' then 'correo' else 'WhatsApp' end || ': ' || o.subject,
            jsonb_build_object('outbox_id', o.id, 'kind', o.kind, 'channel', o.channel));
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- Alta manual de un contacto desde el panel ----------
create or replace function public.sms_admin_create_contact(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  e jsonb := '{}'::jsonb;
  v_email text := public.sms__norm_email(p->>'email');
  v_name text := regexp_replace(btrim(coalesce(p->>'full_name', '')), '[[:space:]]+', ' ', 'g');
  v_phone text := public.sms__norm_phone(p->>'whatsapp');
  v_status text := coalesce(nullif(p->>'lead_status', ''), 'contacted');
  v_existing uuid;
  v_sid uuid;
  v_lid uuid;
begin
  perform public.sms__require_staff();
  if char_length(v_name) not between 2 and 120 then e := e || '{"full_name":"length"}'; end if;
  if v_email !~ '^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,24}$' then e := e || '{"email":"format"}'; end if;
  if coalesce(p->>'whatsapp', '') <> '' and v_phone is null then e := e || '{"whatsapp":"format"}'; end if;
  if coalesce(p->>'country', '') <> '' and upper(p->>'country') !~ '^[A-Z]{2}$' then e := e || '{"country":"invalid"}'; end if;
  if v_status not in ('new','contact_pending','contacted','awaiting_response','waitlist') then e := e || '{"lead_status":"invalid"}'; end if;
  if coalesce(p->>'objective', '') <> '' and p->>'objective' not in ('conversation','professional','interviews','academic','travel','from_zero','other') then e := e || '{"objective":"invalid"}'; end if;
  if coalesce(p->>'english_level', '') <> '' and p->>'english_level' not in ('beginner','elementary','intermediate','advanced','not_sure') then e := e || '{"english_level":"invalid"}'; end if;
  if coalesce(p->>'urgency', '') <> '' and p->>'urgency' not in ('asap','1_3_months','3_6_months','exploring') then e := e || '{"urgency":"invalid"}'; end if;
  if e <> '{}'::jsonb then return jsonb_build_object('ok', false, 'errors', e); end if;

  select id into v_existing from public.sms_students where email = v_email;
  if v_existing is not null then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_object('email', 'duplicate'), 'student_id', v_existing);
  end if;

  insert into public.sms_students (full_name, email, whatsapp, country, english_level, objective, occupation, urgency,
                                   preferred_contact, source, possible_duplicate_of, needs_review)
  values (v_name, v_email, v_phone, nullif(upper(p->>'country'), ''), nullif(p->>'english_level', ''),
          nullif(p->>'objective', ''), public.sms__clean_text(p->>'occupation', 120), nullif(p->>'urgency', ''),
          coalesce(nullif(p->>'preferred_contact', ''), 'whatsapp'), 'panel',
          (select id from public.sms_students where whatsapp = v_phone and v_phone is not null limit 1),
          exists (select 1 from public.sms_students where whatsapp = v_phone and v_phone is not null))
  returning id into v_sid;

  insert into public.sms_leads (student_id, source, objective, status, urgency)
  values (v_sid, 'panel', nullif(p->>'objective', ''), v_status, nullif(p->>'urgency', ''))
  returning id into v_lid;

  insert into public.sms_activity (student_id, lead_id, kind, summary, data)
  values (v_sid, v_lid, 'system', 'Contacto agregado manualmente desde el panel',
          jsonb_build_object('note', public.sms__clean_text(p->>'note', 500)));
  if public.sms__clean_text(p->>'note', 2000) is not null then
    insert into public.sms_activity (student_id, lead_id, kind, summary)
    values (v_sid, v_lid, 'note', public.sms__clean_text(p->>'note', 2000));
  end if;
  return jsonb_build_object('ok', true, 'student_id', v_sid, 'lead_id', v_lid);
end $$;

-- ---------- Respaldo completo (solo owner/admin) ----------
create or replace function public.sms_backup_export() returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare out jsonb;
begin
  perform public.sms__require_admin();
  select jsonb_build_object(
    'format', 'profgermandario-sms-backup', 'version', '1.1', 'exported_at', now(),
    'settings',           (select data from public.sms_settings where id = 1),
    'staff',              coalesce((select jsonb_agg(to_jsonb(x)) from public.sms_staff x), '[]'),
    'staff_invites',      coalesce((select jsonb_agg(to_jsonb(x)) from public.sms_staff_invites x), '[]'),
    'plans',              coalesce((select jsonb_agg(to_jsonb(x)) from public.sms_plans x), '[]'),
    'session_types',      coalesce((select jsonb_agg(to_jsonb(x)) from public.sms_session_types x), '[]'),
    'journey_steps',      coalesce((select jsonb_agg(to_jsonb(x)) from public.sms_journey_steps x), '[]'),
    'students',           coalesce((select jsonb_agg(to_jsonb(x)) from public.sms_students x), '[]'),
    'leads',              coalesce((select jsonb_agg(to_jsonb(x)) from public.sms_leads x), '[]'),
    'consents',           coalesce((select jsonb_agg(to_jsonb(x)) from public.sms_consents x), '[]'),
    'progress',           coalesce((select jsonb_agg(to_jsonb(x)) from public.sms_progress x), '[]'),
    'assessments',        coalesce((select jsonb_agg(to_jsonb(x)) from public.sms_assessments x), '[]'),
    'availability_rules', coalesce((select jsonb_agg(to_jsonb(x)) from public.sms_availability_rules x), '[]'),
    'availability_exceptions', coalesce((select jsonb_agg(to_jsonb(x)) from public.sms_availability_exceptions x), '[]'),
    'bookings',           coalesce((select jsonb_agg(to_jsonb(x)) from public.sms_bookings x), '[]'),
    'payments',           coalesce((select jsonb_agg(to_jsonb(x)) from public.sms_payments x), '[]'),
    'tasks',              coalesce((select jsonb_agg(to_jsonb(x)) from public.sms_tasks x), '[]'),
    'activity',           coalesce((select jsonb_agg(to_jsonb(x)) from public.sms_activity x), '[]'),
    'outbox',             coalesce((select jsonb_agg(to_jsonb(x)) from public.sms_outbox x), '[]'),
    'notifications',      coalesce((select jsonb_agg(to_jsonb(x)) from public.sms_notifications x), '[]')
  ) into out;
  insert into public.sms_activity (kind, summary, data)
  values ('export', 'Respaldo completo descargado', jsonb_build_object('entity', 'backup'));
  return out;
end $$;


-- ---------------------------------------------------------------------
-- 9. TRIGGERS: fechas automáticas e historial de actividad (auditoría)
-- ---------------------------------------------------------------------
create or replace function public.sms__touch() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['sms_plans','sms_students','sms_leads','sms_availability_rules','sms_bookings','sms_payments','sms_progress','sms_tasks'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.sms__touch()', t || '_touch', t);
  end loop;
end $$;

create or replace function public.sms__lead_before() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    if new.status = 'waitlist' then new.waitlist_joined_at := coalesce(new.waitlist_joined_at, clock_timestamp()); end if;
    if new.status = 'invitation_sent' then new.invitation_sent_at := now(); new.last_contact_at := now(); end if;
    if new.status in ('contacted','awaiting_response') then new.last_contact_at := now(); end if;
    if new.status = 'converted' then new.converted_at := coalesce(new.converted_at, now()); end if;
  end if;
  return new;
end $$;
drop trigger if exists sms_leads_before on public.sms_leads;
create trigger sms_leads_before before insert or update on public.sms_leads
  for each row execute function public.sms__lead_before();

create or replace function public.sms__lead_after() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status is distinct from old.status then
    insert into public.sms_activity (student_id, lead_id, kind, summary, data)
    values (new.student_id, new.id, 'status',
            'Lead: ' || public.sms__label('lead', old.status) || ' → ' || public.sms__label('lead', new.status),
            jsonb_build_object('entity', 'lead', 'from', old.status, 'to', new.status));
  end if;
  if new.next_follow_up_at is distinct from old.next_follow_up_at and new.next_follow_up_at is not null then
    insert into public.sms_activity (student_id, lead_id, kind, summary, data)
    values (new.student_id, new.id, 'follow_up', 'Seguimiento programado para ' || public.sms__fmt(new.next_follow_up_at),
            jsonb_build_object('at', new.next_follow_up_at));
  end if;
  if new.priority_boost is distinct from old.priority_boost then
    insert into public.sms_activity (student_id, lead_id, kind, summary, data)
    values (new.student_id, new.id, 'system', 'Prioridad manual: ' || old.priority_boost || ' → ' || new.priority_boost,
            jsonb_build_object('from', old.priority_boost, 'to', new.priority_boost));
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    insert into public.sms_activity (student_id, lead_id, kind, summary, data)
    values (new.student_id, new.id, 'system',
            'Asignado a ' || coalesce((select coalesce(display_name, email) from public.sms_staff where user_id = new.assigned_to), 'nadie'),
            jsonb_build_object('assigned_to', new.assigned_to));
  end if;
  return null;
end $$;
drop trigger if exists sms_leads_after on public.sms_leads;
create trigger sms_leads_after after update on public.sms_leads
  for each row execute function public.sms__lead_after();

create or replace function public.sms__student_after() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if new.source = 'admin' then
      insert into public.sms_activity (student_id, kind, summary) values (new.id, 'system', 'Ficha creada manualmente desde el panel');
    end if;
    return null;
  end if;
  if new.anonymized_at is not null then return null; end if;
  if new.status is distinct from old.status then
    insert into public.sms_activity (student_id, kind, summary, data)
    values (new.id, 'status', 'Estudiante: ' || public.sms__label('student', old.status) || ' → ' || public.sms__label('student', new.status),
            jsonb_build_object('entity', 'student', 'from', old.status, 'to', new.status));
  end if;
  if new.plan_id is distinct from old.plan_id then
    insert into public.sms_activity (student_id, kind, summary, data)
    values (new.id, 'system', 'Plan: ' || coalesce((select name from public.sms_plans where id = new.plan_id), 'sin plan'),
            jsonb_build_object('plan_id', new.plan_id));
  end if;
  if new.next_follow_up_at is distinct from old.next_follow_up_at and new.next_follow_up_at is not null then
    insert into public.sms_activity (student_id, kind, summary, data)
    values (new.id, 'follow_up', 'Seguimiento programado para ' || public.sms__fmt(new.next_follow_up_at),
            jsonb_build_object('at', new.next_follow_up_at));
  end if;
  return null;
end $$;
drop trigger if exists sms_students_after on public.sms_students;
create trigger sms_students_after after insert or update on public.sms_students
  for each row execute function public.sms__student_after();

create or replace function public.sms__booking_before() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  -- Si la sesión cambia de hora, su recordatorio debe volver a prepararse.
  if tg_op = 'UPDATE' and new.starts_at is distinct from old.starts_at then
    new.reminder_enqueued_at := null;
  end if;
  return new;
end $$;
drop trigger if exists sms_bookings_before on public.sms_bookings;
create trigger sms_bookings_before before update on public.sms_bookings
  for each row execute function public.sms__booking_before();

create or replace function public.sms__booking_after() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    insert into public.sms_activity (student_id, lead_id, booking_id, kind, summary, data)
    values (new.student_id, new.lead_id, new.id, 'booking',
            'Sesión ' || lower(public.sms__label('booking', new.status)) || ' · ' || public.sms__fmt(new.starts_at)
            || case when new.origin = 'public' then ' (desde la web)' else '' end,
            jsonb_build_object('status', new.status, 'starts_at', new.starts_at, 'origin', new.origin));
    if new.status = 'confirmed' then
      perform public.sms__enqueue_booking_message(new.id, 'booking_confirmed');
    end if;
  else
    if new.status is distinct from old.status then
      insert into public.sms_activity (student_id, lead_id, booking_id, kind, summary, data)
      values (new.student_id, new.lead_id, new.id, 'booking',
              'Sesión ' || public.sms__fmt(new.starts_at) || ': ' || public.sms__label('booking', old.status)
              || ' → ' || public.sms__label('booking', new.status),
              jsonb_build_object('from', old.status, 'to', new.status));
      if new.status = 'confirmed' then
        perform public.sms__enqueue_booking_message(new.id, 'booking_confirmed');
      elsif new.status in ('cancelled','rejected') and old.status in ('requested','confirmed') then
        perform public.sms__enqueue_booking_message(new.id, 'booking_cancelled');
      end if;
    end if;
    if new.starts_at is distinct from old.starts_at then
      insert into public.sms_activity (student_id, lead_id, booking_id, kind, summary, data)
      values (new.student_id, new.lead_id, new.id, 'booking',
              'Sesión reprogramada: ' || public.sms__fmt(old.starts_at) || ' → ' || public.sms__fmt(new.starts_at),
              jsonb_build_object('from', old.starts_at, 'to', new.starts_at));
      if new.status in ('requested','confirmed') and new.status is not distinct from old.status then
        perform public.sms__enqueue_booking_message(new.id, 'booking_rescheduled');
      end if;
    end if;
  end if;
  -- Una sesión confirmada mueve el lead abierto a "Reserva confirmada".
  if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status is distinct from 'confirmed') then
    update public.sms_leads set status = 'booking_confirmed'
     where student_id = new.student_id
       and status in ('new','contact_pending','contacted','awaiting_response','waitlist','invitation_sent','booking_requested');
  end if;
  return null;
end $$;
drop trigger if exists sms_bookings_after on public.sms_bookings;
create trigger sms_bookings_after after insert or update on public.sms_bookings
  for each row execute function public.sms__booking_after();

create or replace function public.sms__task_before() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;
  return new;
end $$;
drop trigger if exists sms_tasks_before on public.sms_tasks;
create trigger sms_tasks_before before insert or update on public.sms_tasks
  for each row execute function public.sms__task_before();

create or replace function public.sms__task_after() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.student_id is null then return null; end if;
  if tg_op = 'INSERT' then
    insert into public.sms_activity (student_id, lead_id, kind, summary, data)
    values (new.student_id, new.lead_id, 'task', 'Tarea programada: ' || new.title || ' (para ' || public.sms__fmt(new.due_at) || ')',
            jsonb_build_object('task_id', new.id, 'kind', new.kind, 'due_at', new.due_at));
  elsif new.status is distinct from old.status and new.status in ('done','cancelled') then
    insert into public.sms_activity (student_id, lead_id, kind, summary, data)
    values (new.student_id, new.lead_id, 'task',
            'Tarea ' || case new.status when 'done' then 'completada' else 'cancelada' end || ': ' || new.title,
            jsonb_build_object('task_id', new.id, 'status', new.status));
  end if;
  return null;
end $$;
drop trigger if exists sms_tasks_after on public.sms_tasks;
create trigger sms_tasks_after after insert or update on public.sms_tasks
  for each row execute function public.sms__task_after();

create or replace function public.sms__assessment_after() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.sms_activity (student_id, kind, summary, data)
  values (new.student_id, 'assessment',
          'Evaluación de ' || lower(public.sms__label('skill', new.skill)) || ': ' || new.result
          || case when new.score is not null then ' (' || new.score || '/100)' else '' end,
          jsonb_build_object('assessment_id', new.id, 'skill', new.skill, 'score', new.score));
  return null;
end $$;
drop trigger if exists sms_assessments_after on public.sms_assessments;
create trigger sms_assessments_after after insert on public.sms_assessments
  for each row execute function public.sms__assessment_after();

create or replace function public.sms__payment_after() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.sms_activity (student_id, payment_id, kind, summary, data)
    values (new.student_id, new.id, 'payment',
            'Pago ' || lower(public.sms__label('payment', new.status)) || ': ' || new.currency || ' '
            || to_char(new.amount, 'FM999G999G990D00') || ' · ' || new.concept,
            jsonb_build_object('status', new.status, 'amount', new.amount, 'currency', new.currency));
  end if;
  -- Un pago cobrado con período extiende la fecha de renovación del plan.
  if new.status = 'paid' and new.period_end is not null
     and (tg_op = 'INSERT' or old.status is distinct from 'paid' or old.period_end is distinct from new.period_end) then
    update public.sms_students set plan_renews_at = new.period_end
     where id = new.student_id and (plan_renews_at is null or plan_renews_at < new.period_end);
  end if;
  return null;
end $$;
drop trigger if exists sms_payments_after on public.sms_payments;
create trigger sms_payments_after after insert or update on public.sms_payments
  for each row execute function public.sms__payment_after();

create or replace function public.sms__progress_before() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.status = 'in_progress' then new.started_at := coalesce(new.started_at, now()); end if;
  if new.status = 'completed' then
    new.started_at := coalesce(new.started_at, now());
    new.completed_at := coalesce(new.completed_at, now());
  elsif new.status <> 'completed' then
    new.completed_at := null;
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
drop trigger if exists sms_progress_before on public.sms_progress;
create trigger sms_progress_before before insert or update on public.sms_progress
  for each row execute function public.sms__progress_before();

create or replace function public.sms__progress_after() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status or new.score is distinct from old.score then
    insert into public.sms_activity (student_id, kind, summary, data)
    values (new.student_id, 'progress',
            'Paso ' || new.step_no || ' · ' || coalesce((select title from public.sms_journey_steps where step_no = new.step_no), '')
            || ': ' || public.sms__label('progress', new.status)
            || case when new.score is not null then ' (' || new.score || '%)' else '' end,
            jsonb_build_object('step', new.step_no, 'status', new.status, 'score', new.score));
    if new.status = 'completed' then
      update public.sms_students set current_step = greatest(coalesce(current_step, 0), new.step_no + 1)
       where id = new.student_id and new.step_no + 1 <= 99;
    elsif new.status = 'in_progress' then
      update public.sms_students set current_step = new.step_no
       where id = new.student_id and current_step is null;
    end if;
  end if;
  return null;
end $$;
drop trigger if exists sms_progress_after on public.sms_progress;
create trigger sms_progress_after after insert or update on public.sms_progress
  for each row execute function public.sms__progress_after();

-- Registrar un contacto actualiza el lead (última fecha y estado "Contactado").
create or replace function public.sms__activity_after() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.kind = 'contact' and new.student_id is not null then
    update public.sms_leads set
      last_contact_at = now(),
      status = case when status in ('new','contact_pending') then 'contacted' else status end
    where student_id = new.student_id and status not in ('converted','not_interested','archived');
  end if;
  return null;
end $$;
drop trigger if exists sms_activity_after on public.sms_activity;
create trigger sms_activity_after after insert on public.sms_activity
  for each row execute function public.sms__activity_after();

-- Protección del equipo: siempre debe quedar al menos un owner activo, y
-- solo un owner puede crear/modificar owners.
create or replace function public.sms__staff_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare acting_owner boolean := public.sms_is_owner() or auth.uid() is null;
begin
  if tg_op in ('UPDATE','DELETE') and old.role = 'owner' and not acting_owner then
    raise exception 'owner_only' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.role = 'owner' and old.role <> 'owner' and not acting_owner then
    raise exception 'owner_only' using errcode = '42501';
  end if;
  if tg_op in ('UPDATE','DELETE') and old.role = 'owner' and old.active
     and (tg_op = 'DELETE' or new.role <> 'owner' or not new.active)
     and (select count(*) from public.sms_staff where role = 'owner' and active and user_id <> old.user_id) = 0 then
    raise exception 'last_owner' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists sms_staff_guard on public.sms_staff;
create trigger sms_staff_guard before update or delete on public.sms_staff
  for each row execute function public.sms__staff_guard();

create or replace function public.sms__invite_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.role = 'owner' and auth.uid() is not null and not public.sms_is_owner() then
    raise exception 'owner_only' using errcode = '42501';
  end if;
  new.invited_by := coalesce(new.invited_by, auth.uid());
  return new;
end $$;
drop trigger if exists sms_invite_guard on public.sms_staff_invites;
create trigger sms_invite_guard before insert or update on public.sms_staff_invites
  for each row execute function public.sms__invite_guard();


-- ---------------------------------------------------------------------
-- 10. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['sms_settings','sms_secrets','sms_staff','sms_staff_invites','sms_plans','sms_students',
    'sms_leads','sms_consents','sms_submissions','sms_rate_events','sms_journey_steps','sms_progress',
    'sms_availability_rules','sms_availability_exceptions','sms_bookings','sms_payments','sms_activity','sms_notifications',
    'sms_session_types','sms_tasks','sms_assessments','sms_outbox'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Limpieza de políticas previas (re-ejecución segura).
do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' and tablename like 'sms\_%' loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Lectura para todo el equipo; escritura para el equipo; borrado solo admin.
do $$ declare t text; begin
  foreach t in array array['sms_students','sms_leads','sms_bookings','sms_progress','sms_notifications','sms_tasks','sms_assessments'] loop
    execute format('create policy %I on public.%I for select to authenticated using ((select public.sms_is_staff()))', t || '_sel', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select public.sms_is_staff()))', t || '_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select public.sms_is_staff())) with check ((select public.sms_is_staff()))', t || '_upd', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select public.sms_is_admin()))', t || '_del', t);
  end loop;
  -- Catálogos: lectura del equipo, escritura solo admin.
  foreach t in array array['sms_plans','sms_journey_steps','sms_availability_rules','sms_availability_exceptions','sms_session_types'] loop
    execute format('create policy %I on public.%I for select to authenticated using ((select public.sms_is_staff()))', t || '_sel', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select public.sms_is_admin()))', t || '_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select public.sms_is_admin())) with check ((select public.sms_is_admin()))', t || '_upd', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select public.sms_is_admin()))', t || '_del', t);
  end loop;
end $$;

-- Pagos: solo owner/admin.
create policy sms_payments_admin on public.sms_payments for all to authenticated
  using ((select public.sms_is_admin())) with check ((select public.sms_is_admin()));

-- Historial: el equipo lee todo (los pagos solo admin); el equipo solo puede
-- añadir notas, contactos y seguimientos a su nombre. Nada se edita.
create policy sms_activity_sel on public.sms_activity for select to authenticated
  using ((select public.sms_is_staff()) and (kind <> 'payment' or (select public.sms_is_admin())));
create policy sms_activity_ins on public.sms_activity for insert to authenticated
  with check ((select public.sms_is_staff()) and kind in ('note','contact','follow_up') and actor_id = auth.uid());
create policy sms_activity_del on public.sms_activity for delete to authenticated
  using ((select public.sms_is_admin()) and kind = 'note');

create policy sms_consents_sel on public.sms_consents for select to authenticated
  using ((select public.sms_is_staff()));

create policy sms_settings_sel on public.sms_settings for select to authenticated
  using ((select public.sms_is_staff()));

create policy sms_staff_sel on public.sms_staff for select to authenticated
  using ((select public.sms_is_staff()));
create policy sms_staff_upd on public.sms_staff for update to authenticated
  using ((select public.sms_is_admin())) with check ((select public.sms_is_admin()));
create policy sms_staff_del on public.sms_staff for delete to authenticated
  using ((select public.sms_is_admin()));

create policy sms_invites_admin on public.sms_staff_invites for all to authenticated
  using ((select public.sms_is_admin())) with check ((select public.sms_is_admin()));

-- Cola de mensajes: el equipo la ve; solo cambia por sms_outbox_mark().
create policy sms_outbox_sel on public.sms_outbox for select to authenticated
  using ((select public.sms_is_staff()));

-- sms_secrets, sms_submissions, sms_rate_events: sin políticas → nadie desde la API.


-- ---------------------------------------------------------------------
-- 11. PRIVILEGIOS
-- ---------------------------------------------------------------------
do $$ declare r record; begin
  for r in select c.relname, c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname like 'sms\_%' and c.relkind in ('r','v','S') loop
    if r.relkind = 'S' then
      execute format('revoke all on sequence public.%I from anon, public', r.relname);
      execute format('grant usage, select on sequence public.%I to authenticated', r.relname);
    else
      execute format('revoke all on public.%I from anon, public', r.relname);
      if r.relkind = 'v' then
        execute format('revoke all on public.%I from authenticated', r.relname);
        execute format('grant select on public.%I to authenticated', r.relname);
      elsif r.relname in ('sms_secrets','sms_submissions','sms_rate_events') then
        execute format('revoke all on public.%I from authenticated', r.relname);
      else
        execute format('revoke all on public.%I from authenticated', r.relname);
        execute format('grant select, insert, update, delete on public.%I to authenticated', r.relname);
      end if;
    end if;
  end loop;
end $$;
revoke insert, update, delete on public.sms_settings, public.sms_consents, public.sms_outbox from authenticated;
revoke update, delete on public.sms_activity from authenticated;
grant delete on public.sms_activity to authenticated;

do $$ declare r record; begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'sms\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

-- Público (formularios web)
grant execute on function public.sms_public_config()            to anon, authenticated;
grant execute on function public.sms_register(jsonb)            to anon, authenticated;
grant execute on function public.sms_join_waitlist(jsonb)       to anon, authenticated;
grant execute on function public.sms_public_slots(date, int)    to anon, authenticated;
grant execute on function public.sms_request_booking(jsonb)     to anon, authenticated;
-- Panel (las funciones verifican internamente el rol)
grant execute on function public.sms_is_staff()                 to authenticated;
grant execute on function public.sms_is_admin()                 to authenticated;
grant execute on function public.sms_is_owner()                 to authenticated;
grant execute on function public.sms_whoami()                   to authenticated;
grant execute on function public.sms_settings_get()             to authenticated;
grant execute on function public.sms_update_settings(jsonb)     to authenticated;
grant execute on function public.sms_dashboard()                to authenticated;
grant execute on function public.sms_admin_slots(date, int)     to authenticated;
grant execute on function public.sms_convert_lead(uuid, uuid, date) to authenticated;
grant execute on function public.sms_mark_notifications_read(bigint[]) to authenticated;
grant execute on function public.sms_log_export(text, int)      to authenticated;
grant execute on function public.sms_student_export(uuid)       to authenticated;
grant execute on function public.sms_anonymize_student(uuid)    to authenticated;
grant execute on function public.sms_merge_students(uuid, uuid) to authenticated;
grant execute on function public.sms_outbox_refresh()           to authenticated;
grant execute on function public.sms_outbox_mark(uuid, text)    to authenticated;
grant execute on function public.sms_admin_create_contact(jsonb) to authenticated;
grant execute on function public.sms_backup_export()            to authenticated;


-- ---------------------------------------------------------------------
-- 12. TIEMPO REAL (aviso instantáneo de nuevos registros en el panel)
-- ---------------------------------------------------------------------
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sms_notifications') then
    execute 'alter publication supabase_realtime add table public.sms_notifications';
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 13. DATOS INICIALES
-- ---------------------------------------------------------------------
insert into public.sms_secrets (key, value)
values ('ip_salt', md5(random()::text || clock_timestamp()::text) || replace(gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

insert into public.sms_settings (id, data) values (1, jsonb_build_object(
  'timezone', 'America/Bogota',
  'privacy_policy_url', 'https://palekor.github.io/lecciones/sistema-estudiantes/privacidad/',
  'privacy_notice_version', '2026-10-23',
  'controller_name', 'ProfGermandario (Germandario Palekor)',
  'contact_email', (select owner_email from _sms_install),
  'contact_whatsapp', '+573197894038',
  'show_optional_fields', jsonb_build_object('comments', true, 'professional_goals', true, 'referral_source', true),
  'extra_questions', '[]'::jsonb,
  'referral_options', jsonb_build_array('Instagram','TikTok','YouTube','LinkedIn','Facebook','Google','WhatsApp','Recomendación de alguien','Otro'),
  'waitlist_enabled', true,
  'waitlist_order', 'registered',
  'booking_enabled', true,
  'booking_min_notice_hours', 12,
  'booking_max_days_ahead', 21,
  'booking_auto_confirm', false,
  'booking_max_pending_per_student', 2,
  'wa_templates', jsonb_build_object(
    'invite',   'Hola {nombre} 👋 Soy Germandario de ProfGermandario. Recibí tu registro y tengo un espacio para ti. ¿Te queda bien agendar tu sesión aquí? {link}',
    'followup', 'Hola {nombre}, ¿cómo vas? Te escribo para dar seguimiento a tu objetivo con el inglés. ¿Seguimos?',
    'confirm',  'Hola {nombre}, tu {tipo} quedó confirmada para el {fecha}. ¡Nos vemos! {enlace}')
)) on conflict (id) do nothing;

-- Claves nuevas de la v1.1: se agregan solo si no existen (no pisan cambios del panel).
update public.sms_settings set data =
  jsonb_build_object(
    'cancellation_policy', 'Puedes cancelar o reprogramar sin costo avisando por WhatsApp con al menos 24 horas de anticipación. Las ausencias sin aviso cuentan como sesión realizada.',
    'status_labels', '{}'::jsonb)
  || data
  || jsonb_build_object('wa_templates',
       jsonb_build_object(
         'cancel',     'Hola {nombre}, tu {tipo} del {fecha} fue cancelada. Escríbeme si quieres reprogramarla.',
         'reschedule', 'Hola {nombre}, tu {tipo} se movió al {fecha}. {enlace}',
         'reminder',   'Hola {nombre}, te recuerdo tu {tipo} del {fecha}. {enlace}')
       || coalesce(data->'wa_templates', '{}'::jsonb))
where id = 1;

insert into public.sms_staff_invites (email, role, display_name)
select lower(owner_email), 'owner', owner_name from _sms_install
on conflict (email) do nothing;

-- Si el dueño ya tiene cuenta (por ejemplo, usa demoney.html), queda activo de una vez.
insert into public.sms_staff (user_id, email, display_name, role)
select u.id, lower(u.email), i.owner_name, 'owner'
from auth.users u join _sms_install i on lower(u.email) = lower(i.owner_email)
where u.email_confirmed_at is not null
on conflict (user_id) do nothing;
update public.sms_staff_invites set accepted_at = now()
 where accepted_at is null and email in (select email from public.sms_staff);

-- Planes (tomados de embudo.html; editables desde el panel).
insert into public.sms_plans (name, price, currency, billing, hours_per_month, description, sort)
select * from (values
  ('Acceso',         25.00, 'USD', 'monthly',  null::numeric, 'Mapa de ruta, sesiones grupales, recursos y comunidad', 1),
  ('Acceso anual',  240.00, 'USD', 'yearly',   null,          'Plan Acceso con pago anual', 2),
  ('Impulso',       140.00, 'USD', 'monthly',  6,             '6 horas de coaching personalizado al mes', 3),
  ('Dominio',       480.00, 'USD', 'monthly',  24,            '24 horas de coaching al mes (6 h semanales)', 4),
  ('Dedicated',     940.00, 'USD', 'monthly',  24,            'Todo lo de Dominio + material exclusivo y feedback profesional en cada paso', 5)
) v(name, price, currency, billing, hours, descr, sort)
where not exists (select 1 from public.sms_plans);

-- Ruta de 18 pasos (los primeros se tomaron de steps/ y steps/map.txt; editables).
insert into public.sms_journey_steps (step_no, code, title, url) values
  (1,  '00a', 'Pronoun Logic — pronombres personales',  'https://palekor.github.io/lecciones/steps/step00a.html'),
  (2,  '00b', 'Verb Mode — verbos regulares e irregulares', 'https://palekor.github.io/lecciones/steps/step00b.html'),
  (3,  '00c', 'Verb Master Map',                         'https://palekor.github.io/lecciones/steps/step00c.html'),
  (4,  '00d', 'Noun Master Map',                         'https://palekor.github.io/lecciones/steps/step00d.html'),
  (5,  '01',  'The Sentence Engine — oraciones completas','https://palekor.github.io/lecciones/steps/step01.html'),
  (6,  '02',  'Chunk Logic — tres ideas conectadas',     'https://palekor.github.io/lecciones/steps/step02.html'),
  (7,  '03',  'WH Masterclass — preguntas',              'https://palekor.github.io/lecciones/steps/step03.html'),
  (8,  '04',  'The 44 Sounds — pronunciación',           'https://palekor.github.io/lecciones/steps/step04.html'),
  (9,  '05',  'Prepositions of Place',                   'https://palekor.github.io/lecciones/steps/step05.html'),
  (10, '06',  'Deictic Expressions — punto de referencia','https://palekor.github.io/lecciones/steps/step06.html'),
  (11, '07',  'Vocabulario y cognados',                  null),
  (12, null,  'Paso 12 (por definir)', null),
  (13, null,  'Paso 13 (por definir)', null),
  (14, null,  'Paso 14 (por definir)', null),
  (15, null,  'Paso 15 (por definir)', null),
  (16, null,  'Paso 16 (por definir)', null),
  (17, null,  'Paso 17 (por definir)', null),
  (18, null,  'Paso 18 (por definir)', null)
on conflict (step_no) do nothing;

-- Horario de ejemplo INACTIVO (actívalo o edítalo en /admin → Agenda).
insert into public.sms_availability_rules (weekday, start_time, end_time, slot_minutes, session_type, active, note)
select * from (values
  (1, '08:00'::time, '12:00'::time, 60, 'diagnostic', false, 'Ejemplo — activar en el panel'),
  (3, '08:00'::time, '12:00'::time, 60, 'diagnostic', false, 'Ejemplo — activar en el panel'),
  (5, '14:00'::time, '18:00'::time, 60, 'diagnostic', false, 'Ejemplo — activar en el panel')
) v(weekday, start_time, end_time, slot_minutes, session_type, active, note)
where not exists (select 1 from public.sms_availability_rules);

commit;

-- Verificación rápida (opcional): debe devolver la configuración pública.
-- select public.sms_public_config();
