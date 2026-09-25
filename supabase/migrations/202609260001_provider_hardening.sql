create unique index if not exists playback_sources_dedupe_idx
  on public.playback_sources(provider_id, content_type, content_id, url)
  where url is not null;

insert into public.providers(key,name,adapter_name,enabled,status)
values ('external-api','External Playback API','external-api',false,'unknown')
on conflict (key) do update set adapter_name=excluded.adapter_name;

drop trigger if exists seasons_updated_at on public.seasons;
create trigger seasons_updated_at before update on public.seasons
for each row execute procedure public.set_updated_at();

drop trigger if exists episodes_updated_at on public.episodes;
create trigger episodes_updated_at before update on public.episodes
for each row execute procedure public.set_updated_at();

drop trigger if exists watch_history_updated_at on public.watch_history;
create trigger watch_history_updated_at before update on public.watch_history
for each row execute procedure public.set_updated_at();
