-- Akash Enterprises Attendance - Supabase Schema (Free Tier Friendly)
-- Run this in Supabase SQL Editor

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Profiles (extends auth.users)
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  user_id text unique not null,          -- the login ID employees use (e.g. EMP001)
  full_name text not null,
  role text not null check (role in ('admin', 'employee')) default 'employee',
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Attendance records
create table public.attendance (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  type text not null check (type in ('in', 'out')),
  latitude double precision,
  longitude double precision,
  address text,
  photo_url text,                        -- Supabase Storage path
  device_info text,
  punched_at timestamptz default now(),
  created_at timestamptz default now()
);

-- Indexes for performance
create index idx_attendance_user_id on public.attendance(user_id);
create index idx_attendance_punched_at on public.attendance(punched_at desc);
create index idx_profiles_user_id on public.profiles(user_id);

-- Row Level Security
alter table public.profiles enable row level security;
alter table public.attendance enable row level security;

-- Profiles policies
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Admins can view all profiles"
  on public.profiles for select
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

create policy "Admins can insert profiles"
  on public.profiles for insert
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

create policy "Admins can update profiles"
  on public.profiles for update
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

-- Attendance policies
create policy "Users can insert own attendance"
  on public.attendance for insert
  with check (auth.uid() = user_id);

create policy "Users can view own attendance"
  on public.attendance for select
  using (auth.uid() = user_id);

create policy "Admins can view all attendance"
  on public.attendance for select
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );
