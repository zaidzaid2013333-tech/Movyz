begin;

drop function if exists public.acquire_akwam_cron_lease(integer);
drop function if exists public.release_akwam_cron_lease();
drop function if exists public.claim_playback_source_job(text, integer, text);
drop function if exists public.enqueue_playback_source_job(text, uuid, text, integer, text);
drop function if exists public.enqueue_playback_source_jobs_for_content(text, uuid, text);
drop function if exists public.get_akwam_prefill_context(uuid);
drop function if exists public.mark_playback_source_job_retry(uuid, text, integer, integer);
drop function if exists public.mark_playback_source_job_success(uuid, integer, timestamptz, jsonb);
drop function if exists public.touch_playback_source_jobs_updated_at();

notify pgrst, 'reload schema';
commit;