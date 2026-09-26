-- Primary playback provider: self-hosted TMDB Embed API.
-- The application resolves playback through this adapter using TMDB IDs.
-- Keep the old ezVid/VidZee adapters disabled so the deprecated playback path
-- cannot silently take over when the new API is unavailable.

begin;

insert into public.providers (key, name, adapter_name, enabled, status)
values ('tmdbembed', 'TMDB Embed API', 'tmdbembed', true, 'unknown')
on conflict (key) do update
set name = excluded.name,
    adapter_name = excluded.adapter_name,
    enabled = true,
    status = 'unknown',
    updated_at = now();

update public.providers
set enabled = false,
    status = 'offline',
    updated_at = now()
where key in ('ezvidapi', 'vidzee');

notify pgrst, 'reload schema';

commit;
