-- Sync job tracking and timestamp triggers.
-- Safe/idempotent migration for Movyz, including partially initialized databases.

begin;

create extension if not exists pgcrypto;

-- Repair/guarantee the authorization helper before any policy references it.
-- The function is intentionally security-definer so its profile lookup is
-- evaluated with the function owner's privileges instead of caller RLS.
create or replace function public.is_admin_or_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('ADMIN','OWNER')
  );
$function$;

-- Keep provider.updated_at available before its trigger is installed.
alter table if exists public.providers
  add column if not exists updated_at timestamptz not null default now();

-- Sync execution history.
create table if not exists public.sync_jobs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  job_type text not null,
  status text not null default 'queued'
    check (status in ('queued','running','succeeded','failed')),
  pages integer,
  movies_synced integer not null default 0,
  series_synced integer not null default 0,
  seasons_synced integer not null default 0,
  episodes_synced integer not null default 0,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sync_jobs_created_idx
  on public.sync_jobs(created_at desc);

create index if not exists sync_jobs_status_idx
  on public.sync_jobs(status);

alter table public.sync_jobs enable row level security;

drop policy if exists sync_jobs_admin on public.sync_jobs;

create policy sync_jobs_admin
on public.sync_jobs
for select
to authenticated
using (public.is_admin_or_owner());

-- Generic updated_at trigger.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

-- Recreate triggers safely. Skip a table if an earlier/base migration has not
-- created it yet; the base migration remains responsible for those tables.
do $trigger$
begin
  if to_regclass('public.profiles') is not null then
    execute 'drop trigger if exists profiles_updated_at on public.profiles';
    execute 'create trigger profiles_updated_at
      before update on public.profiles
      for each row execute function public.set_updated_at()';
  end if;

  if to_regclass('public.movies') is not null then
    execute 'drop trigger if exists movies_updated_at on public.movies';
    execute 'create trigger movies_updated_at
      before update on public.movies
      for each row execute function public.set_updated_at()';
  end if;

  if to_regclass('public.series') is not null then
    execute 'drop trigger if exists series_updated_at on public.series';
    execute 'create trigger series_updated_at
      before update on public.series
      for each row execute function public.set_updated_at()';
  end if;

  if to_regclass('public.providers') is not null then
    execute 'drop trigger if exists providers_updated_at on public.providers';
    execute 'create trigger providers_updated_at
      before update on public.providers
      for each row execute function public.set_updated_at()';
  end if;

  if to_regclass('public.sync_jobs') is not null then
    execute 'drop trigger if exists sync_jobs_updated_at on public.sync_jobs';
    execute 'create trigger sync_jobs_updated_at
      before update on public.sync_jobs
      for each row execute function public.set_updated_at()';
  end if;
end
$trigger$;

commit;
