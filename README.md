# Workstation Reservations (A–D)

Minimal reservation SPA for **4 hardcoded workstations** (A, B, C, D), deployable to **GitHub Pages**.

- Frontend: **React + Vite** (HashRouter)
- Backend: **Supabase** (Postgres + RLS + RPC)
- Admin auth: **Supabase Auth** (admin-only)
- Calendar: **FullCalendar** (week/day view, drag-to-select)
- **No usage analytics**: the app stores only **settings + reservations** (and admin profile in Supabase Auth).

Admin is automatically assigned to:
- **tomas.oles@euba.sk**

## 1) Supabase setup

1. Create a new Supabase project.
2. In Supabase SQL Editor, run the script:
   - `supabase_setup.sql`

This creates:
- `profiles` (admin-only; auto-created on signup via trigger)
- `settings` (single row id=1)
- `reservations` (public booking: first/last name stored)
- RLS policies
- RPC `create_reservation(...)` (callable by anon/auth) which enforces:
  - workstation non-overlap
  - maxCapacity across all workstations (concurrency-safe)
  - slot length rules
  - booking horizon
  - opening hours (evaluated in Europe/Bratislava time)

## 2) Configure env vars

Copy `.env.example` to `.env` and set:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

> For GitHub Pages deployment, store these as repository **Secrets**:
> - `VITE_SUPABASE_URL`
> - `VITE_SUPABASE_ANON_KEY`

## 3) Run locally

```bash
npm install
npm run dev
```

## 4) Deploy to GitHub Pages

### Option A: GitHub Actions (included)

1. Push to `main`.
2. In GitHub repo settings:
   - **Pages** → Source: **GitHub Actions**
3. Add repository secrets:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

### Option B: Manual

```bash
npm install
npm run build
```
Deploy the `dist/` directory to GitHub Pages.

## Logo / favicon

- `public/logo.svg` is used in the header (large & flexible).
- `public/favicon.png` is used as the favicon.

To replace: overwrite these files with your own assets.

## Notes

- Workstations are **hardcoded** in `src/lib/constants.ts`.
- Reservations are shown in the user’s **local timezone**.
- Users do **not** sign in; they enter **first + last name** when booking.
- Admin can **delete** any reservation (intended for suspicious bookings).
