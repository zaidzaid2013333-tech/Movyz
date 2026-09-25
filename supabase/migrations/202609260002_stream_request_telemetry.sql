create table if not exists public.stream_request_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  content_type text not null check(content_type in ('movie','episode')),
  content_id uuid not null,
  source_id uuid references public.playback_sources(id) on delete set null,
  provider_id uuid references public.providers(id) on delete set null,
  success boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists stream_request_logs_created_idx
  on public.stream_request_logs(created_at desc);

create index if not exists stream_request_logs_provider_idx
  on public.stream_request_logs(provider_id, created_at desc);

alter table public.stream_request_logs enable row level security;

drop policy if exists stream_logs_admin on public.stream_request_logs;
create policy stream_logs_admin on public.stream_request_logs
  for select using (public.is_admin_or_owner());
