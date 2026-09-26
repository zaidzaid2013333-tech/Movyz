-- Stable identity for cached playback sources.
-- The resolver and coverage jobs upsert on this exact tuple.
create unique index if not exists playback_sources_provider_content_url_uq
  on public.playback_sources (provider_id, content_type, content_id, url);

-- Fast lookup for /watch and source coverage checks.
create index if not exists playback_sources_content_lookup_idx
  on public.playback_sources (content_type, content_id, is_working, last_checked_at desc);
