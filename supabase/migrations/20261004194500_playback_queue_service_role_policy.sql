begin;

drop policy if exists playback_source_jobs_service_role on public.playback_source_jobs;
create policy playback_source_jobs_service_role
  on public.playback_source_jobs
  for all
  to service_role
  using (true)
  with check (true);

commit;
