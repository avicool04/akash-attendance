-- Attendance ERP implementation: HR-owned locations, attendance, transfers,
-- multi-day leave corrections, and daily-worker NMR records.
-- Additive migration; it preserves the existing attendance and approval tables.

begin;

create table if not exists public.work_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  address text,
  latitude numeric(9,6) not null check (latitude between -90 and 90),
  longitude numeric(9,6) not null check (longitude between -180 and 180),
  site_manager_id uuid references public.profiles(id) on delete set null,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists designation text,
  add column if not exists base_location_id uuid references public.work_locations(id) on delete set null,
  add column if not exists reporting_manager_id uuid references public.profiles(id) on delete set null;

update public.profiles
set first_name = coalesce(first_name, split_part(full_name, ' ', 1)),
    last_name = coalesce(last_name, nullif(btrim(substr(full_name, length(split_part(full_name, ' ', 1)) + 1)), ''))
where first_name is null;

alter table public.attendance
  alter column project_id drop not null,
  add column if not exists base_location_id uuid references public.work_locations(id) on delete set null,
  add column if not exists check_in_distance_m numeric,
  add column if not exists check_out_distance_m numeric,
  add column if not exists check_in_location_name text,
  add column if not exists check_out_location_name text;

drop policy if exists attendance_insert_self_assigned on public.attendance;
create policy attendance_insert_self_unrestricted
on public.attendance for insert to authenticated
with check (
  employee_id = (select auth.uid())
  and check_out_at is null
  and check_out_selfie_path is null
);

-- Attendance punches are immutable after creation except for the employee's
-- single check-out. Corrections are processed through reviewed requests.
revoke update on public.attendance from authenticated;
grant update (check_out_at, check_out_latitude, check_out_longitude,
              check_out_accuracy_m, check_out_selfie_path,
              check_out_distance_m, check_out_location_name)
on public.attendance to authenticated;
grant select, insert on public.attendance to authenticated;

-- Prevent a user from editing role, status, or base location through the broad
-- earlier self-update policy. Employee changes go through an approval request.
drop policy if exists profiles_update_self on public.profiles;
revoke update on public.profiles from authenticated;

alter table public.work_locations enable row level security;
create policy work_locations_read_active
on public.work_locations for select to authenticated
using (is_active or private.has_any_role(array['hr_manager'::public.app_role, 'technical_super_admin'::public.app_role]));
create policy work_locations_insert_hr
on public.work_locations for insert to authenticated
with check (private.has_any_role(array['hr_manager'::public.app_role, 'technical_super_admin'::public.app_role]));
create policy work_locations_update_hr
on public.work_locations for update to authenticated
using (private.has_any_role(array['hr_manager'::public.app_role, 'technical_super_admin'::public.app_role]))
with check (private.has_any_role(array['hr_manager'::public.app_role, 'technical_super_admin'::public.app_role]));
grant select, insert, update on public.work_locations to authenticated;

create table if not exists public.employee_transfer_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  from_location_id uuid references public.work_locations(id) on delete set null,
  to_location_id uuid not null references public.work_locations(id),
  from_manager_id uuid references public.profiles(id) on delete set null,
  to_manager_id uuid references public.profiles(id) on delete set null,
  reason text not null check (length(btrim(reason)) between 3 and 1000),
  status text not null default 'submitted' check (status in ('submitted','approved','rejected')),
  decided_by uuid references public.profiles(id) on delete set null,
  decision_comment text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check (to_location_id is distinct from from_location_id)
);
create index if not exists employee_transfer_requests_employee_created_idx
  on public.employee_transfer_requests(employee_id, created_at desc);
create index if not exists employee_transfer_requests_pending_idx
  on public.employee_transfer_requests(status, created_at) where status = 'submitted';
alter table public.employee_transfer_requests enable row level security;
create policy employee_transfer_requests_read_authorized
on public.employee_transfer_requests for select to authenticated
using (
  employee_id = (select auth.uid())
  or private.has_any_role(array['hr_manager'::public.app_role, 'technical_super_admin'::public.app_role])
  or exists (select 1 from public.profiles p where p.id = employee_id and p.reporting_manager_id = (select auth.uid()))
);
create policy employee_transfer_requests_insert_self
on public.employee_transfer_requests for insert to authenticated
with check (employee_id = (select auth.uid()) and status = 'submitted' and decided_by is null and decided_at is null);
grant select, insert on public.employee_transfer_requests to authenticated;

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
  if auth.uid() is null or p_decision not in ('approve','reject') then
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
revoke all on function private.review_employee_transfer_request(uuid,text,text) from public, anon;
grant execute on function private.review_employee_transfer_request(uuid,text,text) to authenticated;
create or replace function public.review_employee_transfer_request(p_request_id uuid, p_decision text, p_comment text default null)
returns text language sql set search_path = ''
as $function$ select private.review_employee_transfer_request(p_request_id,p_decision,p_comment); $function$;
revoke all on function public.review_employee_transfer_request(uuid,text,text) from public, anon;
grant execute on function public.review_employee_transfer_request(uuid,text,text) to authenticated;

create table if not exists public.employee_leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text not null check (length(btrim(reason)) between 3 and 1000),
  status text not null default 'submitted' check (status in ('submitted','approved','rejected')),
  decided_by uuid references public.profiles(id) on delete set null,
  decision_comment text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check (end_date >= start_date),
  check (end_date - start_date <= 30)
);
create index if not exists employee_leave_requests_employee_idx on public.employee_leave_requests(employee_id, start_date desc);
create index if not exists employee_leave_requests_pending_idx on public.employee_leave_requests(status, created_at) where status = 'submitted';
alter table public.employee_leave_requests enable row level security;
create policy employee_leave_requests_read_authorized
on public.employee_leave_requests for select to authenticated
using (
  employee_id = (select auth.uid())
  or private.has_any_role(array['hr_manager'::public.app_role, 'technical_super_admin'::public.app_role])
  or exists (select 1 from public.profiles p where p.id = employee_id and p.reporting_manager_id = (select auth.uid()))
);
create policy employee_leave_requests_insert_self
on public.employee_leave_requests for insert to authenticated
with check (employee_id = (select auth.uid()) and status = 'submitted' and decided_by is null and decided_at is null);
grant select, insert on public.employee_leave_requests to authenticated;

create or replace function private.review_employee_leave_request(
  p_request_id uuid,
  p_decision text,
  p_comment text default null
) returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_request public.employee_leave_requests%rowtype;
  v_actor_role public.app_role;
  v_manager_id uuid;
begin
  if auth.uid() is null or p_decision not in ('approve','reject') then raise exception 'Invalid leave decision'; end if;
  select role into v_actor_role from public.profiles where id = auth.uid() and status = 'active';
  select * into v_request from public.employee_leave_requests where id = p_request_id for update;
  if not found or v_request.status <> 'submitted' then raise exception 'Leave request is no longer pending'; end if;
  select reporting_manager_id into v_manager_id from public.profiles where id = v_request.employee_id;
  if v_actor_role not in ('hr_manager','technical_super_admin') and auth.uid() is distinct from v_manager_id then
    raise exception 'Only HR or the employee current reporting manager may decide this leave request';
  end if;
  update public.employee_leave_requests
    set status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
        decided_by = auth.uid(), decided_at = now(), decision_comment = p_comment
    where id = p_request_id;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
    values (auth.uid(), 'employee_leave_' || p_decision, 'employee_leave_request', p_request_id,
            jsonb_build_object('employee_id',v_request.employee_id,'start_date',v_request.start_date,'end_date',v_request.end_date,'comment',p_comment));
  return case when p_decision = 'approve' then 'approved' else 'rejected' end;
end;
$function$;
revoke all on function private.review_employee_leave_request(uuid,text,text) from public, anon;
grant execute on function private.review_employee_leave_request(uuid,text,text) to authenticated;
create or replace function public.review_employee_leave_request(p_request_id uuid, p_decision text, p_comment text default null)
returns text language sql set search_path = ''
as $function$ select private.review_employee_leave_request(p_request_id,p_decision,p_comment); $function$;
revoke all on function public.review_employee_leave_request(uuid,text,text) from public, anon;
grant execute on function public.review_employee_leave_request(uuid,text,text) to authenticated;

create table if not exists public.company_holidays (
  holiday_date date primary key,
  name text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.company_holidays enable row level security;
create policy company_holidays_read on public.company_holidays for select to authenticated using (true);
create policy company_holidays_manage on public.company_holidays for all to authenticated
using (private.has_any_role(array['hr_manager'::public.app_role, 'technical_super_admin'::public.app_role]))
with check (private.has_any_role(array['hr_manager'::public.app_role, 'technical_super_admin'::public.app_role]));
grant select, insert, update, delete on public.company_holidays to authenticated;

create or replace view public.attendance_daily_register
with (security_invoker = true)
as
with dates as (
  select generate_series(current_date - 365, current_date - 1, interval '1 day')::date as work_date
), employee_days as (
  select p.id as employee_id, p.employee_code, p.first_name, p.last_name, p.designation,
         p.reporting_manager_id, m.full_name as reporting_manager_name,
         l.id as base_location_id, l.name as base_location_name,
         d.work_date
  from public.profiles p
  cross join dates d
  left join public.profiles m on m.id = p.reporting_manager_id
  left join public.work_locations l on l.id = p.base_location_id
  where p.status = 'active'
    and d.work_date >= (p.created_at at time zone 'Asia/Kolkata')::date
    and extract(isodow from d.work_date) between 1 and 6
    and not exists (select 1 from public.company_holidays h where h.holiday_date = d.work_date)
)
select ed.employee_id, ed.employee_code, ed.first_name, ed.last_name,
       coalesce(nullif(btrim(concat_ws(' ', ed.first_name, ed.last_name)),''), p.full_name) as employee_name,
       ed.designation, ed.reporting_manager_id, ed.reporting_manager_name,
       ed.base_location_id, ed.base_location_name, ed.work_date as attendance_date,
       a.id as attendance_id, a.check_in_at, a.check_out_at,
       case when a.id is not null then 'present'
            when exists (select 1 from public.employee_leave_requests lr where lr.employee_id=ed.employee_id and lr.status='approved' and ed.work_date between lr.start_date and lr.end_date) then 'leave'
            when exists (select 1 from public.employee_leave_requests lr where lr.employee_id=ed.employee_id and lr.status='submitted' and ed.work_date between lr.start_date and lr.end_date) then 'leave_pending'
            else 'absent' end as day_status,
       case when a.check_in_at is not null and a.check_out_at is not null
            then greatest(0, extract(epoch from (a.check_out_at-a.check_in_at))/3600.0) else null end as working_hours,
       a.check_in_latitude, a.check_in_longitude, a.check_in_accuracy_m, a.check_in_selfie_path,
       a.check_in_distance_m, a.check_in_location_name,
       a.check_out_latitude, a.check_out_longitude, a.check_out_accuracy_m, a.check_out_selfie_path,
       a.check_out_distance_m, a.check_out_location_name
from employee_days ed
join public.profiles p on p.id=ed.employee_id
left join public.attendance a on a.employee_id=ed.employee_id and a.attendance_date=ed.work_date;
grant select on public.attendance_daily_register to authenticated;

create table if not exists public.daily_workers (
  id uuid primary key default gen_random_uuid(),
  worker_code text,
  full_name text not null,
  designation text not null,
  daily_rate numeric(12,2) not null check (daily_rate >= 0),
  site_location_id uuid not null references public.work_locations(id),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists daily_workers_site_active_idx on public.daily_workers(site_location_id, is_active);
alter table public.daily_workers enable row level security;
create policy daily_workers_read_authorized on public.daily_workers for select to authenticated
using (
  private.has_any_role(array['hr_manager'::public.app_role,'technical_super_admin'::public.app_role])
  or exists (select 1 from public.work_locations l where l.id=site_location_id and l.site_manager_id=(select auth.uid()))
);
create policy daily_workers_insert_managers on public.daily_workers for insert to authenticated
with check (
  private.has_any_role(array['hr_manager'::public.app_role,'technical_super_admin'::public.app_role])
  or exists (select 1 from public.work_locations l where l.id=site_location_id and l.site_manager_id=(select auth.uid()))
);
create policy daily_workers_update_managers on public.daily_workers for update to authenticated
using (
  private.has_any_role(array['hr_manager'::public.app_role,'technical_super_admin'::public.app_role])
  or exists (select 1 from public.work_locations l where l.id=site_location_id and l.site_manager_id=(select auth.uid()))
)
with check (
  private.has_any_role(array['hr_manager'::public.app_role,'technical_super_admin'::public.app_role])
  or exists (select 1 from public.work_locations l where l.id=site_location_id and l.site_manager_id=(select auth.uid()))
);
grant select, insert, update on public.daily_workers to authenticated;

create table if not exists public.daily_worker_attendance (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.daily_workers(id),
  site_location_id uuid not null references public.work_locations(id),
  attendance_date date not null,
  in_at timestamptz not null,
  out_at timestamptz not null,
  break_minutes integer not null default 60 check (break_minutes between 0 and 180),
  daily_rate_snapshot numeric(12,2) not null check (daily_rate_snapshot >= 0),
  notes text,
  entered_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(worker_id, attendance_date),
  check (out_at > in_at)
);
create index if not exists daily_worker_attendance_date_site_idx on public.daily_worker_attendance(attendance_date desc, site_location_id);
alter table public.daily_worker_attendance enable row level security;
create policy daily_worker_attendance_read_authorized on public.daily_worker_attendance for select to authenticated
using (
  private.has_any_role(array['hr_manager'::public.app_role,'technical_super_admin'::public.app_role])
  or exists (select 1 from public.work_locations l where l.id=site_location_id and l.site_manager_id=(select auth.uid()))
);
create policy daily_worker_attendance_manage_site on public.daily_worker_attendance for all to authenticated
using (
  private.has_any_role(array['hr_manager'::public.app_role,'technical_super_admin'::public.app_role])
  or exists (select 1 from public.work_locations l where l.id=site_location_id and l.site_manager_id=(select auth.uid()))
)
with check (
  entered_by=(select auth.uid())
  and (private.has_any_role(array['hr_manager'::public.app_role,'technical_super_admin'::public.app_role])
       or exists (select 1 from public.work_locations l where l.id=site_location_id and l.site_manager_id=(select auth.uid())))
);
grant select, insert, update, delete on public.daily_worker_attendance to authenticated;

create or replace view public.daily_worker_nmr
with (security_invoker = true)
as
select a.id, a.attendance_date, a.site_location_id, l.name as site_name,
       w.id as worker_id, w.worker_code, w.full_name, w.designation,
       a.in_at, a.out_at, a.break_minutes, a.daily_rate_snapshot as daily_rate,
       greatest(0, extract(epoch from (a.out_at-a.in_at))/3600.0 - a.break_minutes/60.0) as net_working_hours,
       least(8.0, greatest(0, extract(epoch from (a.out_at-a.in_at))/3600.0 - a.break_minutes/60.0)) as regular_hours,
       greatest(0, extract(epoch from (a.out_at-a.in_at))/3600.0 - a.break_minutes/60.0 - 8.0) as overtime_hours,
       a.daily_rate_snapshot as day_charge,
       a.daily_rate_snapshot / 8.0 * greatest(0, extract(epoch from (a.out_at-a.in_at))/3600.0 - a.break_minutes/60.0 - 8.0) as overtime_charge,
       a.daily_rate_snapshot + a.daily_rate_snapshot / 8.0 * greatest(0, extract(epoch from (a.out_at-a.in_at))/3600.0 - a.break_minutes/60.0 - 8.0) as total_charge,
       a.notes, a.entered_by, a.created_at
from public.daily_worker_attendance a
join public.daily_workers w on w.id=a.worker_id
join public.work_locations l on l.id=a.site_location_id;
grant select on public.daily_worker_nmr to authenticated;

commit;
