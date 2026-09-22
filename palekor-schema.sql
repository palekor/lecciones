-- ============================================================
--  PALEKOR · base de datos compartida para todas las apps
--  (demoney, moneye, journal, wallet, external brain, ...)
--
--  CÓMO USARLO
--  1. Supabase → SQL Editor → New query
--  2. Pega TODO este archivo y presiona "Run"
--  3. Al final verás UNA fila:  docs | true | 4 | true
--     (tabla con seguridad activada, 4 reglas y la función de
--     fusión instalada). Si ves eso, listo.
--
--  Se puede correr más de una vez sin romper nada.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Una sola tabla para todas las apps
--    Cada fila = un bloque de datos de UNA app de UN usuario.
--    Ejemplo: (tu usuario, 'demoney', 'watch') → tu watchlist
-- ------------------------------------------------------------
create table if not exists public.docs (
  user_id     uuid        not null default auth.uid()
                          references auth.users (id) on delete cascade,
  app         text        not null check (char_length(app) between 1 and 40),
  key         text        not null check (char_length(key) between 1 and 60),
  data        jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (user_id, app, key)
);

comment on table public.docs is
  'Datos de cada usuario por app. Protegida con Row Level Security: cada quien solo ve lo suyo.';

create index if not exists docs_user_app_idx on public.docs (user_id, app);


-- ------------------------------------------------------------
-- 2. La fecha de actualización la pone el servidor, no el
--    teléfono (los relojes de los dispositivos no son confiables)
-- ------------------------------------------------------------
create or replace function public.docs_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists docs_touch on public.docs;
create trigger docs_touch
  before insert or update on public.docs
  for each row execute function public.docs_touch();


-- ------------------------------------------------------------
-- 3. SEGURIDAD — la parte que no se negocia
--    Sin estas reglas, la llave pública del HTML permitiría
--    leer los datos de todos. Con ellas, cada usuario solo
--    puede ver, crear, editar y borrar SUS propias filas.
-- ------------------------------------------------------------
alter table public.docs enable row level security;
alter table public.docs force row level security;

drop policy if exists "docs: leer lo propio"    on public.docs;
drop policy if exists "docs: crear lo propio"   on public.docs;
drop policy if exists "docs: editar lo propio"  on public.docs;
drop policy if exists "docs: borrar lo propio"  on public.docs;

create policy "docs: leer lo propio"
  on public.docs for select
  to authenticated
  using ( (select auth.uid()) = user_id );

create policy "docs: crear lo propio"
  on public.docs for insert
  to authenticated
  with check ( (select auth.uid()) = user_id );

create policy "docs: editar lo propio"
  on public.docs for update
  to authenticated
  using      ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

create policy "docs: borrar lo propio"
  on public.docs for delete
  to authenticated
  using ( (select auth.uid()) = user_id );

-- Los visitantes sin sesión no tienen ningún acceso.
revoke all on public.docs from anon;
grant select, insert, update, delete on public.docs to authenticated;


-- ------------------------------------------------------------
-- 4. Límite de tamaño por fila (256 KB) — evita que un error
--    en una app llene la base de datos gratuita
-- ------------------------------------------------------------
alter table public.docs drop constraint if exists docs_size_limit;
alter table public.docs add constraint docs_size_limit
  check (pg_column_size(data) <= 262144);


-- ------------------------------------------------------------
-- 5. FUSIÓN ATÓMICA
--    Si el celular y el computador guardan la misma lista al
--    mismo tiempo, ninguno pisa al otro: la base de datos bloquea
--    la fila, combina elemento por elemento (gana el más reciente
--    según "_u") y respeta los borrados ("tomb").
--    Corre con los permisos de quien la llama → las reglas de
--    seguridad de arriba siguen aplicando.
-- ------------------------------------------------------------
create or replace function public.docs_merge(p_app text, p_key text, p_data jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid      uuid := auth.uid();
  cur      jsonb;
  items    jsonb;
  tomb     jsonb;
  result   jsonb;
  k        text;
  v        jsonb;
  cutoff   numeric := extract(epoch from now())::numeric * 1000 - 90::numeric * 86400000;
begin
  if uid is null then
    raise exception 'sin sesión' using errcode = '42501';
  end if;

  -- bloquea la fila mientras se fusiona
  select d.data into cur
    from public.docs d
   where d.user_id = uid and d.app = p_app and d.key = p_key
   for update;

  if cur is null then
    insert into public.docs (user_id, app, key, data)
    values (uid, p_app, p_key, p_data)
    on conflict (user_id, app, key) do nothing;
    if found then
      return p_data;
    end if;
    -- otro dispositivo la creó en este mismo instante
    select d.data into cur
      from public.docs d
     where d.user_id = uid and d.app = p_app and d.key = p_key
     for update;
  end if;

  if p_data ? 'v' then
    -- objeto único (perfil, ajustes): gana el más reciente
    if coalesce((p_data #>> '{v,_u}')::numeric, 0) >= coalesce((cur #>> '{v,_u}')::numeric, 0) then
      result := p_data;
    else
      result := cur;
    end if;
  else
    -- colección: combinar elemento por elemento
    items := coalesce(cur -> 'items', '{}'::jsonb);
    tomb  := coalesce(cur -> 'tomb',  '{}'::jsonb);

    for k, v in select * from jsonb_each(coalesce(p_data -> 'tomb', '{}'::jsonb)) loop
      if not (tomb ? k) or (v)::text::numeric > (tomb ->> k)::numeric then
        tomb := jsonb_set(tomb, array[k], v);
      end if;
    end loop;

    for k, v in select * from jsonb_each(coalesce(p_data -> 'items', '{}'::jsonb)) loop
      if not (items ? k)
         or coalesce((v ->> '_u')::numeric, 0) > coalesce((items -> k ->> '_u')::numeric, 0) then
        items := jsonb_set(items, array[k], v);
      end if;
    end loop;

    for k, v in select * from jsonb_each(tomb) loop
      if items ? k and coalesce((items -> k ->> '_u')::numeric, 0) <= (v)::text::numeric then
        items := items - k;
      end if;
      if (v)::text::numeric < cutoff then
        tomb := tomb - k;
      end if;
    end loop;

    result := jsonb_build_object('items', items, 'tomb', tomb);
  end if;

  update public.docs d
     set data = result
   where d.user_id = uid and d.app = p_app and d.key = p_key;

  return result;
end;
$$;

revoke all on function public.docs_merge(text, text, jsonb) from public, anon;
grant execute on function public.docs_merge(text, text, jsonb) to authenticated;


-- ------------------------------------------------------------
-- 6. VERIFICACIÓN — corre esto al final y revisa el resultado
--    Debe mostrar rowsecurity = true y 4 políticas.
-- ------------------------------------------------------------
select
  c.relname                              as tabla,
  c.relrowsecurity                       as rowsecurity,
  (select count(*) from pg_policies p
    where p.schemaname = 'public'
      and p.tablename  = 'docs')         as politicas,
  exists (select 1 from pg_proc
           where proname = 'docs_merge') as fusion
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'docs';
