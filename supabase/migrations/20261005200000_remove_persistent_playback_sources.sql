-- Movyz now resolves Akwam playback on demand and caches it only briefly at the edge.
-- Remove the legacy persistent source archive and the RPCs that depended on it.

drop function if exists public.claim_akwam_prefill_job(text, integer);
drop function if exists public.persist_akwam_prefill_job(uuid, uuid, jsonb, text);
drop function if exists public.requeue_stale_playback_sources(integer);

drop table if exists public.playback_sources cascade;
