begin;

drop trigger if exists trg_reject_persistent_akwam_source on public.playback_sources;
drop function if exists public.reject_persistent_akwam_source();

alter table public.playback_source_jobs enable row level security;

drop function if exists public.claim_akwam_prefill_job(text, integer);

create or replace function public.claim_akwam_prefill_job(
  p_worker_id text,
  p_lease_seconds integer default 300
)
returns table(
  id uuid,
  content_type text,
  content_id uuid,
  tmdb_id integer,
  season_number integer,
  episode_number integer,
  attempts integer
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_id uuid;
begin
  select j.id into v_id
  from public.playback_source_jobs j
  where j.provider_lane = 'primary'
    and (
      (j.status = 'pending' and j.available_at <= now())
      or (j.status = 'running' and coalesce(j.locked_at, to_timestamp(0)) < now() - interval '5 minutes')
    )
  order by j.priority desc, j.available_at asc, j.created_at asc, j.id
  for update skip locked
  limit 1;

  if v_id is null then
    return;
  end if;

  update public.playback_source_jobs j
  set
    status = 'running',
    attempts = j.attempts + 1,
    locked_at = now(),
    locked_by = p_worker_id,
    last_attempt_at = now(),
    updated_at = now()
  where j.id = v_id;

  return query
  select
    j.id,
    j.content_type,
    j.content_id,
    case when j.content_type = 'movie' then m.tmdb_id
         when j.content_type = 'episode' then s.tmdb_id end as tmdb_id,
    case when j.content_type = 'episode' then se.season_number end as season_number,
    case when j.content_type = 'episode' then e.episode_number end as episode_number,
    j.attempts
  from public.playback_source_jobs j
  left join public.movies m on j.content_type = 'movie' and m.id = j.content_id
  left join public.episodes e on j.content_type = 'episode' and e.id = j.content_id
  left join public.seasons se on j.content_type = 'episode' and se.id = e.season_id
  left join public.series s on j.content_type = 'episode' and s.id = se.series_id
  where j.id = v_id;
end;
$function$;

revoke all on function public.claim_akwam_prefill_job(text, integer) from public, anon, authenticated;
grant execute on function public.claim_akwam_prefill_job(text, integer) to service_role;

commit;
