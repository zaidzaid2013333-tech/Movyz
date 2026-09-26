-- Runtime hardening for the live Movyz Supabase project.
-- Safe/idempotent: can be applied after the base schema and provider setup.

create schema if not exists extensions;
alter extension pg_trgm set schema extensions;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  insert into public.profiles(id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', nullif(split_part(coalesce(new.email, ''), '@', 1), ''), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles for select to authenticated using (
  (select auth.uid()) = id
  or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('ADMIN','OWNER'))
);

drop policy if exists watchlist_self on public.watchlist;
create policy watchlist_self on public.watchlist for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists history_self on public.watch_history;
create policy history_self on public.watch_history for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists reports_insert_self on public.reports;
create policy reports_insert_self on public.reports for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists reports_read_admin on public.reports;
create policy reports_read_admin on public.reports for select to authenticated using (
  (select auth.uid()) = user_id
  or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('ADMIN','OWNER'))
);

drop policy if exists providers_admin on public.providers;
create policy providers_admin on public.providers for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('ADMIN','OWNER'))
);

drop policy if exists mappings_admin on public.provider_mappings;
create policy mappings_admin on public.provider_mappings for all to authenticated
using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('ADMIN','OWNER')))
with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('ADMIN','OWNER')));

drop policy if exists sources_admin on public.playback_sources;
drop policy if exists sources_admin_insert on public.playback_sources;
drop policy if exists sources_admin_update on public.playback_sources;
drop policy if exists sources_admin_delete on public.playback_sources;

create policy sources_admin_insert on public.playback_sources for insert to authenticated
with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('ADMIN','OWNER')));

create policy sources_admin_update on public.playback_sources for update to authenticated
using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('ADMIN','OWNER')))
with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('ADMIN','OWNER')));

create policy sources_admin_delete on public.playback_sources for delete to authenticated
using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('ADMIN','OWNER')));

drop policy if exists sources_public on public.playback_sources;
create policy sources_public on public.playback_sources for select to anon, authenticated using (
  is_working = true and (expires_at is null or expires_at > now())
);

drop policy if exists audit_admin on public.audit_logs;
create policy audit_admin on public.audit_logs for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('ADMIN','OWNER'))
);

drop policy if exists sync_jobs_admin on public.sync_jobs;
create policy sync_jobs_admin on public.sync_jobs for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('ADMIN','OWNER'))
);

revoke execute on function public.is_admin_or_owner() from public, anon, authenticated, service_role;

update public.providers
set enabled = false, status = 'offline', updated_at = now()
where key in ('moviebox-api','streamprovider','streamflix','faselhd','vidzee');

update public.providers set enabled = true where key = 'ezvidapi';

create index if not exists audit_logs_actor_idx on public.audit_logs(actor_id);
create index if not exists movie_cast_person_idx on public.movie_cast(person_id);
create index if not exists movie_genres_genre_idx on public.movie_genres(genre_id);
create index if not exists reports_source_idx on public.reports(source_id);
create index if not exists reports_user_idx on public.reports(user_id);
create index if not exists series_cast_person_idx on public.series_cast(person_id);
create index if not exists series_genres_genre_idx on public.series_genres(genre_id);
