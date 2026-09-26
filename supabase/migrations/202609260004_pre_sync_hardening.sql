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
           partition by provider, job_type
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
