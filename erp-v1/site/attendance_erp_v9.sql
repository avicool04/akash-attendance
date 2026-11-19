alter table public.profiles
  add column if not exists must_change_password boolean not null default false;

create or replace function private.must_change_password()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce((select p.must_change_password from public.profiles p where p.id = (select auth.uid())), false);
$function$;

revoke all on function private.must_change_password() from public, anon;
grant execute on function private.must_change_password() to authenticated;

do $policies$
declare
  t text;
  tables text[] := array['profiles','attendance','approval_history','audit_logs','company_holidays','correction_requests','daily_worker_attendance','daily_workers','employee_assignments','employee_leave_requests','employee_transfer_requests','projects','work_locations'];
begin
  foreach t in array tables loop
    execute format('drop policy if exists proprietor_read_all on public.%I', t);
    execute format('create policy proprietor_read_all on public.%I for select to authenticated using (private.has_any_role(array[''proprietor''::public.app_role]))',t);
    if t='profiles' then
      execute 'drop policy if exists must_change_password_profile_scope on public.profiles';
      execute 'create policy must_change_password_profile_scope on public.profiles as restrictive for select to authenticated using (not private.must_change_password() or id=(select auth.uid()))';
    else
      execute format('drop policy if exists must_change_password_lock on public.%I',t);
      execute format('create policy must_change_password_lock on public.%I as restrictive for all to authenticated using (not private.must_change_password()) with check (not private.must_change_password())',t);
    end if;
    execute format('drop policy if exists proprietor_no_insert on public.%I',t);
    execute format('create policy proprietor_no_insert on public.%I as restrictive for insert to authenticated with check (not private.has_any_role(array[''proprietor''::public.app_role]))',t);
    execute format('drop policy if exists proprietor_no_update on public.%I',t);
    execute format('create policy proprietor_no_update on public.%I as restrictive for update to authenticated using (not private.has_any_role(array[''proprietor''::public.app_role])) with check (not private.has_any_role(array[''proprietor''::public.app_role]))',t);
    execute format('drop policy if exists proprietor_no_delete on public.%I',t);
    execute format('create policy proprietor_no_delete on public.%I as restrictive for delete to authenticated using (not private.has_any_role(array[''proprietor''::public.app_role]))',t);
  end loop;
end;
$policies$;

drop policy if exists proprietor_read_attendance_selfies on storage.objects;
create policy proprietor_read_attendance_selfies on storage.objects for select to authenticated using (bucket_id='attendance-selfies' and private.has_any_role(array['proprietor'::public.app_role]));
drop policy if exists must_change_password_storage_lock on storage.objects;
create policy must_change_password_storage_lock on storage.objects as restrictive for select to authenticated using (not private.must_change_password());

drop policy if exists must_change_password_storage_insert on storage.objects;
create policy must_change_password_storage_insert on storage.objects as restrictive for insert to authenticated with check (not private.must_change_password());
drop policy if exists must_change_password_storage_update on storage.objects;
create policy must_change_password_storage_update on storage.objects as restrictive for update to authenticated using (not private.must_change_password()) with check (not private.must_change_password());
drop policy if exists must_change_password_storage_delete on storage.objects;
create policy must_change_password_storage_delete on storage.objects as restrictive for delete to authenticated using (not private.must_change_password());

drop policy if exists proprietor_no_storage_insert on storage.objects;
create policy proprietor_no_storage_insert on storage.objects as restrictive for insert to authenticated with check (not private.has_any_role(array['proprietor'::public.app_role]));
drop policy if exists proprietor_no_storage_update on storage.objects;
create policy proprietor_no_storage_update on storage.objects as restrictive for update to authenticated using (not private.has_any_role(array['proprietor'::public.app_role])) with check (not private.has_any_role(array['proprietor'::public.app_role]));
drop policy if exists proprietor_no_storage_delete on storage.objects;
create policy proprietor_no_storage_delete on storage.objects as restrictive for delete to authenticated using (not private.has_any_role(array['proprietor'::public.app_role]));

alter view public.daily_worker_nmr set (security_invoker=true);
