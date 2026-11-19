# Akash Enterprises Attendance ERP v1

This branch holds the first working attendance and daily-wage-worker modules for Akash Enterprises.

## Current scope

- Permanent employee selfie check-in and check-out with GPS, punch location label, and 5 km from base flag.
- Attendance reports, day-wise/total/average hours, and Excel exports with embedded selfies.
- Multi-day past attendance correction requests and site transfer approval by HR or the current reporting manager.
- HR-managed base locations, employee attendance profiles, and holidays.
- Site-manager records for daily wage workers, with one-hour break deduction and overtime at daily rate / 8 per excess hour; NMR-style reporting.

## Source layout

- `site/`: browser app intended for static hosting.
- `database/`: migrations already applied to Supabase project `nyhayizvnkzjirhhmbzh`.

The project uses Supabase for Auth, Postgres, and private selfie storage. The browser-side key in `site/app.js` is the Supabase **publishable** key; service-role secrets are not stored here.

## Deploy

The static site root is `site/`. The deployed origin must be added to the Supabase Auth allowed redirect/site URL settings if future flows need redirects. Sign-in uses email and password and does not require account self-registration.
