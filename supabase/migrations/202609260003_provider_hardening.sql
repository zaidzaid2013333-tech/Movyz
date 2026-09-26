-- Provider hardening and playback-source deduplication.
-- Safe to apply after the initial Movyz migrations.

create or replace function public.set_updated_at()
returns trigger language plpgsql as $
begin
  new.updated_at = now();
  return new;
end $;

alter table public.providers
  add column if not exists updated_at timestamptz not null default now();

-- Remove duplicate source rows before creating the unique index.
delete from public.playback_sources older
using public.playback_sources newer
where older.id < newer.id
  and older.provider_id = newer.provider_id
  and older.content_type = newer.content_type
  and older.content_id = newer.content_id
  and older.url is not null
  and older.url = newer.url;

create unique index if not exists playback_sources_provider_content_url_uidx
  on public.playback_sources(provider_id, content_type, content_id, url)
  where url is not null;

drop trigger if exists providers_updated_at on public.providers;
create trigger providers_updated_at
before update on public.providers
for each row execute procedure public.set_updated_at();

insert into public.providers(key,name,adapter_name,enabled,status)
values
  ('ezvidapi','ezvidAPI','ezvidapi',true,'unknown'),
  ('streamprovider','StreamProvider','streamprovider',true,'unknown'),
  ('nhdapi','NHD API','nhdapi',true,'unknown'),
  ('faselhd','FaselHD','faselhd',false,'unknown')
on conflict(key) do update
set name = excluded.name,
    adapter_name = excluded.adapter_name;
