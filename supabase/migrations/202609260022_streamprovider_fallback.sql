-- Enable StreamProvider as the immediate fallback playback API.
-- TMDB Embed API remains the preferred self-hosted provider once configured.

begin;

insert into public.providers (key, name, adapter_name, enabled, status)
values ('streamprovider', 'StreamProvider', 'streamprovider', true, 'unknown')
on conflict (key) do update
set name = excluded.name,
    adapter_name = excluded.adapter_name,
    enabled = true,
    status = 'unknown',
    updated_at = now();

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
