begin;

drop table if exists public.playback_source_jobs cascade;
drop table if exists public.maintenance_failures cascade;
drop table if exists public.maintenance_state cascade;
drop table if exists public.sync_jobs cascade;

drop table if exists public.playback_sources cascade;
drop table if exists public.provider_mappings cascade;
drop table if exists public.providers cascade;

drop table if exists public.episodes cascade;
drop table if exists public.seasons cascade;
drop table if exists public.movie_cast cascade;
drop table if exists public.series_cast cascade;
drop table if exists public.movie_genres cascade;
drop table if exists public.series_genres cascade;
drop table if exists public.movies cascade;
drop table if exists public.series cascade;
drop table if exists public.people cascade;
drop table if exists public.genres cascade;

do $$
begin
  if to_regclass('public.watchlist') is not null then
    alter table public.watchlist alter column content_id type text using content_id::text;
  end if;
  if to_regclass('public.watch_history') is not null then
    alter table public.watch_history alter column content_id type text using content_id::text;
  end if;
  if to_regclass('public.reports') is not null then
    alter table public.reports alter column content_id type text using content_id::text;
    alter table public.reports drop column if exists source_id;
  end if;
end $$;

drop type if exists public.source_type;
drop type if exists public.content_status;

notify pgrst, 'reload schema';
commit;