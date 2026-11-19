-- Protect employee transfers and preserve the request-time reporting relationship.
begin;

create or replace function private.populate_employee_transfer_snapshot()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if auth.uid() is null or new.employee_id is distinct from auth.uid() then
    raise exception 'Employees may submit only their own transfer requests';
  end if;
  select p.base_location_id, p.reporting_manager_id
    into new.from_location_id, new.from_manager_id
    from public.profiles p where p.id=new.employee_id and p.status='active';
  if not found then raise exception 'Active employee profile not found'; end if;
  select l.site_manager_id into new.to_manager_id
    from public.work_locations l where l.id=new.to_location_id and l.is_active;
  if not found then raise exception 'Destination location is not active'; end if;
  return new;
end;
$function$;
drop trigger if exists employee_transfer_snapshot on public.employee_transfer_requests;
create trigger employee_transfer_snapshot
before insert on public.employee_transfer_requests
for each row execute function private.populate_employee_transfer_snapshot();
revoke all on function private.populate_employee_transfer_snapshot() from public,anon,authenticated;

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
  v_existing public.profiles%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in is required'; end if;
  select role into v_actor_role from public.profiles where id=auth.uid() and status='active';
  if v_actor_role is null or v_actor_role not in ('hr_manager','technical_super_admin') then raise exception 'Only HR can manage employee attendance profiles'; end if;
  if p_user_id is null or nullif(btrim(p_employee_code),'') is null or nullif(btrim(p_first_name),'') is null or nullif(btrim(p_last_name),'') is null then
    raise exception 'User account, Employee ID, first name, and last name are required';
  end if;
  if p_role is null or p_role not in ('employee','site_manager','hr_manager') then raise exception 'Unsupported attendance role'; end if;
  if v_actor_role <> 'technical_super_admin' and p_role='hr_manager' then raise exception 'Only an administrator can create an HR Manager profile'; end if;
  select * into v_existing from public.profiles where id=p_user_id;
  if found and v_existing.employee_code is not null and
     (v_existing.base_location_id is distinct from p_base_location_id
      or v_existing.reporting_manager_id is distinct from p_reporting_manager_id
      or v_existing.role::text is distinct from p_role) then
    raise exception 'Use an approved site transfer to change base location or reporting manager';
  end if;
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

create or replace function private.review_employee_transfer_request(p_request_id uuid,p_decision text,p_comment text default null)
returns text language plpgsql security definer set search_path = ''
as $function$
declare
  v_request public.employee_transfer_requests%rowtype;
  v_actor_role public.app_role;
  v_manager_id uuid;
begin
  if auth.uid() is null or p_decision is null or p_decision not in ('approve','reject') then raise exception 'Invalid transfer decision'; end if;
  select role into v_actor_role from public.profiles where id=auth.uid() and status='active';
  select * into v_request from public.employee_transfer_requests where id=p_request_id for update;
  if not found or v_request.status <> 'submitted' then raise exception 'Transfer request is no longer pending'; end if;
  select reporting_manager_id into v_manager_id from public.profiles where id=v_request.employee_id;
  if v_actor_role is null or (v_actor_role not in ('hr_manager','technical_super_admin') and auth.uid() is distinct from v_manager_id) then
    raise exception 'Only HR or the employee current reporting manager may decide this transfer';
  end if;
  if p_decision='approve' then
    if not exists (select 1 from public.work_locations where id=v_request.to_location_id and is_active and site_manager_id is not null) then
      raise exception 'Assign an active Site Manager to the destination before approving the transfer';
    end if;
    if v_request.to_manager_id is distinct from (select site_manager_id from public.work_locations where id=v_request.to_location_id) then
      raise exception 'Destination manager changed; submit a new transfer request';
    end if;
    update public.profiles set base_location_id=v_request.to_location_id, reporting_manager_id=v_request.to_manager_id, updated_at=now()
      where id=v_request.employee_id;
    update public.employee_transfer_requests set status='approved',decided_by=auth.uid(),decided_at=now(),decision_comment=p_comment where id=p_request_id;
  else
    update public.employee_transfer_requests set status='rejected',decided_by=auth.uid(),decided_at=now(),decision_comment=p_comment where id=p_request_id;
  end if;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details)
    values(auth.uid(),'employee_transfer_'||p_decision,'employee_transfer_request',p_request_id,
           jsonb_build_object('employee_id',v_request.employee_id,'from_location_id',v_request.from_location_id,'to_location_id',v_request.to_location_id,'to_manager_id',v_request.to_manager_id,'comment',p_comment));
  return case when p_decision='approve' then 'approved' else 'rejected' end;
end;
$function$;

create or replace function private.review_employee_leave_request(p_request_id uuid,p_decision text,p_comment text default null)
returns text language plpgsql security definer set search_path = ''
as $function$
declare
  v_request public.employee_leave_requests%rowtype;
  v_actor_role public.app_role;
  v_manager_id uuid;
begin
  if auth.uid() is null or p_decision is null or p_decision not in ('approve','reject') then raise exception 'Invalid leave decision'; end if;
  select role into v_actor_role from public.profiles where id=auth.uid() and status='active';
  select * into v_request from public.employee_leave_requests where id=p_request_id for update;
  if not found or v_request.status <> 'submitted' then raise exception 'Leave request is no longer pending'; end if;
  select reporting_manager_id into v_manager_id from public.profiles where id=v_request.employee_id;
  if v_actor_role is null or (v_actor_role not in ('hr_manager','technical_super_admin') and auth.uid() is distinct from v_manager_id) then
    raise exception 'Only HR or the employee current reporting manager may decide this leave request';
  end if;
  update public.employee_leave_requests
    set status=case when p_decision='approve' then 'approved' else 'rejected' end,
        decided_by=auth.uid(),decided_at=now(),decision_comment=p_comment
    where id=p_request_id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details)
    values(auth.uid(),'employee_leave_'||p_decision,'employee_leave_request',p_request_id,
           jsonb_build_object('employee_id',v_request.employee_id,'start_date',v_request.start_date,'end_date',v_request.end_date,'comment',p_comment));
  return case when p_decision='approve' then 'approved' else 'rejected' end;
end;
$function$;

commit;
