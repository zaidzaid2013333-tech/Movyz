-- Harden SECURITY DEFINER-capable playback queue functions against mutable search_path resolution.
-- The database migration is applied through Supabase; keep this file in repo for schema parity.

alter function public.claim_playback_source_job(text, integer, text) set search_path = public, pg_catalog;
alter function public.claim_playback_source_jobs(text, integer) set search_path = public, pg_catalog;
alter function public.enqueue_playback_source_job(text, uuid, text, integer, text) set search_path = public, pg_catalog;
alter function public.enqueue_playback_source_jobs_for_content(text, uuid, text) set search_path = public, pg_catalog;
alter function public.mark_playback_source_job_retry(uuid, text, integer, integer) set search_path = public, pg_catalog;
alter function public.mark_playback_source_job_success(uuid, integer, timestamptz, jsonb) set search_path = public, pg_catalog;
alter function public.reject_persistent_akwam_source() set search_path = public, pg_catalog;
alter function public.requeue_stale_playback_sources(integer) set search_path = public, pg_catalog;
alter function public.touch_playback_source_jobs_updated_at() set search_path = public, pg_catalog;
alter function public.trg_enqueue_new_episode_sources() set search_path = public, pg_catalog;
alter function public.trg_enqueue_new_movie_sources() set search_path = public, pg_catalog;
