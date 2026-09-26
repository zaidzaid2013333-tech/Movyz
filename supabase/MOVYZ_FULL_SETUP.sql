-- Movyz database one-shot setup.
-- Run this file once in Supabase SQL Editor.
-- It applies the schema, sync tracking, timestamp triggers,
-- provider hardening, and provider seed data in dependency order.


-- ============================================================
-- supabase/migrations/202609250001_initial_movyz_schema.sql
-- ============================================================

begin;

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

do $$ begin
  create type public.user_role as enum ('USER','ADMIN','OWNER');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.content_status as enum ('draft','published','archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.source_type as enum ('hls','mp4','dash');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.user_role not null default 'USER',
  display_name text not null default '',
  avatar_url text,
  locale text not null default 'ar' check (locale in ('ar','en')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.movies (
  id uuid primary key default gen_random_uuid(),
  tmdb_id integer unique,
  title_ar text not null,
  title_en text,
  original_title text,
  alternative_titles jsonb not null default '[]'::jsonb,
  overview_ar text,
  overview_en text,
  poster_url text,
  backdrop_url text,
  release_date date,
  runtime_minutes integer,
  rating numeric(3,1) not null default 0,
  vote_count integer not null default 0,
  age_rating text,
  status public.content_status not null default 'published',
  featured boolean not null default false,
  trending boolean not null default false,
  popular boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.series (
  id uuid primary key default gen_random_uuid(),
  tmdb_id integer unique,
  title_ar text not null,
  title_en text,
  original_title text,
  alternative_titles jsonb not null default '[]'::jsonb,
  overview_ar text,
  overview_en text,
  poster_url text,
  backdrop_url text,
  first_air_date date,
  last_air_date date,
  rating numeric(3,1) not null default 0,
  vote_count integer not null default 0,
  age_rating text,
  status public.content_status not null default 'published',
  featured boolean not null default false,
  trending boolean not null default false,
  popular boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.genres (
  id integer primary key,
  name_ar text not null,
  name_en text not null,
  slug text not null unique
);

create table if not exists public.movie_genres (
  movie_id uuid references public.movies(id) on delete cascade,
  genre_id integer references public.genres(id) on delete cascade,
  primary key(movie_id,genre_id)
);

create table if not exists public.series_genres (
  series_id uuid references public.series(id) on delete cascade,
  genre_id integer references public.genres(id) on delete cascade,
  primary key(series_id,genre_id)
);

create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  tmdb_id integer unique,
  name_ar text,
  name_en text,
  original_name text,
  avatar_url text
);

create table if not exists public.movie_cast (
  movie_id uuid references public.movies(id) on delete cascade,
  person_id uuid references public.people(id) on delete cascade,
  character_ar text,
  character_en text,
  cast_order integer not null default 0,
  primary key(movie_id,person_id)
);

create table if not exists public.series_cast (
  series_id uuid references public.series(id) on delete cascade,
  person_id uuid references public.people(id) on delete cascade,
  character_ar text,
  character_en text,
  cast_order integer not null default 0,
  primary key(series_id,person_id)
);

create table if not exists public.seasons (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.series(id) on delete cascade,
  tmdb_id integer,
  season_number integer not null,
  name_ar text,
  name_en text,
  overview_ar text,
  overview_en text,
  poster_url text,
  air_date date,
  unique(series_id,season_number)
);

create table if not exists public.episodes (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  tmdb_id integer,
  episode_number integer not null,
  name_ar text,
  name_en text,
  overview_ar text,
  overview_en text,
  still_url text,
  air_date date,
  runtime_minutes integer,
  unique(season_id,episode_number)
);

create table if not exists public.providers (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  adapter_name text not null,
  enabled boolean not null default true,
  status text not null default 'unknown',
  latency_ms integer,
  success_rate numeric(5,2),
  last_checked_at timestamptz
);

create table if not exists public.provider_mappings (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete cascade,
  content_type text not null check(content_type in ('movie','series','season','episode')),
  internal_content_id uuid not null,
  provider_content_id text not null,
  confidence numeric(5,2) not null default 0,
  status text not null default 'active',
  unique(provider_id,content_type,internal_content_id)
);

create table if not exists public.playback_sources (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid references public.providers(id) on delete set null,
  content_type text not null check(content_type in ('movie','episode')),
  content_id uuid not null,
  source_type public.source_type not null,
  url text,
  provider_reference text,
  quality text,
  language text,
  label_ar text,
  label_en text,
  expires_at timestamptz,
  is_working boolean not null default true,
  last_checked_at timestamptz,
  failure_count integer not null default 0
);

create table if not exists public.watchlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  content_type text not null check(content_type in ('movie','series')),
  content_id uuid not null,
  created_at timestamptz not null default now(),
  unique(user_id,content_type,content_id)
);

create table if not exists public.watch_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  content_type text not null check(content_type in ('movie','episode')),
  content_id uuid not null,
  position_seconds integer not null default 0,
  duration_seconds integer not null default 0,
  completed boolean not null default false,
  updated_at timestamptz not null default now(),
  unique(user_id,content_type,content_id)
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  content_id uuid not null,
  content_type text not null check(content_type in ('movie','episode')),
  source_id uuid references public.playback_sources(id) on delete set null,
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

create index if not exists movies_title_ar_idx on public.movies using gin(title_ar gin_trgm_ops);
create index if not exists movies_title_en_idx on public.movies using gin(title_en gin_trgm_ops);
create index if not exists series_title_ar_idx on public.series using gin(title_ar gin_trgm_ops);
create index if not exists series_title_en_idx on public.series using gin(title_en gin_trgm_ops);
create index if not exists seasons_series_idx on public.seasons(series_id,season_number);
create index if not exists episodes_season_idx on public.episodes(season_id,episode_number);
create index if not exists sources_content_idx on public.playback_sources(content_type,content_id,is_working);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id,display_name)
  values(new.id,coalesce(new.raw_user_meta_data->>'display_name',split_part(new.email,'@',1),''))
  on conflict(id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.is_admin_or_owner() returns boolean
language sql stable security definer set search_path=public as $$
select exists(select 1 from public.profiles where id=auth.uid() and role in('ADMIN','OWNER')) $$;

alter table public.profiles enable row level security;
alter table public.movies enable row level security;
alter table public.series enable row level security;
alter table public.genres enable row level security;
alter table public.movie_genres enable row level security;
alter table public.series_genres enable row level security;
alter table public.people enable row level security;
alter table public.movie_cast enable row level security;
alter table public.series_cast enable row level security;
alter table public.seasons enable row level security;
alter table public.episodes enable row level security;
alter table public.providers enable row level security;
alter table public.provider_mappings enable row level security;
alter table public.playback_sources enable row level security;
alter table public.watchlist enable row level security;
alter table public.watch_history enable row level security;
alter table public.reports enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles for select using(auth.uid()=id or public.is_admin_or_owner());
drop policy if exists movies_public on public.movies;
create policy movies_public on public.movies for select using(status='published');
drop policy if exists series_public on public.series;
create policy series_public on public.series for select using(status='published');
drop policy if exists genres_public on public.genres;
create policy genres_public on public.genres for select using(true);
drop policy if exists movie_genres_public on public.movie_genres;
create policy movie_genres_public on public.movie_genres for select using(true);
drop policy if exists series_genres_public on public.series_genres;
create policy series_genres_public on public.series_genres for select using(true);
drop policy if exists people_public on public.people;
create policy people_public on public.people for select using(true);
drop policy if exists movie_cast_public on public.movie_cast;
create policy movie_cast_public on public.movie_cast for select using(true);
drop policy if exists series_cast_public on public.series_cast;
create policy series_cast_public on public.series_cast for select using(true);
drop policy if exists seasons_public on public.seasons;
create policy seasons_public on public.seasons for select using(exists(select 1 from public.series s where s.id=series_id and s.status='published'));
drop policy if exists episodes_public on public.episodes;
create policy episodes_public on public.episodes for select using(exists(select 1 from public.seasons se join public.series s on s.id=se.series_id where se.id=season_id and s.status='published'));
drop policy if exists sources_public on public.playback_sources;
create policy sources_public on public.playback_sources for select using(is_working=true and (expires_at is null or expires_at>now()));
drop policy if exists watchlist_self on public.watchlist;
create policy watchlist_self on public.watchlist for all using(auth.uid()=user_id) with check(auth.uid()=user_id);
drop policy if exists history_self on public.watch_history;
create policy history_self on public.watch_history for all using(auth.uid()=user_id) with check(auth.uid()=user_id);
drop policy if exists reports_insert_self on public.reports;
create policy reports_insert_self on public.reports for insert with check(auth.uid()=user_id);
drop policy if exists reports_read_admin on public.reports;
create policy reports_read_admin on public.reports for select using(auth.uid()=user_id or public.is_admin_or_owner());
drop policy if exists providers_admin on public.providers;
create policy providers_admin on public.providers for select using(public.is_admin_or_owner());
drop policy if exists mappings_admin on public.provider_mappings;
create policy mappings_admin on public.provider_mappings for all using(public.is_admin_or_owner()) with check(public.is_admin_or_owner());
drop policy if exists sources_admin on public.playback_sources;
create policy sources_admin on public.playback_sources for all using(public.is_admin_or_owner()) with check(public.is_admin_or_owner());
drop policy if exists audit_admin on public.audit_logs;
create policy audit_admin on public.audit_logs for select using(public.is_admin_or_owner());

-- Bootstrap OWNER only after the first trusted account exists:
-- update public.profiles set role='OWNER' where id='<AUTH_USER_UUID>';

commit;


-- ============================================================
-- supabase/migrations/202609250002_sync_jobs_and_timestamps.sql
-- ============================================================

-- Sync job tracking and timestamp triggers.
-- Safe/idempotent migration for Movyz, including partially initialized databases.

begin;

create extension if not exists pgcrypto;

-- Repair/guarantee the authorization helper before any policy references it.
-- The function is intentionally security-definer so its profile lookup is
-- evaluated with the function owner's privileges instead of caller RLS.
create or replace function public.is_admin_or_owner()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $function$
begin
  if to_regclass('public.profiles') is null then
    return false;
  end if;

  return exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('ADMIN','OWNER')
  );
end;
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


-- ============================================================
-- supabase/migrations/202609260003_provider_hardening.sql
-- ============================================================

-- Provider hardening and playback-source deduplication.
-- Safe to apply after the initial Movyz migrations.

begin;

-- providers.updated_at is normally created by migration 002.
-- Keep this migration safe when run independently.
alter table if exists public.providers
  add column if not exists updated_at timestamptz not null default now();

-- Remove duplicate source rows before creating the unique index.
do $dedupe$
begin
  if to_regclass('public.playback_sources') is not null then
    execute $sql$
      delete from public.playback_sources older
      using public.playback_sources newer
      where older.id < newer.id
        and older.provider_id is not distinct from newer.provider_id
        and older.content_type = newer.content_type
        and older.content_id = newer.content_id
        and older.url is not null
        and older.url = newer.url
    $sql$;

    execute $sql$
      create unique index if not exists playback_sources_provider_content_url_uidx
        on public.playback_sources(provider_id, content_type, content_id, url)
        where url is not null
    $sql$;
  end if;
end
$dedupe$;

-- The trigger function is created by migration 002. Recreate it safely
-- so this migration also works after an older/incomplete 002.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

do $provider$
begin
  if to_regclass('public.providers') is not null then
    execute 'drop trigger if exists providers_updated_at on public.providers';
    execute 'create trigger providers_updated_at
      before update on public.providers
      for each row
      execute function public.set_updated_at()';

    execute $sql$
      insert into public.providers(key, name, adapter_name, enabled, status)
      values
        ('ezvidapi', 'ezvidAPI', 'ezvidapi', true, 'unknown'),
        ('egybest', 'EgyBest', 'egybest', true, 'unknown'),
        ('streamprovider', 'StreamProvider', 'streamprovider', true, 'unknown'),
        ('nhdapi', 'NHD API', 'nhdapi', true, 'unknown'),
        ('faselhd', 'FaselHD', 'faselhd', true, 'unknown')
      on conflict (key) do update
      set name = excluded.name,
          adapter_name = excluded.adapter_name
    $sql$;
  end if;
end
$provider$;

commit;



-- ============================================================
-- supabase/migrations/202609260004_pre_sync_hardening.sql
-- ============================================================

-- Pre-sync hardening: prevent concurrent TMDB runs and improve job observability.
begin;

alter table if exists public.sync_jobs
  add column if not exists stage text not null default 'queued';

alter table if exists public.sync_jobs
  add column if not exists details jsonb not null default '{}'::jsonb;

-- Close duplicate/abandoned running jobs before installing the uniqueness guard.
with ranked as (
  select id,
         row_number() over (
           partition by provider
           order by created_at desc nulls last, id desc
         ) as rn
  from public.sync_jobs
  where status = 'running'
)
update public.sync_jobs j
set status = 'failed',
    stage = 'failed',
    error = coalesce(j.error, 'Closed during pre-sync hardening because another running job is newer.'),
    finished_at = coalesce(j.finished_at, now())
where j.id in (select id from ranked where rn > 1);

drop index if exists sync_jobs_one_running_idx;
create unique index if not exists sync_jobs_one_running_idx
  on public.sync_jobs(provider)
  where status = 'running';

create index if not exists sync_jobs_stage_idx
  on public.sync_jobs(stage);

-- Playback URLs are required by the API and by the resolver's upsert conflict target.
-- Remove malformed legacy rows before enforcing the invariant.
do $cleanup$
begin
  if to_regclass('public.playback_sources') is not null then
    execute 'delete from public.playback_sources where url is null';
    execute 'alter table public.playback_sources alter column url set not null';

    execute 'drop index if exists playback_sources_provider_content_url_uidx';
    execute 'create unique index if not exists playback_sources_provider_content_url_uidx
      on public.playback_sources(provider_id, content_type, content_id, url)';
  end if;
end
$cleanup$;

-- Useful indexes for catalog and integrity checks.
create index if not exists seasons_tmdb_idx on public.seasons(tmdb_id);
create index if not exists episodes_tmdb_idx on public.episodes(tmdb_id);
create index if not exists provider_mappings_content_idx
  on public.provider_mappings(content_type, internal_content_id, status);

commit;

-- End of Movyz database setup.
