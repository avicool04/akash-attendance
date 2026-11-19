-- An already-issued JWT must not allow an inactive user to read or upload private photos.
drop policy if exists active_profile_session_guard on storage.objects;
create policy active_profile_session_guard
  on storage.objects as restrictive for all to authenticated
  using (private.is_active_user())
  with check (private.is_active_user());

