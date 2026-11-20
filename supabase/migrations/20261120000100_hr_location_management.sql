-- HR location management additions for the existing Attendance ERP schema.
-- Safe to re-run: policies/functions/column are replaced idempotently.

alter table public.work_locations
  add column if not exists location_type text not null default 'site'
  check (location_type in ('office','site'));

-- Remove broad legacy catch-all profile/location policies.
drop policy if exists active_profile_session_guard on public.profiles;
drop policy if exists active_profile_session_guard on public.work_locations;
drop policy if exists work_locations_read_authenticated on public.work_locations;

-- Location reads are available to active signed-in users.
drop policy if exists work_locations_read_active on public.work_locations;
create policy work_locations_read_active
  on public.work_locations for select to authenticated
  using (private.is_active_user());

-- HR and technical super admins manage location records.
drop policy if exists work_locations_insert_hr on public.work_locations;
create policy work_locations_insert_hr
  on public.work_locations for insert to authenticated
  with check (
    private.has_any_role(array['hr_manager'::public.app_role, 'technical_super_admin'::public.app_role])
    and not private.must_change_password()
  );

drop policy if exists work_locations_update_hr on public.work_locations;
create policy work_locations_update_hr
  on public.work_locations for update to authenticated
  using (
    private.has_any_role(array['hr_manager'::public.app_role, 'technical_super_admin'::public.app_role])
    and not private.must_change_password()
  )
  with check (
    private.has_any_role(array['hr_manager'::public.app_role, 'technical_super_admin'::public.app_role])
    and not private.must_change_password()
  );

-- Preserve restrictive account/password guardrails.
do $$
declare t text;
begin
  foreach t in array array['profiles','work_locations'] loop
    execute format('drop policy if exists proprietor_no_insert on public.%I', t);
    execute format('create policy proprietor_no_insert on public.%I as restrictive for insert to authenticated with check (not private.has_any_role(array[''proprietor''::public.app_role]))', t);
    execute format('drop policy if exists proprietor_no_update on public.%I', t);
    execute format('create policy proprietor_no_update on public.%I as restrictive for update to authenticated using (not private.has_any_role(array[''proprietor''::public.app_role])) with check (not private.has_any_role(array[''proprietor''::public.app_role]))', t);
    execute format('drop policy if exists proprietor_no_delete on public.%I', t);
    execute format('create policy proprietor_no_delete on public.%I as restrictive for delete to authenticated using (not private.has_any_role(array[''proprietor''::public.app_role]))', t);
  end loop;
end $$;

drop policy if exists must_change_password_lock on public.work_locations;
create policy must_change_password_lock
  on public.work_locations as restrictive for all to authenticated
  using (not private.must_change_password())
  with check (not private.must_change_password());

-- Profile updates through the Data API are restricted to the HR-managed
-- base-location columns and the user's own first-login password flag.
drop policy if exists profiles_update_location_hr on public.profiles;
create policy profiles_update_location_hr
  on public.profiles for update to authenticated
  using (
    private.has_any_role(array['hr_manager'::public.app_role, 'technical_super_admin'::public.app_role])
    and not private.must_change_password()
  )
  with check (
    private.has_any_role(array['hr_manager'::public.app_role, 'technical_super_admin'::public.app_role])
    and not private.must_change_password()
  );

drop policy if exists profiles_update_own_password_flag on public.profiles;
create policy profiles_update_own_password_flag
  on public.profiles for update to authenticated
  using (id = (select auth.uid()) and status = 'active')
  with check (id = (select auth.uid()) and status = 'active');

revoke update on public.profiles from authenticated;
grant update (base_location_id, updated_at, must_change_password) on public.profiles to authenticated;

-- Safe RPC for HR to assign or clear an employee's base work location.
create or replace function public.assign_employee_location(
  p_employee_id uuid,
  p_location_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is null
     or not private.has_any_role(array['hr_manager'::public.app_role, 'technical_super_admin'::public.app_role])
     or private.must_change_password() then
    raise exception 'Not authorized to assign employee locations'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = p_employee_id
      and p.status = 'active'
      and p.role in ('employee'::public.app_role, 'site_manager'::public.app_role)
  ) then
    raise exception 'Active employee or site manager not found'
      using errcode = '22023';
  end if;

  if p_location_id is not null and not exists (
    select 1 from public.work_locations wl
    where wl.id = p_location_id and wl.is_active = true
  ) then
    raise exception 'Selected location is not active'
      using errcode = '22023';
  end if;

  update public.profiles
  set base_location_id = p_location_id, updated_at = now()
  where id = p_employee_id;
end;
$$;

revoke all on function public.assign_employee_location(uuid, uuid) from public, anon;
grant execute on function public.assign_employee_location(uuid, uuid) to authenticated;
