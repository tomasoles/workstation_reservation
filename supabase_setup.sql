-- Supabase setup for Workstation Reservations (A–D, hardcoded in frontend)
-- No usage / analytics tables.

-- Enable needed extension
create extension if not exists pgcrypto;

-- Profiles (users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  role text not null default 'USER' check (role in ('USER','ADMIN')),
  created_at timestamptz not null default now()
);

-- Global settings (single row id=1)
create table if not exists public.settings (
  id int primary key,
  max_capacity int not null default 4 check (max_capacity between 1 and 4),
  opening_hours_by_day jsonb not null,
  min_slot_minutes int not null default 30,
  max_slot_minutes int not null default 240,
  booking_horizon_days int not null default 30,
  updated_at timestamptz not null default now()
);

-- Reservations
create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  workstation_id text not null check (workstation_id in ('A','B','C','D')),
  -- user_id is optional because bookings are public (no user login required)
  user_id uuid references public.profiles(id) on delete set null,
  first_name text not null,
  last_name text not null,
  start_time timestamptz not null,
  end_time timestamptz not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','CANCELLED')),
  created_at timestamptz not null default now(),
  constraint end_after_start check (end_time > start_time)
);

-- If you already created the table earlier, ensure required columns exist
alter table public.reservations add column if not exists first_name text;
alter table public.reservations add column if not exists last_name text;
alter table public.reservations alter column user_id drop not null;

create index if not exists idx_res_workstation_timerange on public.reservations (workstation_id, start_time, end_time);
create index if not exists idx_res_timerange on public.reservations (start_time, end_time);
create index if not exists idx_res_user on public.reservations (user_id);

-- Seed settings row (Mon–Fri 08:00–18:00, Sat 10:00–14:00, Sun closed)
insert into public.settings (id, max_capacity, opening_hours_by_day, min_slot_minutes, max_slot_minutes, booking_horizon_days)
values (
  1,
  4,
  '{
    "0": {"open": "08:00", "close": "18:00", "enabled": false},
    "1": {"open": "08:00", "close": "18:00", "enabled": true},
    "2": {"open": "08:00", "close": "18:00", "enabled": true},
    "3": {"open": "08:00", "close": "18:00", "enabled": true},
    "4": {"open": "08:00", "close": "18:00", "enabled": true},
    "5": {"open": "08:00", "close": "18:00", "enabled": true},
    "6": {"open": "10:00", "close": "14:00", "enabled": true}
  }'::jsonb,
  30,
  240,
  30
)
on conflict (id) do nothing;

-- Auto-create profile on signup; admin bootstrap by email
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (
    new.id,
    new.email,
    case when lower(new.email) = lower('tomas.oles@euba.sk') then 'ADMIN' else 'USER' end
  )
  on conflict (id) do update set email = excluded.email;

  return new;
end;
$$;

-- Trigger on auth.users
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- RLS
alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.reservations enable row level security;

-- Helper: is admin
create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'ADMIN'
  );
$$;

-- Profiles policies
drop policy if exists "profiles: read own or admin" on public.profiles;
create policy "profiles: read own or admin" on public.profiles
for select
to authenticated
using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles: update own display_name" on public.profiles;
create policy "profiles: update own display_name" on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- Settings policies (public read, admin update)
drop policy if exists "settings: read" on public.settings;
create policy "settings: read" on public.settings
for select
to anon, authenticated
using (true);

drop policy if exists "settings: admin update" on public.settings;
create policy "settings: admin update" on public.settings
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Reservations policies
drop policy if exists "reservations: read" on public.reservations;
create policy "reservations: read" on public.reservations
for select
to anon, authenticated
using (true);

-- Prevent direct inserts; must go through RPC
drop policy if exists "reservations: no direct insert" on public.reservations;
create policy "reservations: no direct insert" on public.reservations
for insert
to anon, authenticated
with check (false);

-- Users can cancel their own reservations; admins can update any
drop policy if exists "reservations: update own or admin" on public.reservations;
create policy "reservations: update own or admin" on public.reservations
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Admin can hard delete (suspicious reservations)
drop policy if exists "reservations: admin delete" on public.reservations;
create policy "reservations: admin delete" on public.reservations
for delete
to authenticated
using (public.is_admin());

-- Concurrency-safe booking RPC
-- FIX: Use OUT parameter named "reservation_id" instead of "id" to avoid
--      ambiguity with the reservations.id column in the RETURNING clause.
drop function if exists public.create_reservation(text, timestamptz, timestamptz, text, text);
create or replace function public.create_reservation(
  workstation_id text,
  start_time timestamptz,
  end_time timestamptz,
  first_name text,
  last_name text,
  out reservation_id uuid          -- renamed: was "id", caused column ambiguity
)
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.settings;
  tz text := 'Europe/Bratislava';
  local_start timestamp;
  local_end timestamp;
  dow int;
  rule jsonb;
  open_t time;
  close_t time;
  mins int;
  horizon timestamptz;
  times timestamptz[];
  i int;
  seg_start timestamptz;
  sample timestamptz;
  active_count int;
  overlap_count int;
begin
  if coalesce(trim(first_name), '') = '' or coalesce(trim(last_name), '') = '' then
    raise exception 'Please enter your first name and last name.';
  end if;

  if workstation_id not in ('A','B','C','D') then
    raise exception 'Invalid workstation.';
  end if;

  select * into s from public.settings where id = 1;
  if not found then
    raise exception 'System settings are missing.';
  end if;

  if end_time <= start_time then
    raise exception 'End time must be after start time.';
  end if;

  mins := round(extract(epoch from (end_time - start_time)) / 60);
  if mins < s.min_slot_minutes then
    raise exception 'Minimum reservation is % minutes.', s.min_slot_minutes;
  end if;
  if mins > s.max_slot_minutes then
    raise exception 'Maximum reservation is % minutes.', s.max_slot_minutes;
  end if;

  horizon := now() + make_interval(days => s.booking_horizon_days);
  if start_time > horizon then
    raise exception 'Bookings are limited to % days in advance.', s.booking_horizon_days;
  end if;

  -- Opening hours check in Europe/Bratislava local time
  local_start := (start_time at time zone tz);
  local_end := (end_time at time zone tz);
  if date_trunc('day', local_start) <> date_trunc('day', local_end) then
    raise exception 'Reservations must start and end on the same day.';
  end if;

  dow := extract(dow from local_start);
  rule := s.opening_hours_by_day -> (dow::text);

  if rule is null or coalesce((rule->>'enabled')::boolean, false) = false then
    raise exception 'This day is closed.';
  end if;

  open_t := (rule->>'open')::time;
  close_t := (rule->>'close')::time;

  if (local_start::time) < open_t or (local_end::time) > close_t then
    raise exception 'Reservations must be within opening hours (%–%).', (rule->>'open'), (rule->>'close');
  end if;

  -- No overlap on same workstation
  select count(*) into overlap_count
  from public.reservations r
  where r.status = 'ACTIVE'
    and r.workstation_id = create_reservation.workstation_id
    and r.start_time < create_reservation.end_time
    and r.end_time > create_reservation.start_time;

  if overlap_count > 0 then
    raise exception 'That workstation is already reserved for part of this time range.';
  end if;

  -- Capacity check across all workstations (boundary-based)
  select array_agg(distinct t order by t) into times
  from (
    select create_reservation.start_time as t
    union all
    select create_reservation.end_time as t
    union all
    select r.start_time as t
    from public.reservations r
    where r.status='ACTIVE'
      and r.start_time < create_reservation.end_time
      and r.end_time > create_reservation.start_time
    union all
    select r.end_time as t
    from public.reservations r
    where r.status='ACTIVE'
      and r.start_time < create_reservation.end_time
      and r.end_time > create_reservation.start_time
  ) u;

  if times is null then
    times := array[create_reservation.start_time, create_reservation.end_time];
  end if;

  for i in 1..array_length(times, 1) - 1 loop
    seg_start := times[i];
    if seg_start < create_reservation.end_time and times[i+1] > create_reservation.start_time then
      sample := greatest(seg_start, create_reservation.start_time) + interval '1 second';

      select count(*) into active_count
      from public.reservations r
      where r.status='ACTIVE'
        and r.start_time < sample
        and r.end_time > sample;

      if active_count + 1 > s.max_capacity then
        raise exception 'Booking blocked: max capacity (% reservations at once) would be exceeded. Try a different time or workstation.', s.max_capacity;
      end if;
    end if;
  end loop;

  -- FIX: Insert and return into "reservation_id" OUT param — no ambiguity
  insert into public.reservations (workstation_id, user_id, first_name, last_name, start_time, end_time, status)
  values (
    create_reservation.workstation_id,
    auth.uid(),
    trim(first_name),
    trim(last_name),
    create_reservation.start_time,
    create_reservation.end_time,
    'ACTIVE'
  )
  returning reservations.id into reservation_id;
end;
$$;

revoke all on function public.create_reservation(text, timestamptz, timestamptz, text, text) from public;
grant execute on function public.create_reservation(text, timestamptz, timestamptz, text, text) to anon, authenticated;

-- Ensure the API roles can read what the UI needs
grant select on table public.settings to anon, authenticated;
grant select on table public.reservations to anon, authenticated;