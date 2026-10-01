-- MineShift Command - 04 Auth foundation (Phase A of the login and roles upgrade).
--
-- SAFE TO RUN MORE THAN ONCE. ADDITIVE ONLY:
--   * nothing is dropped, deleted or overwritten
--   * existing shift_exceptions rows are kept exactly as they are
--   * only NEW empty columns are added and (for old rows) filled from urgency
--   * the old open access rules are NOT changed here (that is 07-lockdown.sql, later),
--     so the live website keeps working exactly as before after you run this.
--
-- !! AFTER 07-lockdown.sql HAS BEEN RUN, DO NOT RE-RUN THIS WHOLE FILE. !!
--    Re-running it re-opens internal helper functions to signed-in users (it re-grants what 07 hid).
--    To link new accounts later, run ONLY 04b-link-accounts.sql.
--
-- Run this whole file in the Supabase SQL Editor, in one go.
-- Take a CSV backup of shift_exceptions first (Table Editor > shift_exceptions > Export).

begin;

-- ---------------------------------------------------------------------------
-- 1. Roles: helper to turn a role name into a rank (higher = more senior)
-- ---------------------------------------------------------------------------
create or replace function public.role_rank(p_role text)
returns integer language sql immutable as $$
  select case p_role
    when 'overman'          then 1
    when 'shift_incharge'   then 2
    when 'manager'          then 3
    when 'project_officer'  then 4
    when 'general_manager'  then 5
    else 0 end
$$;

create or replace function public.role_label(p_role text)
returns text language sql immutable as $$
  select case p_role
    when 'overman'          then 'Overman / Supervisor'
    when 'shift_incharge'   then 'Shift In-Charge'
    when 'manager'          then 'Manager'
    when 'project_officer'  then 'Project Officer'
    when 'general_manager'  then 'General Manager'
    else coalesce(p_role, 'unknown') end
$$;

-- ---------------------------------------------------------------------------
-- 2. profiles: who each login account is. Written only by the Data Keeper.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null,
  role        text not null check (role in
                ('overman', 'shift_incharge', 'manager', 'project_officer', 'general_manager')),
  active      boolean not null default true,
  can_operate boolean not null default false,   -- lets a Manager Start / Resolve / Reopen / Decline
  created_at  timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- Helper functions. They read the caller's own profile (SECURITY DEFINER so the
-- caller does not need direct access to the table).
create or replace function public.app_role()
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select p.role from public.profiles p where p.user_id = auth.uid() and p.active
$$;

create or replace function public.app_rank()
returns integer language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.role_rank(public.app_role()), 0)
$$;

create or replace function public.app_can_operate()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select p.can_operate from public.profiles p
                   where p.user_id = auth.uid() and p.active), false)
$$;

-- Returns the caller's active profile, or stops with a clear message.
create or replace function public.app_actor()
returns public.profiles language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v public.profiles;
begin
  select * into v from public.profiles where user_id = auth.uid() and active;
  if v.user_id is null then
    raise exception 'Your account has no active role. Please contact the Data Keeper.';
  end if;
  return v;
end
$$;

-- Read-only check used by the login page: what does the DATABASE think I am?
create or replace function public.my_access()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select case when p.user_id is null
              then jsonb_build_object('linked', false)
              else jsonb_build_object('linked', true, 'active', p.active,
                     'full_name', p.full_name, 'role', p.role,
                     'rank', public.role_rank(p.role), 'can_operate', p.can_operate)
         end
  from (select 1) x
  left join public.profiles p on p.user_id = auth.uid()
$$;

-- No directory of staff is exposed to the browser. Screens show "set by <name>" from the
-- name snapshots stored on each record (see the *_name columns below).
-- (An earlier draft of this file created a names view; it is removed if it exists.)
drop view if exists public.people;

-- ---------------------------------------------------------------------------
-- 3. New columns on shift_exceptions (all empty for existing rows)
-- ---------------------------------------------------------------------------
alter table public.shift_exceptions add column if not exists created_by uuid;
alter table public.shift_exceptions add column if not exists created_by_role text;
alter table public.shift_exceptions add column if not exists created_by_name text;
alter table public.shift_exceptions add column if not exists priority_changed_by_name text;
alter table public.shift_exceptions add column if not exists started_by_name text;
alter table public.shift_exceptions add column if not exists closure_requested_by_name text;
alter table public.shift_exceptions add column if not exists resolved_by_name text;
alter table public.shift_exceptions add column if not exists reported_priority text;
alter table public.shift_exceptions add column if not exists current_priority text;
alter table public.shift_exceptions add column if not exists priority_changed_by uuid;
alter table public.shift_exceptions add column if not exists priority_changed_by_role text;
alter table public.shift_exceptions add column if not exists priority_changed_at timestamptz;
alter table public.shift_exceptions add column if not exists priority_change_reason text;
alter table public.shift_exceptions add column if not exists started_by uuid;
alter table public.shift_exceptions add column if not exists started_at timestamptz;
alter table public.shift_exceptions add column if not exists closure_requested_by uuid;
alter table public.shift_exceptions add column if not exists closure_requested_at timestamptz;
alter table public.shift_exceptions add column if not exists resolved_by uuid;
alter table public.shift_exceptions add column if not exists updated_at timestamptz;

-- Old rows: the priority they were reported with is the urgency they already have.
-- Only EMPTY new columns are filled. urgency itself is never touched.
update public.shift_exceptions set reported_priority = urgency where reported_priority is null;
update public.shift_exceptions set current_priority  = urgency where current_priority  is null;

-- ---------------------------------------------------------------------------
-- 4. Remarks and audit trail (append-only)
-- ---------------------------------------------------------------------------
create table if not exists public.exception_remarks (
  id           uuid primary key default gen_random_uuid(),
  exception_id uuid not null,
  kind         text not null check (kind in ('operational', 'management')),
  body         text not null check (char_length(btrim(body)) between 3 and 1000),
  author_id    uuid,
  author_name  text not null,
  author_role  text not null,
  created_at   timestamptz not null default now()
);
create index if not exists exception_remarks_exception_idx on public.exception_remarks (exception_id);
alter table public.exception_remarks enable row level security;

create table if not exists public.exception_audit (
  id           uuid primary key default gen_random_uuid(),
  exception_id uuid not null,
  action       text not null,
  actor_id     uuid,
  actor_name   text,
  actor_role   text,
  old_value    text,
  new_value    text,
  note         text,
  created_at   timestamptz not null default now()
);
create index if not exists exception_audit_exception_idx on public.exception_audit (exception_id);
alter table public.exception_audit enable row level security;

-- Nobody may change or delete a remark or an audit line (not even the Data Keeper,
-- unless the trigger is deliberately switched off first).
create or replace function public.block_history_change()
returns trigger language plpgsql as $$
begin
  raise exception 'History is append-only. Add a new remark instead of changing or deleting an old one.';
end
$$;

drop trigger if exists exception_remarks_no_change on public.exception_remarks;
create trigger exception_remarks_no_change before update or delete on public.exception_remarks
  for each row execute function public.block_history_change();
drop trigger if exists exception_remarks_no_truncate on public.exception_remarks;
create trigger exception_remarks_no_truncate before truncate on public.exception_remarks
  for each statement execute function public.block_history_change();

drop trigger if exists exception_audit_no_change on public.exception_audit;
create trigger exception_audit_no_change before update or delete on public.exception_audit
  for each row execute function public.block_history_change();
drop trigger if exists exception_audit_no_truncate on public.exception_audit;
create trigger exception_audit_no_truncate before truncate on public.exception_audit
  for each statement execute function public.block_history_change();

-- One audit line for every existing record, so its history starts somewhere.
insert into public.exception_audit (exception_id, action, actor_name, actor_role, new_value, note, created_at)
select e.id, 'legacy_imported', 'System', 'system', e.status,
       'Existing record kept when individual login was introduced', e.created_at
from public.shift_exceptions e
where not exists (select 1 from public.exception_audit a
                  where a.exception_id = e.id and a.action = 'legacy_imported');

-- ---------------------------------------------------------------------------
-- 5. Protection on shift_exceptions itself
--    (browser users can only change a record through the functions in section 6)
-- ---------------------------------------------------------------------------
create or replace function public.exceptions_before_insert()
returns trigger language plpgsql as $$
begin
  if current_user in ('anon', 'authenticated') then
    -- A browser user cannot forge who did what, or insert an already-closed record.
    NEW.created_by := null;            NEW.created_by_role := null;   NEW.created_by_name := null;
    NEW.priority_changed_by := null;   NEW.priority_changed_by_role := null;
    NEW.priority_changed_by_name := null;
    NEW.priority_changed_at := null;   NEW.priority_change_reason := null;
    NEW.started_by := null;            NEW.started_at := null;        NEW.started_by_name := null;
    NEW.closure_requested_by := null;  NEW.closure_requested_at := null;
    NEW.closure_requested_by_name := null;
    NEW.resolved_by := null;           NEW.resolved_at := null;       NEW.resolved_by_name := null;
    NEW.status := 'Open';
  end if;
  if coalesce(current_setting('app.in_rpc', true), '') <> '1' then
    -- Old-style insert (Data Keeper SQL files or the not-yet-locked website):
    -- keep the three priority columns in step with urgency.
    NEW.reported_priority := coalesce(NEW.reported_priority, NEW.urgency);
    NEW.current_priority  := coalesce(NEW.current_priority, NEW.reported_priority, NEW.urgency);
    NEW.urgency           := coalesce(NEW.urgency, NEW.current_priority);
  end if;
  return NEW;
end
$$;

create or replace function public.exceptions_before_change()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if current_user in ('anon', 'authenticated') then
      raise exception 'Records cannot be deleted.';
    end if;
    return OLD;
  end if;

  if current_user = 'authenticated' then
    raise exception 'Direct changes are not allowed. Use the buttons in the MineShift pages.';
  end if;

  if current_user = 'anon' then
    -- Until 07-lockdown.sql the old website may still change status / resolved_at.
    -- Everything else is fixed for good.
    if NEW.id                       is distinct from OLD.id
    or NEW.created_at               is distinct from OLD.created_at
    or NEW.shift                    is distinct from OLD.shift
    or NEW.location                 is distinct from OLD.location
    or NEW.category                 is distinct from OLD.category
    or NEW.issue_type               is distinct from OLD.issue_type
    or NEW.description              is distinct from OLD.description
    or NEW.impact_minutes           is distinct from OLD.impact_minutes
    or NEW.urgency                  is distinct from OLD.urgency
    or NEW.reported_priority        is distinct from OLD.reported_priority
    or NEW.current_priority         is distinct from OLD.current_priority
    or NEW.created_by               is distinct from OLD.created_by
    or NEW.created_by_role          is distinct from OLD.created_by_role
    or NEW.priority_changed_by      is distinct from OLD.priority_changed_by
    or NEW.priority_changed_by_role is distinct from OLD.priority_changed_by_role
    or NEW.priority_changed_at      is distinct from OLD.priority_changed_at
    or NEW.priority_change_reason   is distinct from OLD.priority_change_reason
    or NEW.started_by               is distinct from OLD.started_by
    or NEW.started_at               is distinct from OLD.started_at
    or NEW.closure_requested_by     is distinct from OLD.closure_requested_by
    or NEW.closure_requested_at     is distinct from OLD.closure_requested_at
    or NEW.resolved_by              is distinct from OLD.resolved_by
    or NEW.created_by_name          is distinct from OLD.created_by_name
    or NEW.priority_changed_by_name is distinct from OLD.priority_changed_by_name
    or NEW.started_by_name          is distinct from OLD.started_by_name
    or NEW.closure_requested_by_name is distinct from OLD.closure_requested_by_name
    or NEW.resolved_by_name         is distinct from OLD.resolved_by_name then
      raise exception 'These fields cannot be edited after the record is created.';
    end if;
  end if;

  -- The controlled location rename (05-location-renames.sql) sets app.skip_touch so that
  -- renamed records keep their old updated_at.
  if coalesce(current_setting('app.skip_touch', true), '') <> '1' then
    NEW.updated_at := now();
  end if;
  return NEW;
end
$$;

-- Audit lines for changes that did NOT go through the functions (before 07-lockdown).
create or replace function public.exceptions_audit_direct()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(current_setting('app.in_rpc', true), '') = '1' then
    return null;
  end if;
  if tg_op = 'INSERT' then
    insert into public.exception_audit (exception_id, action, actor_id, actor_name, actor_role, new_value, note)
    values (NEW.id, 'created', auth.uid(), 'Direct entry', 'system', NEW.status,
            'Added directly, not through the login rules');
  elsif OLD.status is distinct from NEW.status or OLD.urgency is distinct from NEW.urgency then
    insert into public.exception_audit (exception_id, action, actor_id, actor_name, actor_role, old_value, new_value, note)
    values (NEW.id, 'direct_change', auth.uid(), 'Direct change', 'system',
            OLD.status || ' / ' || coalesce(OLD.urgency, ''),
            NEW.status || ' / ' || coalesce(NEW.urgency, ''),
            'Changed directly, not through the login rules');
  end if;
  return null;
end
$$;

drop trigger if exists exceptions_before_insert on public.shift_exceptions;
create trigger exceptions_before_insert before insert on public.shift_exceptions
  for each row execute function public.exceptions_before_insert();

drop trigger if exists exceptions_before_change on public.shift_exceptions;
create trigger exceptions_before_change before update or delete on public.shift_exceptions
  for each row execute function public.exceptions_before_change();

drop trigger if exists exceptions_audit_direct on public.shift_exceptions;
create trigger exceptions_audit_direct after insert or update on public.shift_exceptions
  for each row execute function public.exceptions_audit_direct();

-- ---------------------------------------------------------------------------
-- 6. The functions that make every change (the only way for a signed-in user)
-- ---------------------------------------------------------------------------
create or replace function public._audit(p_exception uuid, p_action text, p_actor public.profiles,
                                         p_old text, p_new text, p_note text)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.exception_audit
    (exception_id, action, actor_id, actor_name, actor_role, old_value, new_value, note)
  values (p_exception, p_action, p_actor.user_id, p_actor.full_name, p_actor.role, p_old, p_new, p_note)
$$;

create or replace function public._issue_type_ok(p_category text, p_issue text)
returns boolean language sql immutable as $$
  select coalesce(case p_category
    when 'Coal Despatch' then p_issue = any (array['Coal shortage','Tipper shortage','Loader breakdown',
      'Siding congestion','Weighbridge delay','Haul-road delay','Weather','Other'])
    when 'Dust Suppression' then p_issue = any (array['Water tanker required','Water tanker unavailable',
      'Fog cannon required','Fog cannon unavailable','Heavy dust','Sprinkling required','Other'])
    when 'Haul Road' then p_issue = any (array['Potholes','Slippery road','Waterlogging','Poor road surface',
      'Berm issue','Drainage problem','Grader required','Dozer required','Water tanker required',
      'Traffic congestion','Poor visibility','Other'])
    when 'Coal Quality' then p_issue = any (array['Shale or band contamination','Stone contamination',
      'Oversize coal','Mixed coal','Excess moisture','Grade concern','Face quality issue',
      'Siding quality issue','Segregation required','Rehandling required','Sampling concern','Other'])
    end, false)
$$;

-- CREATE: Overman / Supervisor and Shift In-Charge only.
-- IST shift control (also in 10-ist-shift-control.sql, which upgrades a database that was set up before it).
-- A new exception must be in the shift running now on the DATABASE clock (India time).
-- Keeping it here means a fresh setup, or a re-run of this file, can never bring back the old behaviour.
-- The one definition of the current shift (IST). Pure: the time is passed in.
create or replace function public.ist_shift(p_ts timestamptz)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case
    when (p_ts at time zone 'Asia/Kolkata')::time >= time '05:00'
     and (p_ts at time zone 'Asia/Kolkata')::time <  time '13:00' then 'First'
    when (p_ts at time zone 'Asia/Kolkata')::time >= time '13:00'
     and (p_ts at time zone 'Asia/Kolkata')::time <  time '21:00' then 'Second'
    else 'Night'
  end
$$;

-- Operational Day: the IST date of (time minus 5 hours). 02 Oct 02:30 IST -> 01 Oct.
create or replace function public.ist_operational_date(p_ts timestamptz)
returns date language sql immutable set search_path = public, pg_temp as $$
  select ((p_ts at time zone 'Asia/Kolkata') - interval '5 hours')::date
$$;

-- Start time (IST wall clock, as text) of a shift, used only in messages.
create or replace function public._shift_start_text(p_shift text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case p_shift when 'First' then '05:00' when 'Second' then '13:00' else '21:00' end
$$;

-- The check used by create_exception. The time is a parameter so that every
-- boundary can be tested; create_exception always passes now().
create or replace function public._check_live_shift(p_shift text, p_ts timestamptz)
returns void language plpgsql set search_path = public, pg_temp as $$
declare v_now text := public.ist_shift(p_ts);
begin
  if p_shift is distinct from v_now then
    raise exception 'The current shift is % (since % IST), not %. Please review and submit again.',
      v_now, public._shift_start_text(v_now), coalesce(p_shift, 'none');
  end if;
end
$$;

-- Trusted server clock for the pages (they only show it and correct a wrong device clock).
create or replace function public.shift_clock()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'now', now(),
    'shift', public.ist_shift(now()),
    'operational_date', public.ist_operational_date(now()))
$$;

-- create_exception: identical to the version in 04, plus the live shift check.
create or replace function public.create_exception(
  p_shift text, p_location text, p_category text, p_issue_type text,
  p_description text, p_impact_minutes integer, p_priority text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_a public.profiles := public.app_actor(); v_id uuid;
begin
  perform set_config('app.in_rpc', '1', true);
  if v_a.role not in ('overman', 'shift_incharge') then
    raise exception 'Only an Overman / Supervisor or a Shift In-Charge can create an exception.';
  end if;
  if p_shift not in ('First', 'Second', 'Night') then raise exception 'Please choose a valid shift.'; end if;
  perform public._check_live_shift(p_shift, now());
  if p_location not in ('ABC Patch','XYZ Patch','Haul Road A','Haul Road B',
                        'MDP Junction','Stockyard 1','Siding 1','Siding 2') then
    raise exception 'Please choose a valid location.'; end if;
  if p_category not in ('Coal Despatch','Dust Suppression','Haul Road','Coal Quality') then
    raise exception 'Please choose a valid category.'; end if;
  if not public._issue_type_ok(p_category, p_issue_type) then
    raise exception 'That issue type does not belong to the category "%".', p_category; end if;
  if p_priority not in ('Low', 'Medium', 'High') then raise exception 'Please choose Low, Medium or High.'; end if;
  if p_description is null or char_length(btrim(p_description)) not between 1 and 500 then
    raise exception 'Please enter a description (up to 500 characters).'; end if;
  if p_impact_minutes is null or p_impact_minutes not between 0 and 1440 then
    raise exception 'Impact minutes must be between 0 and 1440.'; end if;

  insert into public.shift_exceptions
    (shift, location, category, issue_type, description, impact_minutes,
     urgency, reported_priority, current_priority, status, created_by, created_by_role, created_by_name)
  values (p_shift, p_location, p_category, p_issue_type, btrim(p_description), p_impact_minutes,
          p_priority, p_priority, p_priority, 'Open', v_a.user_id, v_a.role, v_a.full_name)
  returning id into v_id;

  perform public._audit(v_id, 'created', v_a, null, 'Open',
    format('%s / %s / %s, priority %s', p_category, p_issue_type, p_location, p_priority));
  return v_id;
end
$$;


-- START: Overman / Supervisor, Shift In-Charge, Manager only when can_operate.
create or replace function public.start_exception(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_a public.profiles := public.app_actor(); v_e public.shift_exceptions;
begin
  perform set_config('app.in_rpc', '1', true);
  if not (v_a.role in ('overman', 'shift_incharge') or (v_a.role = 'manager' and v_a.can_operate)) then
    raise exception 'Your role (%) cannot Start an exception.', public.role_label(v_a.role);
  end if;
  select * into v_e from public.shift_exceptions where id = p_id for update;
  if not found then raise exception 'Exception not found.'; end if;
  if v_e.status <> 'Open' then
    raise exception 'Only an Open exception can be started (this one is %).', v_e.status; end if;
  update public.shift_exceptions
     set status = 'In progress', started_by = v_a.user_id, started_by_name = v_a.full_name,
         started_at = now()
   where id = p_id;
  perform public._audit(p_id, 'started', v_a, 'Open', 'In progress', null);
end
$$;

-- REQUEST CLOSURE: Overman / Supervisor and Shift In-Charge. Note of 5+ characters.
create or replace function public.request_closure(p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_a public.profiles := public.app_actor(); v_e public.shift_exceptions;
begin
  perform set_config('app.in_rpc', '1', true);
  if v_a.role not in ('overman', 'shift_incharge') then
    raise exception 'Your role (%) cannot request closure.', public.role_label(v_a.role); end if;
  if p_note is null or char_length(btrim(p_note)) < 5 then
    raise exception 'Please write a closure note of at least 5 characters (what was done or verified).'; end if;
  select * into v_e from public.shift_exceptions where id = p_id for update;
  if not found then raise exception 'Exception not found.'; end if;
  if v_e.status <> 'In progress' then
    raise exception 'Closure can only be requested for an In progress exception (this one is %).', v_e.status; end if;
  if v_e.closure_requested_at is not null then
    raise exception 'A closure request is already waiting for confirmation.'; end if;
  update public.shift_exceptions
     set closure_requested_by = v_a.user_id, closure_requested_by_name = v_a.full_name,
         closure_requested_at = now()
   where id = p_id;
  insert into public.exception_remarks (exception_id, kind, body, author_id, author_name, author_role)
  values (p_id, 'operational', btrim(p_note), v_a.user_id, v_a.full_name, v_a.role);
  perform public._audit(p_id, 'closure_requested', v_a, 'In progress', 'In progress', btrim(p_note));
end
$$;

-- DECLINE CLOSURE: Shift In-Charge, Manager only when can_operate. Reason required.
-- Maker-checker: the person who requested the closure can never decline it themselves.
create or replace function public.decline_closure(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_a public.profiles := public.app_actor(); v_e public.shift_exceptions;
begin
  perform set_config('app.in_rpc', '1', true);
  if not (v_a.role = 'shift_incharge' or (v_a.role = 'manager' and v_a.can_operate)) then
    raise exception 'Your role (%) cannot decline a closure request.', public.role_label(v_a.role); end if;
  if p_reason is null or char_length(btrim(p_reason)) < 5 then
    raise exception 'Please give a reason of at least 5 characters.'; end if;
  select * into v_e from public.shift_exceptions where id = p_id for update;
  if not found then raise exception 'Exception not found.'; end if;
  if v_e.status <> 'In progress' or v_e.closure_requested_at is null then
    raise exception 'There is no closure request to decline on this exception.'; end if;
  if v_e.closure_requested_by = v_a.user_id then
    raise exception '%', 'You cannot confirm or decline your own closure request. Another Shift In-Charge or authorised Manager must review it.'; end if;
  update public.shift_exceptions
     set closure_requested_by = null, closure_requested_by_name = null, closure_requested_at = null
   where id = p_id;
  perform public._audit(p_id, 'closure_declined', v_a,
    format('Closure requested by %s at %s', coalesce(v_e.closure_requested_by_name, 'unknown'),
           to_char(v_e.closure_requested_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"')),
    'In progress', btrim(p_reason));
end
$$;

-- RESOLVE: Shift In-Charge, Manager only when can_operate. In progress only.
-- A note (5+ characters) is required unless a closure request already exists.
-- Maker-checker: the person who requested the closure can never confirm it themselves.
create or replace function public.resolve_exception(p_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_a public.profiles := public.app_actor(); v_e public.shift_exceptions; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform set_config('app.in_rpc', '1', true);
  if not (v_a.role = 'shift_incharge' or (v_a.role = 'manager' and v_a.can_operate)) then
    raise exception 'Your role (%) cannot Resolve an exception. Only a Shift In-Charge confirms closure.',
      public.role_label(v_a.role); end if;
  select * into v_e from public.shift_exceptions where id = p_id for update;
  if not found then raise exception 'Exception not found.'; end if;
  if v_e.status <> 'In progress' then
    raise exception 'Only an In progress exception can be resolved (this one is %). An Open one must be started first.',
      v_e.status; end if;
  if v_e.closure_requested_at is not null and v_e.closure_requested_by = v_a.user_id then
    raise exception '%', 'You cannot confirm or decline your own closure request. Another Shift In-Charge or authorised Manager must review it.'; end if;
  if v_e.closure_requested_at is null and (v_note is null or char_length(v_note) < 5) then
    raise exception 'There is no closure request, so please write a resolution note of at least 5 characters.'; end if;
  if v_note is not null and char_length(v_note) < 5 then
    raise exception 'A resolution note must have at least 5 characters.'; end if;
  -- Final closure is confirmed: the ACTIVE closure request is cleared so a Resolved
  -- exception never looks as if confirmation is still pending. The request itself stays in
  -- the history: its audit line ('closure_requested'), its closure-note remark, and the
  -- old_value written below.
  update public.shift_exceptions
     set status = 'Resolved', resolved_at = now(), resolved_by = v_a.user_id,
         resolved_by_name = v_a.full_name,
         closure_requested_by = null, closure_requested_by_name = null, closure_requested_at = null
   where id = p_id;
  if v_note is not null then
    insert into public.exception_remarks (exception_id, kind, body, author_id, author_name, author_role)
    values (p_id, 'operational', v_note, v_a.user_id, v_a.full_name, v_a.role);
  end if;
  perform public._audit(p_id, 'resolved', v_a,
    case when v_e.closure_requested_at is null then 'In progress'
         else format('In progress (closure requested by %s at %s)',
                     coalesce(v_e.closure_requested_by_name, 'unknown'),
                     to_char(v_e.closure_requested_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"')) end,
    'Resolved',
    coalesce(v_note, 'Resolved after a closure request'));
end
$$;

-- REOPEN: Shift In-Charge, Manager, Project Officer, General Manager (a Manager does NOT need
-- can_operate for this). Reopening after an inspection or review is a supervisory / managerial
-- intervention, not routine closure. An Overman / Supervisor can NOT reopen. Resolved -> Open,
-- reason of 5+ characters required. Any of these roles may reopen regardless of who resolved it;
-- the mandatory reason and the immutable audit line give the accountability.
create or replace function public.reopen_exception(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_a public.profiles := public.app_actor(); v_e public.shift_exceptions;
begin
  perform set_config('app.in_rpc', '1', true);
  if v_a.role not in ('shift_incharge', 'manager', 'project_officer', 'general_manager') then
    raise exception 'Your role (%) cannot reopen an exception.', public.role_label(v_a.role); end if;
  if p_reason is null or char_length(btrim(p_reason)) < 5 then
    raise exception 'Please give a reason of at least 5 characters.'; end if;
  select * into v_e from public.shift_exceptions where id = p_id for update;
  if not found then raise exception 'Exception not found.'; end if;
  if v_e.status <> 'Resolved' then
    raise exception 'Only a Resolved exception can be reopened (this one is %).', v_e.status; end if;
  -- Reopening starts a fresh operational cycle: every current-cycle field is cleared.
  -- The audit trail and the remarks keep the earlier Start, closure request and Resolve.
  update public.shift_exceptions
     set status = 'Open',
         resolved_at = null, resolved_by = null, resolved_by_name = null,
         closure_requested_by = null, closure_requested_by_name = null, closure_requested_at = null,
         started_by = null, started_by_name = null, started_at = null
   where id = p_id;
  perform public._audit(p_id, 'reopened', v_a, 'Resolved', 'Open', btrim(p_reason));
end
$$;

-- CHANGE PRIORITY: Shift In-Charge and above. Reason required. Rank lock:
-- if the last person to set the priority ranks higher than you, you cannot change it.
create or replace function public.change_priority(p_id uuid, p_new text, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_a public.profiles := public.app_actor(); v_e public.shift_exceptions;
        v_old text; v_setter text; v_setter_rank integer;
begin
  perform set_config('app.in_rpc', '1', true);
  if v_a.role = 'overman' then
    raise exception 'An Overman / Supervisor cannot change priority after the exception is created.'; end if;
  if public.role_rank(v_a.role) < 2 then raise exception 'You cannot change priority.'; end if;
  if p_new not in ('Low', 'Medium', 'High') then raise exception 'Please choose Low, Medium or High.'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 5 then
    raise exception 'Please give a reason of at least 5 characters.'; end if;
  select * into v_e from public.shift_exceptions where id = p_id for update;
  if not found then raise exception 'Exception not found.'; end if;
  if v_e.status = 'Resolved' then
    raise exception 'A Resolved exception keeps its priority. Reopen it first if it must change.'; end if;
  v_old := coalesce(v_e.current_priority, v_e.urgency);
  if p_new = v_old then raise exception 'The priority is already %.', v_old; end if;
  v_setter := coalesce(v_e.priority_changed_by_role, v_e.created_by_role);
  v_setter_rank := public.role_rank(v_setter);
  if public.role_rank(v_a.role) < v_setter_rank then
    raise exception 'This priority was set by a %. Only a % or higher can change it.',
      public.role_label(v_setter), public.role_label(v_setter); end if;
  update public.shift_exceptions
     set current_priority = p_new, urgency = p_new,
         priority_changed_by = v_a.user_id, priority_changed_by_role = v_a.role,
         priority_changed_by_name = v_a.full_name,
         priority_changed_at = now(), priority_change_reason = btrim(p_reason)
   where id = p_id;
  perform public._audit(p_id, 'priority_changed', v_a, v_old, p_new, btrim(p_reason));
end
$$;

-- ADD REMARK: operational = Overman, Shift In-Charge. management = Manager, Project Officer,
-- General Manager. An Overman can only remark on an exception that is not Resolved.
create or replace function public.add_remark(p_id uuid, p_kind text, p_body text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_a public.profiles := public.app_actor(); v_e public.shift_exceptions;
begin
  perform set_config('app.in_rpc', '1', true);
  if p_kind not in ('operational', 'management') then raise exception 'Unknown remark type.'; end if;
  if p_kind = 'operational' and v_a.role not in ('overman', 'shift_incharge') then
    raise exception 'Your role (%) cannot add operational remarks.', public.role_label(v_a.role); end if;
  if p_kind = 'management' and v_a.role not in ('manager', 'project_officer', 'general_manager') then
    raise exception 'Your role (%) cannot add management remarks.', public.role_label(v_a.role); end if;
  if p_body is null or char_length(btrim(p_body)) < 3 then
    raise exception 'Please write a remark of at least 3 characters.'; end if;
  if char_length(btrim(p_body)) > 1000 then raise exception 'A remark can be up to 1000 characters.'; end if;
  select * into v_e from public.shift_exceptions where id = p_id;
  if not found then raise exception 'Exception not found.'; end if;
  if v_a.role = 'overman' and v_e.status = 'Resolved' then
    raise exception 'An Overman / Supervisor can only add remarks to an exception that is not Resolved.'; end if;
  insert into public.exception_remarks (exception_id, kind, body, author_id, author_name, author_role)
  values (p_id, p_kind, btrim(p_body), v_a.user_id, v_a.full_name, v_a.role);
  perform public._audit(p_id, 'remark_' || p_kind, v_a, null, null, left(btrim(p_body), 500));
end
$$;

-- ---------------------------------------------------------------------------
-- 7. Who may READ what (added next to the old rules; the old open rules stay until 07)
-- ---------------------------------------------------------------------------
-- These four policies are ours. They are dropped and re-created so a re-run always keeps
-- them current. (The old open policies on shift_exceptions are NOT touched here.)
--
-- An Overman sees every exception that is not Resolved, plus Resolved ones he CREATED.
-- "Created by" never changes, so it is a stable definition of "my history". Workflow fields
-- such as closure_requested_by are cleared on Resolve / Decline, so they are not used here.
-- No policy reads a table whose policy reads it back, so nothing here is recursive:
-- shift_exceptions -> (nothing), exception_remarks -> shift_exceptions.
drop policy if exists "role read exceptions" on public.shift_exceptions;
create policy "role read exceptions" on public.shift_exceptions
  for select to authenticated
  using (
    public.app_rank() >= 2
    or (public.app_rank() = 1
        and (status <> 'Resolved' or created_by = auth.uid()))
  );

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "role read remarks" on public.exception_remarks;
create policy "role read remarks" on public.exception_remarks
  for select to authenticated
  using (
    public.app_rank() >= 1
    and (kind = 'operational' or public.app_rank() >= 2)
    and exists (select 1 from public.shift_exceptions e where e.id = exception_id)
  );

drop policy if exists "role read audit" on public.exception_audit;
create policy "role read audit" on public.exception_audit
  for select to authenticated using (public.app_rank() >= 2);

-- ---------------------------------------------------------------------------
-- 8. Access rights on the NEW objects (signed-out visitors get nothing)
-- ---------------------------------------------------------------------------
revoke all on public.profiles          from public, anon, authenticated;
revoke all on public.exception_remarks from public, anon, authenticated;
revoke all on public.exception_audit   from public, anon, authenticated;
grant select on public.profiles          to authenticated;
grant select on public.exception_remarks to authenticated;
grant select on public.exception_audit   to authenticated;

-- Functions: signed-in users only. Internal helpers: nobody from the browser.
revoke all on function public.role_rank(text)          from public, anon;
revoke all on function public.role_label(text)         from public, anon;
revoke all on function public.app_role()               from public, anon;
revoke all on function public.app_rank()               from public, anon;
revoke all on function public.app_can_operate()        from public, anon;
revoke all on function public.app_actor()              from public, anon, authenticated;
revoke all on function public.my_access()              from public, anon;
revoke all on function public._audit(uuid, text, public.profiles, text, text, text) from public, anon, authenticated;
revoke all on function public._issue_type_ok(text, text) from public, anon, authenticated;
revoke all on function public.create_exception(text, text, text, text, text, integer, text) from public, anon;
revoke all on function public.start_exception(uuid)               from public, anon;
revoke all on function public.request_closure(uuid, text)         from public, anon;
revoke all on function public.decline_closure(uuid, text)         from public, anon;
revoke all on function public.resolve_exception(uuid, text)       from public, anon;
revoke all on function public.reopen_exception(uuid, text)        from public, anon;
revoke all on function public.change_priority(uuid, text, text)   from public, anon;
revoke all on function public.add_remark(uuid, text, text)        from public, anon;

grant execute on function public.role_rank(text)          to authenticated;
grant execute on function public.role_label(text)         to authenticated;
grant execute on function public.app_role()               to authenticated;
grant execute on function public.app_rank()               to authenticated;
grant execute on function public.app_can_operate()        to authenticated;
grant execute on function public.my_access()              to authenticated;
grant execute on function public.create_exception(text, text, text, text, text, integer, text) to authenticated;
grant execute on function public.start_exception(uuid)               to authenticated;
grant execute on function public.request_closure(uuid, text)         to authenticated;
grant execute on function public.decline_closure(uuid, text)         to authenticated;
grant execute on function public.resolve_exception(uuid, text)       to authenticated;
grant execute on function public.reopen_exception(uuid, text)        to authenticated;
grant execute on function public.change_priority(uuid, text, text)   to authenticated;
grant execute on function public.add_remark(uuid, text, text)        to authenticated;

-- IST shift control helpers: internal (not callable from the browser); shift_clock() is read-only time for signed-in users.
revoke all on function public.ist_shift(timestamptz)               from public, anon, authenticated;
revoke all on function public.ist_operational_date(timestamptz)    from public, anon, authenticated;
revoke all on function public._shift_start_text(text)              from public, anon, authenticated;
revoke all on function public._check_live_shift(text, timestamptz) from public, anon, authenticated;
revoke all on function public.shift_clock()                        from public, anon;
grant  execute on function public.shift_clock()                    to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Link the 8 FICTIONAL test accounts to their roles.
--    Create the accounts in Supabase first (Authentication > Users), then run this
--    file again (or just this block). It does nothing for an account that does not
--    exist yet, and never changes a profile that is already linked.
-- ---------------------------------------------------------------------------
insert into public.profiles (user_id, full_name, role, can_operate)
select u.id, v.full_name, v.role, v.can_operate
from (values
  ('overman1@example.com', 'Test Overman One',          'overman',         false),
  ('overman2@example.com', 'Test Overman Two',          'overman',         false),
  ('sic1@example.com',     'Test Shift In-Charge One',  'shift_incharge',  false),
  ('sic2@example.com',     'Test Shift In-Charge Two',  'shift_incharge',  false),
  ('manager1@example.com', 'Test Manager One',          'manager',         false),
  ('manager2@example.com', 'Test Manager Two (operate)','manager',         true),
  ('po1@example.com',      'Test Project Officer One',  'project_officer', false),
  ('gm1@example.com',      'Test General Manager One',  'general_manager', false)
) as v(email, full_name, role, can_operate)
join auth.users u on lower(u.email) = v.email
on conflict (user_id) do nothing;

commit;

-- Quick check after running (read-only). You should see your linked accounts:
select p.full_name, p.role, p.can_operate, p.active, u.email
from public.profiles p join auth.users u on u.id = p.user_id
order by public.role_rank(p.role), p.full_name;
