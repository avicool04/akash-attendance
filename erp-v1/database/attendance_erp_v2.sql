-- Read access for direct-report managers and historical base locations.
begin;

drop policy if exists work_locations_read_active on public.work_locations;
create policy work_locations_read_authenticated
on public.work_locations for select to authenticated using (true);

create policy profiles_read_reporting_manager
on public.profiles for select to authenticated
using (reporting_manager_id = (select auth.uid()));

create policy attendance_read_reporting_manager
on public.attendance for select to authenticated
using (exists (select 1 from public.profiles p where p.id=employee_id and p.reporting_manager_id=(select auth.uid())));

create or replace function private.review_employee_transfer_request(
  p_request_id uuid,
  p_decision text,
  p_comment text default null
) returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_request public.employee_transfer_requests%rowtype;
  v_actor_role public.app_role;
  v_manager_id uuid;
begin
  if auth.uid() is null or p_decision is null or p_decision not in ('approve','reject') then
    raise exception 'Invalid transfer decision';
  end if;
  select role into v_actor_role from public.profiles where id = auth.uid() and status = 'active';
  select * into v_request from public.employee_transfer_requests where id = p_request_id for update;
  if not found or v_request.status <> 'submitted' then raise exception 'Transfer request is no longer pending'; end if;
  select reporting_manager_id into v_manager_id from public.profiles where id = v_request.employee_id;
  if v_actor_role not in ('hr_manager','technical_super_admin') and auth.uid() is distinct from v_manager_id then
    raise exception 'Only HR or the employee current reporting manager may decide this transfer';
  end if;
  if p_decision = 'approve' then
    if not exists (select 1 from public.work_locations where id=v_request.to_location_id and is_active) then
      raise exception 'The destination location is no longer active';
    end if;
    if v_request.to_manager_id is not null and not exists (
      select 1 from public.profiles where id=v_request.to_manager_id and status='active'
        and role in ('site_manager','hr_manager','technical_super_admin')
    ) then raise exception 'The destination manager is not an active manager'; end if;
    update public.profiles
      set base_location_id = v_request.to_location_id,
          reporting_manager_id = v_request.to_manager_id,
          updated_at = now()
      where id = v_request.employee_id;
    update public.employee_transfer_requests
      set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_comment = p_comment
      where id = p_request_id;
    insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
      values (auth.uid(), 'employee_transfer_approved', 'employee_transfer_request', p_request_id,
              jsonb_build_object('employee_id', v_request.employee_id, 'from_location_id', v_request.from_location_id,
                                 'to_location_id', v_request.to_location_id, 'to_manager_id', v_request.to_manager_id));
    return 'approved';
  else
    update public.employee_transfer_requests
      set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_comment = p_comment
      where id = p_request_id;
    insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
      values (auth.uid(), 'employee_transfer_rejected', 'employee_transfer_request', p_request_id,
              jsonb_build_object('employee_id', v_request.employee_id, 'comment', p_comment));
    return 'rejected';
  end if;
end;
$function$;

commit;
