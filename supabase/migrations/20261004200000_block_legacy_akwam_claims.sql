-- Keep legacy parallel Akwam/CinePro workers from claiming new queue jobs.
create or replace function public.claim_akwam_prefill_job(p_worker_id text, p_lease_seconds integer default 300)
returns table(id uuid, content_type text, content_id uuid, tmdb_id integer, season_number integer, episode_number integer, attempts integer)
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_id uuid;
begin
  if coalesce(p_worker_id,'') ~ '^akwam-[0-9]+$' then
    return;
  end if;

  select j.id into v_id
  from public.playback_source_jobs j
  where j.provider_lane = 'primary'
    and (
      (j.status = 'pending' and j.available_at <= now())
      or
      (j.status = 'running' and coalesce(j.locked_at,to_timestamp(0)) < now() - make_interval(secs => greatest(60,p_lease_seconds)))
    )
  order by j.priority desc,j.available_at asc,j.created_at asc,j.id
  for update skip locked
  limit 1;

  if v_id is null then
    return;
  end if;

  update public.playback_source_jobs j
  set status='running',
      attempts=j.attempts+1,
      locked_at=now(),
      locked_by=p_worker_id,
      last_attempt_at=now(),
      updated_at=now()
  where j.id=v_id;

  return query
  select j.id,j.content_type,j.content_id,
    case when j.content_type='movie' then m.tmdb_id
         when j.content_type='episode' then s.tmdb_id
         else null end,
    case when j.content_type='episode' then se.season_number else null end,
    case when j.content_type='episode' then e.episode_number else null end,
    j.attempts
  from public.playback_source_jobs j
  left join public.movies m on j.content_type='movie' and m.id=j.content_id
  left join public.episodes e on j.content_type='episode' and e.id=j.content_id
  left join public.seasons se on j.content_type='episode' and se.id=e.season_id
  left join public.series s on j.content_type='episode' and s.id=se.series_id
  where j.id=v_id;
end;
$function$;