-- Enforce case-insensitive uniqueness for HR-managed User IDs.
-- Existing values were checked before applying this index.
create unique index if not exists profiles_employee_code_ci_unique
  on public.profiles (lower(employee_code))
  where employee_code is not null;

-- Make the active profile status authoritative for any still-valid signed-in token.
create or replace function private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active'
  );
$$;
revoke all on function private.is_active_user() from public, anon;
grant execute on function private.is_active_user() to authenticated;

-- Force every authenticated Data API request to come from an active profile.
do $$
declare
  target record;
begin
  for target in
    select c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
  loop
    execute format('drop policy if exists active_profile_session_guard on public.%I', target.table_name);
    execute format(
      'create policy active_profile_session_guard on public.%I as restrictive for all to authenticated using (private.is_active_user()) with check (private.is_active_user())',
      target.table_name
    );
  end loop;
end;
$$;

-- Revoke refresh sessions when HR disables a login; execution is limited to the backend key.
create or replace function public.revoke_account_sessions(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from auth.sessions where user_id = p_user_id;
end;
$$;
revoke all on function public.revoke_account_sessions(uuid) from public, anon, authenticated;
grant execute on function public.revoke_account_sessions(uuid) to service_role;

