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

create policy profiles_self on public.profiles for select using(auth.uid()=id or public.is_admin_or_owner());
create policy movies_public on public.movies for select using(status='published');
create policy series_public on public.series for select using(status='published');
create policy genres_public on public.genres for select using(true);
create policy movie_genres_public on public.movie_genres for select using(true);
create policy series_genres_public on public.series_genres for select using(true);
create policy people_public on public.people for select using(true);
create policy movie_cast_public on public.movie_cast for select using(true);
create policy series_cast_public on public.series_cast for select using(true);
create policy seasons_public on public.seasons for select using(exists(select 1 from public.series s where s.id=series_id and s.status='published'));
create policy episodes_public on public.episodes for select using(exists(select 1 from public.seasons se join public.series s on s.id=se.series_id where se.id=season_id and s.status='published'));
create policy sources_public on public.playback_sources for select using(is_working=true and (expires_at is null or expires_at>now()));
create policy watchlist_self on public.watchlist for all using(auth.uid()=user_id) with check(auth.uid()=user_id);
create policy history_self on public.watch_history for all using(auth.uid()=user_id) with check(auth.uid()=user_id);
create policy reports_insert_self on public.reports for insert with check(auth.uid()=user_id);
create policy reports_read_admin on public.reports for select using(auth.uid()=user_id or public.is_admin_or_owner());
create policy providers_admin on public.providers for select using(public.is_admin_or_owner());
create policy mappings_admin on public.provider_mappings for all using(public.is_admin_or_owner()) with check(public.is_admin_or_owner());
create policy sources_admin on public.playback_sources for all using(public.is_admin_or_owner()) with check(public.is_admin_or_owner());
create policy audit_admin on public.audit_logs for select using(public.is_admin_or_owner());

-- Bootstrap OWNER only after the first trusted account exists:
-- update public.profiles set role='OWNER' where id='<AUTH_USER_UUID>';
