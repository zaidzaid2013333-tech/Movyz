-- Movyz / Supabase clean baseline
-- Runtime architecture:
--   Cloudflare Worker: static delivery + same-origin TMDB proxy
--   TMDB: live catalog/search/details/seasons/episodes
--   Supabase: auth/profile + user-owned watchlist/history + reports/audit
--
-- IMPORTANT:
-- This file intentionally contains NO catalog tables, providers, resolvers,
-- playback sources, sync jobs, queues, or backend runtime functions.
--
-- Historical migrations in supabase/migrations are kept for migration history.
-- The live database has already been reduced to the five user-data tables below.

begin;

create extension if not exists pgcrypto;

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'user_role'
  ) then
    create type public.user_role as enum ('USER','ADMIN','OWNER');
  end if;
end
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.user_role not null default 'USER',
  display_name text not null default '',
  avatar_url text,
  locale text not null default 'ar' check (locale in ('ar','en')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.watchlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  content_type text not null check (content_type in ('movie','series')),
  content_id text not null,
  created_at timestamptz not null default now(),
  unique (user_id, content_type, content_id)
);

create table if not exists public.watch_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  content_type text not null check (content_type in ('movie','episode')),
  content_id text not null,
  position_seconds integer not null default 0,
  duration_seconds integer not null default 0,
  completed boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (user_id, content_type, content_id)
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  content_id text not null,
  content_type text not null check (content_type in ('movie','episode')),
  issue_type text not null,
  description text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'display_name',
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      ''
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_admin_or_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select exists(
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('ADMIN','OWNER')
  );
$function$;

revoke execute on function public.is_admin_or_owner() from public, anon, authenticated, service_role;

alter table public.profiles enable row level security;
alter table public.watchlist enable row level security;
alter table public.watch_history enable row level security;
alter table public.reports enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists profiles_self on public.profiles;
create policy profiles_self
on public.profiles
for select
to authenticated
using (
  (select auth.uid()) = id
  or exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role in ('ADMIN','OWNER')
  )
);

drop policy if exists watchlist_self on public.watchlist;
create policy watchlist_self
on public.watchlist
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists history_self on public.watch_history;
create policy history_self
on public.watch_history
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists reports_insert_self on public.reports;
create policy reports_insert_self
on public.reports
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists reports_read_admin on public.reports;
create policy reports_read_admin
on public.reports
for select
to authenticated
using (
  (select auth.uid()) = user_id
  or exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role in ('ADMIN','OWNER')
  )
);

drop policy if exists audit_admin on public.audit_logs;
create policy audit_admin
on public.audit_logs
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role in ('ADMIN','OWNER')
  )
);

create index if not exists watchlist_user_created_idx
  on public.watchlist(user_id, created_at desc);

create index if not exists watch_history_user_updated_idx
  on public.watch_history(user_id, updated_at desc);

create index if not exists reports_user_idx
  on public.reports(user_id);

create index if not exists audit_logs_actor_idx
  on public.audit_logs(actor_id);

notify pgrst, 'reload schema';

commit;
