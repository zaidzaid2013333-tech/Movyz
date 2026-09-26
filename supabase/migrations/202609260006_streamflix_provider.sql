-- Add credential-free StreamFlix playback provider and keep credential-dependent providers disabled.
insert into public.providers (key,name,adapter_name,enabled,status)
values ('streamflix','StreamFlix','streamflix',true,'unknown')
on conflict (key) do update set
  name = excluded.name,
  adapter_name = excluded.adapter_name,
  enabled = true,
  updated_at = now();

update public.providers
set enabled = false,
    status = 'offline',
    updated_at = now()
where key in ('nhdapi','egybest');

notify pgrst, 'reload schema';
