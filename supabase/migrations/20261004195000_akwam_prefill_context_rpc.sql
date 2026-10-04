create or replace function public.get_akwam_prefill_context(p_job_id uuid)
returns table(
  content_type text,
  content_id uuid,
  titles text[],
  year integer,
  season_number integer,
  episode_number integer
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select
    j.content_type,
    j.content_id,
    case
      when j.content_type = 'movie' then array_remove(array[m.title_en, m.title_ar, m.original_title], null)
      when j.content_type = 'episode' then array_remove(array[s.title_en, s.title_ar, s.original_title], null)
      else array[]::text[]
    end as titles,
    case
      when j.content_type = 'movie' then nullif(left(m.release_date::text, 4), '')::integer
      when j.content_type = 'episode' then nullif(left(s.first_air_date::text, 4), '')::integer
      else null
    end as year,
    case when j.content_type = 'episode' then se.season_number else null end,
    case when j.content_type = 'episode' then e.episode_number else null end
  from public.playback_source_jobs j
  left join public.movies m
    on j.content_type = 'movie' and m.id = j.content_id
  left join public.episodes e
    on j.content_type = 'episode' and e.id = j.content_id
  left join public.seasons se
    on j.content_type = 'episode' and se.id = e.season_id
  left join public.series s
    on j.content_type = 'episode' and s.id = se.series_id
  where j.id = p_job_id
  limit 1;
$$;

revoke execute on function public.get_akwam_prefill_context(uuid) from public, anon, authenticated;
grant execute on function public.get_akwam_prefill_context(uuid) to service_role;
