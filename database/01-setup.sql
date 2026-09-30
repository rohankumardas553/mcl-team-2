-- MineShift Command - Phase 1 setup. Safe to run more than once.
-- Reuses the table shift_exceptions. Nothing is dropped or deleted.
-- If the table is missing, it is created. Missing columns are added.

create table if not exists public.shift_exceptions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

alter table public.shift_exceptions add column if not exists shift text;
alter table public.shift_exceptions add column if not exists location text;
alter table public.shift_exceptions add column if not exists category text;
alter table public.shift_exceptions add column if not exists issue_type text;
alter table public.shift_exceptions add column if not exists description text;
alter table public.shift_exceptions add column if not exists impact_minutes integer;
alter table public.shift_exceptions add column if not exists urgency text;
alter table public.shift_exceptions add column if not exists status text;
alter table public.shift_exceptions add column if not exists resolved_at timestamptz;

-- New rows: status starts as Open, created_at is the current time,
-- resolved_at stays empty.
alter table public.shift_exceptions alter column status set default 'Open';
alter table public.shift_exceptions alter column created_at set default now();

alter table public.shift_exceptions enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
      and tablename = 'shift_exceptions' and policyname = 'anyone can read') then
    create policy "anyone can read" on public.shift_exceptions
      for select to anon, authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
      and tablename = 'shift_exceptions' and policyname = 'anyone can add') then
    create policy "anyone can add" on public.shift_exceptions
      for insert to anon, authenticated with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
      and tablename = 'shift_exceptions' and policyname = 'anyone can update') then
    create policy "anyone can update" on public.shift_exceptions
      for update to anon, authenticated using (true) with check (true);
  end if;
end $$;

grant select, insert, update on public.shift_exceptions to anon, authenticated;

-- 12 fictional demo records over the previous 14 days.
-- A row is added only if the same description does not already exist,
-- so running this again will not create duplicates.
insert into public.shift_exceptions
  (created_at, shift, location, category, issue_type, description, impact_minutes, urgency, status, resolved_at)
select now() - v.ago, v.shift, v.location, v.category, v.issue_type,
       v.description, v.impact_minutes, v.urgency, v.status,
       case when v.status = 'Resolved' then now() - v.ago + interval '3 hours' end
from (values
  (interval '14 days 2 hours', 'First',  'Siding A',     'Coal Despatch',    'Coal shortage',            'Demo: Rake waiting, coal stock low at siding.',            90, 'High',   'Resolved'),
  (interval '13 days 5 hours', 'Night',  'Haul Road A',  'Dust Suppression', 'Water tanker unavailable', 'Demo: Only one tanker running, road very dusty.',     45, 'Medium', 'Resolved'),
  (interval '12 days 1 hour',  'Second', 'Stockyard A',  'Coal Despatch',    'Loader breakdown',         'Demo: Loader stopped, loading slowed down.',              120, 'High',   'Resolved'),
  (interval '11 days 6 hours', 'First',  'Junction A',   'Dust Suppression', 'Sprinkling required',      'Demo: Junction dry, sprinkling needed before noon.',       20, 'Low',    'Resolved'),
  (interval '10 days 3 hours', 'Night',  'Siding B',     'Coal Despatch',    'Siding congestion',        'Demo: Two rakes queued, one line free.',                   60, 'Medium', 'Resolved'),
  (interval '8 days 4 hours',  'Second', 'Haul Road B',  'Dust Suppression', 'Heavy dust',               'Demo: Dust cloud reduces visibility near the bend.',       30, 'High',   'Resolved'),
  (interval '7 days 2 hours',  'First',  'Siding A',     'Coal Despatch',    'Weighbridge delay',        'Demo: Weighbridge slow, trucks waiting in a line.',        50, 'Medium', 'Resolved'),
  (interval '5 days 7 hours',  'Night',  'Coal Face A',  'Dust Suppression', 'Fog cannon required',      'Demo: Blasting area needs fog cannon.',                    25, 'Medium', 'Open'),
  (interval '4 days 1 hour',   'Second', 'Haul Road A',  'Coal Despatch',    'Haul-road delay',          'Demo: Trucks slow on wet road section.',                   40, 'Low',    'Open'),
  (interval '3 days 5 hours',  'First',  'Coal Face B',  'Coal Despatch',    'Tipper shortage',          'Demo: Six tippers short for the morning plan.',            75, 'High',   'In progress'),
  (interval '2 days 3 hours',  'Night',  'Stockyard A',  'Dust Suppression', 'Water tanker required',    'Demo: Stockyard needs one more tanker tonight.',           35, 'Low',    'Open'),
  (interval '1 day 2 hours',   'Second', 'Siding B',     'Coal Despatch',    'Weather',                  'Demo: Heavy rain, loading paused for a short time.',       55, 'Medium', 'Open')
) as v(ago, shift, location, category, issue_type, description, impact_minutes, urgency, status)
where not exists (
  select 1 from public.shift_exceptions e where e.description = v.description
);
