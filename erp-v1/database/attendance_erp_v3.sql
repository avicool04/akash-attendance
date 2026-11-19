-- HR-assisted setup of the minimal employee profile used by attendance.
begin;

create or replace function private.save_attendance_employee_profile(
  p_user_id uuid,
  p_employee_code text,
  p_first_name text,
  p_last_name text,
  p_designation text,
  p_base_location_id uuid,
  p_reporting_manager_id uuid,
  p_role text default 'employee'
) returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_role public.app_role;
  v_target_role public.app_role;
  v_name text;
begin
  if auth.uid() is null then raise exception 'Sign in is required'; end if;
  select role into v_actor_role from public.profiles where id=auth.uid() and status='active';
  if v_actor_role is null or v_actor_role not in ('hr_manager','technical_super_admin') then raise exception 'Only HR can manage employee attendance profiles'; end if;
  if p_user_id is null or nullif(btrim(p_employee_code),'') is null or nullif(btrim(p_first_name),'') is null or nullif(btrim(p_last_name),'') is null then
    raise exception 'User account, Employee ID, first name, and last name are required';
  end if;
  if p_role not in ('employee','site_manager','hr_manager') then raise exception 'Unsupported attendance role'; end if;
  if v_actor_role <> 'technical_super_admin' and p_role='hr_manager' then raise exception 'Only an administrator can create an HR Manager profile'; end if;
  if p_reporting_manager_id is not null then
    select role into v_target_role from public.profiles where id=p_reporting_manager_id and status='active';
    if v_target_role is null or v_target_role not in ('site_manager','hr_manager','technical_super_admin') then raise exception 'Reporting Manager must be an active manager'; end if;
  end if;
  if p_base_location_id is not null and not exists (select 1 from public.work_locations where id=p_base_location_id and is_active) then
    raise exception 'Base location must be active';
  end if;
  v_name := concat_ws(' ', btrim(p_first_name), btrim(p_last_name));
  insert into public.profiles(id,employee_code,full_name,first_name,last_name,designation,base_location_id,reporting_manager_id,role,status,updated_at)
  values (p_user_id,btrim(p_employee_code),v_name,btrim(p_first_name),btrim(p_last_name),nullif(btrim(p_designation),''),p_base_location_id,p_reporting_manager_id,p_role::public.app_role,'active',now())
  on conflict (id) do update set employee_code=excluded.employee_code,full_name=excluded.full_name,
    first_name=excluded.first_name,last_name=excluded.last_name,designation=excluded.designation,
    base_location_id=excluded.base_location_id,reporting_manager_id=excluded.reporting_manager_id,
    role=excluded.role,status='active',updated_at=now();
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details)
    values(auth.uid(),'attendance_profile_saved','employee_profile',p_user_id,
           jsonb_build_object('employee_code',btrim(p_employee_code),'base_location_id',p_base_location_id,'reporting_manager_id',p_reporting_manager_id,'role',p_role));
  return p_user_id;
end;
$function$;
revoke all on function private.save_attendance_employee_profile(uuid,text,text,text,text,uuid,uuid,text) from public,anon;
grant execute on function private.save_attendance_employee_profile(uuid,text,text,text,text,uuid,uuid,text) to authenticated;
create or replace function public.save_attendance_employee_profile(
  p_user_id uuid,p_employee_code text,p_first_name text,p_last_name text,p_designation text,
  p_base_location_id uuid,p_reporting_manager_id uuid,p_role text default 'employee'
) returns uuid language sql set search_path = ''
as $function$ select private.save_attendance_employee_profile(p_user_id,p_employee_code,p_first_name,p_last_name,p_designation,p_base_location_id,p_reporting_manager_id,p_role); $function$;
revoke all on function public.save_attendance_employee_profile(uuid,text,text,text,text,uuid,uuid,text) from public,anon;
grant execute on function public.save_attendance_employee_profile(uuid,text,text,text,text,uuid,uuid,text) to authenticated;

commit;
