-- Credential-free VidZee direct playback provider.
insert into public.providers (key,name,adapter_name,enabled,status)
values ('vidzee','VidZee','vidzee',true,'unknown')
on conflict (key) do update set
  name = excluded.name,
  adapter_name = excluded.adapter_name,
  enabled = true,
  updated_at = now();

notify pgrst, 'reload schema';
