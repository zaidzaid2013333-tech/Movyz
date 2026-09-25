create table if not exists public.sync_jobs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  job_type text not null,
  status text not null default 'queued' check(status in ('queued','running','succeeded','failed')),
  pages integer,
  movies_synced integer not null default 0,
  series_synced integer not null default 0,
  seasons_synced integer not null default 0,
  episodes_synced integer not null default 0,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists sync_jobs_created_idx on public.sync_jobs(created_at desc);

alter table public.sync_jobs enable row level security;

drop policy if exists sync_jobs_admin on public.sync_jobs;
create policy sync_jobs_admin on public.sync_jobs
  for select using (public.is_admin_or_owner());

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles
for each row execute procedure public.set_updated_at();

drop trigger if exists movies_updated_at on public.movies;
create trigger movies_updated_at before update on public.movies
for each row execute procedure public.set_updated_at();

drop trigger if exists series_updated_at on public.series;
create trigger series_updated_at before update on public.series
for each row execute procedure public.set_updated_at();

drop trigger if exists providers_updated_at on public.providers;
create trigger providers_updated_at before update on public.providers
for each row execute procedure public.set_updated_at();
