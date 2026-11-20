# Akash Enterprises Attendance Portal

Modern workforce attendance portal for Akash Enterprises.

## Stack

- **Frontend:** Next.js 14, React, TypeScript
- **Hosting:** Vercel Hobby
- **Backend:** Supabase Auth, Postgres and Storage
- **Browser APIs:** Geolocation and camera access for attendance workflows

The project is intended to stay on free-tier services. Do not add paid services or enable paid infrastructure without explicit approval.

## Roles

- **HR Manager / Technical Super Admin:** manage office and project locations, assign employees to base locations, and access HR workspace.
- **Employee / Site Manager:** access their employee workspace and view their assigned base location.
- **Proprietor:** company-level read-only access is part of the database role model.

Users sign in with their User ID and password. The app maps the User ID to the internal Supabase Auth email suffix in `lib/supabase.ts`; the internal email is not shown in the UI.

## Current frontend

- Modern responsive sign-in screen.
- HR dashboard with location totals and employee assignment counts.
- Create and edit Office / Project Site locations.
- Capture GPS coordinates from the browser or enter them manually.
- Assign a Site Manager to a location.
- Activate/deactivate locations.
- Assign or clear an employee's base location.
- Employee workspace showing the assigned base location.
- First-login password update screen.

A base location is an administrative assignment. It is stored separately from the employee's actual GPS punch coordinates. **There is no geofence restriction** in this workflow.

## Supabase

The connected Supabase project already contains the Attendance ERP schema (profiles, work_locations, attendance, leave/transfer requests, daily workers, and related policies). The original root `supabase/schema.sql` was a prototype schema and did not match that live database; it has been archived as `supabase/legacy-schema.sql`.

The HR location-management migration is tracked at:

`supabase/migrations/20261120000100_hr_location_management.sql`

It adds the Office/Site type, HR-only location writes, scoped profile update permissions, and the employee location assignment RPC.

Required browser environment variables:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_publishable_key
```

Use only the Supabase publishable/anon key in browser code. Never expose a service-role or secret key in a `NEXT_PUBLIC_` variable.

## Vercel

- Root directory: repository root
- Framework: Next.js
- Node.js: 22.x
- Required Supabase environment variables are configured for Production, Preview and Development.

## Next implementation steps

1. Complete GPS + selfie check-in and check-out in the Next.js employee workspace.
2. Build HR attendance reports and exports.
3. Add employee account creation and profile management through a secure server-side/Edge Function flow.
