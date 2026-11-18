# Akash Enterprises – Attendance System

Web-based attendance app inspired by ubiAttendance, built for **free tiers**:

- **Frontend**: Next.js on Vercel (Hobby)
- **Backend / Auth / DB / Storage**: Supabase Free Tier
- **GPS + Reverse Geocoding**: Browser Geolocation + BigDataCloud (free, no key)
- **Selfie**: Captured on every punch and stored in Supabase Storage

### Roles
- **Admin (HR)**: Create employees (User ID + Password), view dashboard, all records
- **Employee**: Login with User ID + Password, Check In / Check Out with GPS + selfie

### Login
Employees and admins login with **User ID + Password** only (no email shown to users).  
Internally we map `user_id` → `user_id@akash.internal` for Supabase Auth.

---

## 1. Supabase Setup (Free)

1. Create a project at https://supabase.com → Free plan
2. Go to **SQL Editor** → paste and run `supabase/schema.sql`
3. Create a Storage bucket named `attendance-photos` (private)
4. In **Authentication → Providers**, enable Email (we use it internally)
5. Copy your Project URL and anon key

### Create the first Admin manually

In Supabase Dashboard → Authentication → Users → Add user:
- Email: `admin@akash.internal`
- Password: choose a strong one
- Auto Confirm: Yes

Then in SQL Editor:

```sql
insert into public.profiles (id, user_id, full_name, role)
values (
  'PASTE_THE_USER_UUID_HERE',
  'admin',
  'HR Admin',
  'admin'
);
```

---

## 2. Environment Variables

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
```

---

## Features
- User ID + Password login
- Admin creates employees
- GPS + Selfie check-in/out
- Admin dashboard (present / currently in)
- Official Akash Enterprises logo
