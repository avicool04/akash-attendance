-- Preserve the base location that was in effect at each punch in historical reports.
begin;
drop view if exists public.attendance_daily_register;
create view public.attendance_daily_register
with (security_invoker = true)
as
with bounds as (
  select (now() at time zone 'Asia/Kolkata')::date as india_today
), dates as (
  select generate_series(b.india_today - 365, b.india_today - 1, interval '1 day')::date as work_date
  from bounds b
), employee_days as (
  select p.id as employee_id, p.employee_code, p.first_name, p.last_name, p.designation,
         p.reporting_manager_id, m.full_name as reporting_manager_name,
         p.base_location_id as current_base_location_id,
         d.work_date
  from public.profiles p
  cross join dates d
  left join public.profiles m on m.id = p.reporting_manager_id
  where p.status = 'active'
    and d.work_date >= (p.created_at at time zone 'Asia/Kolkata')::date
    and extract(isodow from d.work_date) between 1 and 6
    and not exists (select 1 from public.company_holidays h where h.holiday_date = d.work_date)
)
select ed.employee_id, ed.employee_code, ed.first_name, ed.last_name,
       coalesce(nullif(btrim(concat_ws(' ', ed.first_name, ed.last_name)),''), p.full_name) as employee_name,
       ed.designation, ed.reporting_manager_id, ed.reporting_manager_name,
       coalesce(a.base_location_id, ed.current_base_location_id) as base_location_id,
       l.name as base_location_name, ed.work_date as attendance_date,
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
left join public.attendance a on a.employee_id=ed.employee_id and a.attendance_date=ed.work_date
left join public.work_locations l on l.id=coalesce(a.base_location_id, ed.current_base_location_id);
grant select on public.attendance_daily_register to authenticated;
commit;
