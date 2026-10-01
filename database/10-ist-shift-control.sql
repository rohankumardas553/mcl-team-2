-- =============================================================================
-- 10-ist-shift-control.sql
-- IST shift control for NEW exceptions.
--   * First  = 05:00 (inclusive) to 13:00 (exclusive) IST
--   * Second = 13:00 (inclusive) to 21:00 (exclusive) IST
--   * Night  = 21:00 (inclusive) to 05:00 (exclusive) IST the next morning
--   * Operational Day = 05:00 IST on date D up to 04:59:59 IST on D+1.
-- A new exception always belongs to the shift that is running on the DATABASE
-- clock when it is saved. The shift sent by the page must match it, so nobody can
-- save a future or past shift by editing the page or the request.
--
-- Safe: additive. It adds 5 small functions and REPLACES create_exception with the
-- same signature (same arguments, same rules, one extra shift check). It does not
-- touch any table, any row, any policy, any grant on a table, or any other
-- function. Existing records, their created_at and their shift values are NOT
-- changed. Safe to run twice. Rollback: 10-ist-shift-control-rollback.sql.
-- For a database that already ran 04 and 07 (and 08, 09 if wanted).
-- =============================================================================
begin;

do $$ begin
  if to_regprocedure('public.create_exception(text,text,text,text,text,integer,text)') is null then
    raise exception 'create_exception does not exist. Run 04-auth-foundation.sql first.';
  end if;
end $$;

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

-- Grants: explicit. Only signed-in users may run create_exception (unchanged) and
-- shift_clock (new, read-only). The helpers are not callable from the browser.
revoke all on function public.ist_shift(timestamptz)               from public, anon, authenticated;
revoke all on function public.ist_operational_date(timestamptz)    from public, anon, authenticated;
revoke all on function public._shift_start_text(text)              from public, anon, authenticated;
revoke all on function public._check_live_shift(text, timestamptz) from public, anon, authenticated;
revoke all on function public.shift_clock()                        from public, anon;
grant  execute on function public.shift_clock()                    to authenticated;
revoke all on function public.create_exception(text, text, text, text, text, integer, text) from public, anon;
grant  execute on function public.create_exception(text, text, text, text, text, integer, text) to authenticated;

commit;

-- Quick check (read-only). Expected: First, Night (previous day), Second, Night.
select public.ist_shift('2026-10-01 05:00+05:30') as at_0500,
       public.ist_shift('2026-10-01 04:59+05:30') as at_0459,
       public.ist_shift('2026-10-01 13:00+05:30') as at_1300,
       public.ist_shift('2026-10-01 21:00+05:30') as at_2100,
       public.ist_operational_date('2026-10-02 02:30+05:30') as op_day_at_0230;
