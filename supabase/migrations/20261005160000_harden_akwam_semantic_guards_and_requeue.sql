begin;

create temp table _akwam_bad_sources on commit drop as
with bad_episode as (
  select p.id, p.content_type, p.content_id
  from public.playback_sources p
  join public.episodes e on p.content_type='episode' and p.content_id=e.id
  join public.seasons se on se.id=e.season_id
  where p.is_working=true
    and (regexp_match(lower(p.url),'(?:^|[^a-z0-9])s0*([0-9]{1,3})[^a-z0-9]{0,8}e(?:p)?0*([0-9]{1,3})(?:[^0-9]|$)')) is not null
    and (
      (regexp_match(lower(p.url),'(?:^|[^a-z0-9])s0*([0-9]{1,3})[^a-z0-9]{0,8}e(?:p)?0*([0-9]{1,3})(?:[^0-9]|$)'))[1]::int <> se.season_number
      or
      (regexp_match(lower(p.url),'(?:^|[^a-z0-9])s0*([0-9]{1,3})[^a-z0-9]{0,8}e(?:p)?0*([0-9]{1,3})(?:[^0-9]|$)'))[2]::int <> e.episode_number
    )
),
cross_content as (
  select p.id, p.content_type, p.content_id
  from public.playback_sources p
  where p.is_working=true
    and p.url in (
      select url
      from public.playback_sources
      where is_working=true
      group by url
      having count(distinct content_type || ':' || content_id::text) > 1
    )
)
select distinct id, content_type, content_id
from (
  select * from bad_episode
  union all
  select * from cross_content
) bad;

update public.playback_sources p
set is_working=false,
    failure_count=coalesce(p.failure_count,0)+1,
    last_checked_at=now()
where p.id in (select id from _akwam_bad_sources);

update public.playback_source_jobs j
set status='pending',
    available_at=now(),
    attempts=0,
    locked_at=null,
    locked_by=null,
    last_attempt_at=null,
    source_count=0,
    last_success_at=null,
    next_check_at=null,
    last_error=null,
    updated_at=now(),
    details=coalesce(j.details,'{}'::jsonb) || jsonb_build_object(
      'requeued_after_semantic_audit', true,
      'reason','source_semantic_mismatch_or_cross_content_duplicate'
    )
where j.provider_lane='primary'
  and j.status in ('succeeded','failed')
  and exists (
    select 1
    from _akwam_bad_sources b
    where b.content_type=j.content_type
      and b.content_id=j.content_id
  )
  and not exists (
    select 1
    from public.playback_sources s
    where s.content_type=j.content_type
      and s.content_id=j.content_id
      and s.is_working=true
  )
  and not exists (
    select 1
    from public.playback_source_jobs other
    where other.id<>j.id
      and other.provider_lane='primary'
      and other.content_type=j.content_type
      and other.content_id=j.content_id
      and other.status in ('pending','running')
  );

CREATE OR REPLACE FUNCTION public.claim_akwam_prefill_job(p_worker_id text, p_lease_seconds integer DEFAULT 300)
 RETURNS TABLE(id uuid, content_type text, content_id uuid, tmdb_id integer, season_number integer, episode_number integer, attempts integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_id uuid;
begin
  if coalesce(p_worker_id,'') ~ '^akwam-[0-9]+$' then
    return;
  end if;

  -- Movies remain the first lane. Reclaim stale movie work before taking new movie work.
  select j.id into v_id
  from public.playback_source_jobs j
  where j.provider_lane='primary'
    and j.content_type='movie'
    and j.status='running'
    and coalesce(j.locked_at,to_timestamp(0)) < now() - make_interval(secs => greatest(60,p_lease_seconds))
    and not exists (
      select 1 from public.playback_sources s
      where s.content_type=j.content_type
        and s.content_id=j.content_id
        and s.is_working=true
    )
  order by j.locked_at asc, j.priority desc, j.created_at asc, j.attempts asc, j.id
  for update skip locked
  limit 1;

  if v_id is null then
    select j.id into v_id
    from public.playback_source_jobs j
    where j.provider_lane='primary'
      and j.content_type='movie'
      and j.status='pending'
      and j.available_at <= now()
      and not exists (
        select 1 from public.playback_sources s
        where s.content_type=j.content_type
          and s.content_id=j.content_id
          and s.is_working=true
      )
    order by j.priority desc, j.available_at asc, j.created_at asc, j.attempts asc, j.id
    for update skip locked
    limit 1;
  end if;

  -- Episodes are second priority, with the same stale-work protection.
  if v_id is null then
    select j.id into v_id
    from public.playback_source_jobs j
    where j.provider_lane='primary'
      and j.content_type='episode'
      and j.status='running'
      and coalesce(j.locked_at,to_timestamp(0)) < now() - make_interval(secs => greatest(60,p_lease_seconds))
      and not exists (
        select 1 from public.playback_sources s
        where s.content_type=j.content_type
          and s.content_id=j.content_id
          and s.is_working=true
      )
    order by j.locked_at asc, j.priority desc, j.created_at asc, j.attempts asc, j.id
    for update skip locked
    limit 1;
  end if;

  if v_id is null then
    select j.id into v_id
    from public.playback_source_jobs j
    where j.provider_lane='primary'
      and j.content_type='episode'
      and j.status='pending'
      and j.available_at <= now()
      and not exists (
        select 1 from public.playback_sources s
        where s.content_type=j.content_type
          and s.content_id=j.content_id
          and s.is_working=true
      )
    order by j.priority desc, j.available_at asc, j.created_at asc, j.attempts asc, j.id
    for update skip locked
    limit 1;
  end if;

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
  select j.id,
         j.content_type,
         j.content_id,
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
$function$
;

CREATE OR REPLACE FUNCTION public.persist_akwam_prefill_job(p_job_id uuid, p_provider_id uuid, p_sources jsonb, p_worker_id text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_content_type text;
  v_content_id uuid;
  v_now timestamptz := now();
  v_new integer := 0;
  v_total integer := 0;
  v_movie_year integer;
  v_episode_season integer;
  v_episode_number integer;
begin
  select j.content_type, j.content_id
    into v_content_type, v_content_id
  from public.playback_source_jobs j
  where j.id=p_job_id
  for update;

  if not found then
    raise exception 'AKWAM_PERSIST_JOB_NOT_FOUND %', p_job_id;
  end if;

  if jsonb_typeof(p_sources) <> 'array' or jsonb_array_length(p_sources)=0 then
    raise exception 'AKWAM_PERSIST_EMPTY_SOURCES';
  end if;

  if v_content_type='movie' then
    select extract(year from m.release_date)::integer
      into v_movie_year
    from public.movies m
    where m.id=v_content_id;
  elsif v_content_type='episode' then
    select s.season_number, e.episode_number
      into v_episode_season, v_episode_number
    from public.episodes e
    join public.seasons s on s.id=e.season_id
    where e.id=v_content_id;
  end if;

  -- Re-validate and re-enable exact URLs already quarantined for this content.
  with candidate as (
    select distinct on (x.url) x.*
    from jsonb_to_recordset(p_sources) as x(
      source_type text,
      content_id uuid,
      url text,
      provider_reference text,
      quality text,
      language text,
      label_ar text,
      label_en text,
      expires_at timestamptz,
      is_working boolean,
      failure_count integer,
      subtitle_url text,
      subtitle_type text,
      subtitle_language text,
      subtitle_label_ar text,
      subtitle_label_en text,
      subtitle_default boolean
    )
    where x.url ~ '^https://'
      and x.source_type in ('hls','mp4','dash','webm','direct')
      and (
        v_content_type<>'movie'
        or v_movie_year is null
        or (regexp_match(lower(x.url),'((?:19|20)[0-9]{2})')) is null
        or abs((regexp_match(lower(x.url),'((?:19|20)[0-9]{2})'))[1]::integer-v_movie_year)<=3
      )
      and (
        v_content_type<>'episode'
        or v_episode_season is null
        or v_episode_number is null
        or (regexp_match(lower(x.url),'(?:^|[^a-z0-9])s0*([0-9]{1,3})[^a-z0-9]{0,8}e(?:p)?0*([0-9]{1,3})(?:[^0-9]|$)')) is null
        or (
          (regexp_match(lower(x.url),'(?:^|[^a-z0-9])s0*([0-9]{1,3})[^a-z0-9]{0,8}e(?:p)?0*([0-9]{1,3})(?:[^0-9]|$)'))[1]::integer=v_episode_season
          and
          (regexp_match(lower(x.url),'(?:^|[^a-z0-9])s0*([0-9]{1,3})[^a-z0-9]{0,8}e(?:p)?0*([0-9]{1,3})(?:[^0-9]|$)'))[2]::integer=v_episode_number
        )
      )
    order by x.url
  )
  update public.playback_sources s
  set is_working=true,
      last_checked_at=v_now,
      failure_count=0,
      quality=nullif(candidate.quality,''),
      language=coalesce(nullif(candidate.language,''),'und'),
      label_ar=candidate.label_ar,
      label_en=candidate.label_en
  from candidate
  where s.provider_id=p_provider_id
    and s.content_type=v_content_type
    and s.content_id=v_content_id
    and s.url=candidate.url;

  -- Add only genuinely new URLs; existing rows are never deleted during a re-run.
  with candidate as (
    select distinct on (x.url) x.*
    from jsonb_to_recordset(p_sources) as x(
      source_type text,
      content_id uuid,
      url text,
      provider_reference text,
      quality text,
      language text,
      label_ar text,
      label_en text,
      expires_at timestamptz,
      is_working boolean,
      failure_count integer,
      subtitle_url text,
      subtitle_type text,
      subtitle_language text,
      subtitle_label_ar text,
      subtitle_label_en text,
      subtitle_default boolean
    )
    where x.url ~ '^https://'
      and x.source_type in ('hls','mp4','dash','webm','direct')
      and (
        v_content_type<>'movie'
        or v_movie_year is null
        or (regexp_match(lower(x.url),'((?:19|20)[0-9]{2})')) is null
        or abs((regexp_match(lower(x.url),'((?:19|20)[0-9]{2})'))[1]::integer-v_movie_year)<=3
      )
      and (
        v_content_type<>'episode'
        or v_episode_season is null
        or v_episode_number is null
        or (regexp_match(lower(x.url),'(?:^|[^a-z0-9])s0*([0-9]{1,3})[^a-z0-9]{0,8}e(?:p)?0*([0-9]{1,3})(?:[^0-9]|$)')) is null
        or (
          (regexp_match(lower(x.url),'(?:^|[^a-z0-9])s0*([0-9]{1,3})[^a-z0-9]{0,8}e(?:p)?0*([0-9]{1,3})(?:[^0-9]|$)'))[1]::integer=v_episode_season
          and
          (regexp_match(lower(x.url),'(?:^|[^a-z0-9])s0*([0-9]{1,3})[^a-z0-9]{0,8}e(?:p)?0*([0-9]{1,3})(?:[^0-9]|$)'))[2]::integer=v_episode_number
        )
      )
    order by x.url
  )
  insert into public.playback_sources (
    provider_id, content_type, source_type, content_id, url,
    provider_reference, quality, language, label_ar, label_en,
    expires_at, is_working, last_checked_at, failure_count,
    subtitle_url, subtitle_type, subtitle_language,
    subtitle_label_ar, subtitle_label_en, subtitle_default
  )
  select
    p_provider_id,
    v_content_type,
    x.source_type::public.source_type,
    v_content_id,
    x.url,
    'akwam',
    nullif(x.quality,''),
    coalesce(nullif(x.language,''),'und'),
    x.label_ar,
    x.label_en,
    null,
    true,
    v_now,
    0,
    null,null,null,null,null,
    coalesce(x.subtitle_default,false)
  from candidate x
  where not exists (
    select 1
    from public.playback_sources s
    where s.provider_id=p_provider_id
      and s.is_working=true
      and s.url=x.url
  );

  get diagnostics v_new = row_count;

  select count(*) into v_total
  from public.playback_sources s
  where s.provider_id=p_provider_id
    and s.content_type=v_content_type
    and s.content_id=v_content_id
    and s.is_working=true;

  if v_total=0 then
    raise exception 'AKWAM_PERSIST_NO_VALID_ROWS';
  end if;

  update public.playback_source_jobs
  set status='succeeded',
      source_count=v_new,
      attempts=0,
      locked_at=null,
      locked_by=null,
      last_success_at=v_now,
      next_check_at=v_now + interval '1 day',
      updated_at=v_now,
      last_error=null,
      details=jsonb_build_object(
        'provider','akwam',
        'mode','db-only-prefill',
        'worker',p_worker_id,
        'stored_new',v_new,
        'total_working',v_total,
        'semantic_guard',true,
        'dedupe_safe',true
      )
  where id=p_job_id;

  return v_new;
end;
$function$
;

commit;