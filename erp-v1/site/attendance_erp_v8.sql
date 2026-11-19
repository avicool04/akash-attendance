-- Add the read-only owner role for AE0001.
alter type public.app_role add value if not exists 'proprietor';

