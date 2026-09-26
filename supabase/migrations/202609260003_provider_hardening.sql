-- Provider hardening and playback-source deduplication.
-- Safe to apply after the initial Movyz migrations.

begin;

-- providers.updated_at is normally created by migration 002.
-- Keep this migration safe when run independently.
alter table if exists public.providers
  add column if not exists updated_at timestamptz not null default now();

-- Remove duplicate source rows before creating the unique index.
do $dedupe$
begin
  if to_regclass('public.playback_sources') is not null then
    execute $sql$
      delete from public.playback_sources older
      using public.playback_sources newer
      where older.id < newer.id
        and older.provider_id is not distinct from newer.provider_id
        and older.content_type = newer.content_type
        and older.content_id = newer.content_id
        and older.url is not null
        and older.url = newer.url
    $sql$;

    execute $sql$
      create unique index if not exists playback_sources_provider_content_url_uidx
        on public.playback_sources(provider_id, content_type, content_id, url)
        where url is not null
    $sql$;
  end if;
end
$dedupe$;

-- The trigger function is created by migration 002. Recreate it safely
-- so this migration also works after an older/incomplete 002.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

do $provider$
begin
  if to_regclass('public.providers') is not null then
    execute 'drop trigger if exists providers_updated_at on public.providers';
    execute 'create trigger providers_updated_at
      before update on public.providers
      for each row
      execute function public.set_updated_at()';

    execute $sql$
      insert into public.providers(key, name, adapter_name, enabled, status)
      values
        ('ezvidapi', 'ezvidAPI', 'ezvidapi', true, 'unknown'),
        ('egybest', 'EgyBest', 'egybest', true, 'unknown'),
        ('streamprovider', 'StreamProvider', 'streamprovider', true, 'unknown'),
        ('nhdapi', 'NHD API', 'nhdapi', true, 'unknown'),
        ('faselhd', 'FaselHD', 'faselhd', true, 'unknown')
      on conflict (key) do update
      set name = excluded.name,
          adapter_name = excluded.adapter_name
    $sql$;
  end if;
end
$provider$;

commit;
