-- Retired VidZee provider kept disabled for schema compatibility.
-- Movyz uses ezvidapi for direct HLS playback.

insert into public.providers (key,name,adapter_name,enabled,status)
values ('vidzee','VidZee','vidzee',false,'offline')
on conflict (key) do update set
  name = excluded.name,
  adapter_name = excluded.adapter_name,
  enabled = false,
  status = 'offline',
  updated_at = now();

notify pgrst, 'reload schema';
