-- Pre-sync hardening: prevent concurrent TMDB runs and improve job observability.
begin;

alter table if exists public.sync_jobs
  add column if not exists stage text not null default 'queued';

alter table if exists public.sync_jobs
  add column if not exists details jsonb not null default '{}'::jsonb;

create index if not exists sync_jobs_stage_idx
  on public.sync_jobs(stage);

drop index if exists sync_jobs_one_running_idx;
create unique index if not exists sync_jobs_one_running_idx
  on public.sync_jobs(provider, job_type)
  where status = 'running';

-- Useful indexes for catalog and integrity checks.
create index if not exists seasons_tmdb_idx on public.seasons(tmdb_id);
create index if not exists episodes_tmdb_idx on public.episodes(tmdb_id);
create index if not exists provider_mappings_content_idx
  on public.provider_mappings(content_type, internal_content_id, status);

commit;
