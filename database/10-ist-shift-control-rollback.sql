-- =============================================================================
-- 10-ist-shift-control-rollback.sql
-- Undoes 10-ist-shift-control.sql: puts back the create_exception from 04 (any
-- shift may be chosen again) and removes the 5 helper functions. No table, row,
-- policy or other function is touched. Records created while 10 was active keep
-- their shift. Safe to run twice.
-- =============================================================================
begin;

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

revoke all on function public.create_exception(text, text, text, text, text, integer, text) from public, anon;
grant  execute on function public.create_exception(text, text, text, text, text, integer, text) to authenticated;

drop function if exists public.shift_clock();
drop function if exists public._check_live_shift(text, timestamptz);
drop function if exists public._shift_start_text(text);
drop function if exists public.ist_operational_date(timestamptz);
drop function if exists public.ist_shift(timestamptz);

commit;
