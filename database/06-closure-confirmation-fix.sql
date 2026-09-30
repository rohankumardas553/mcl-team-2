-- MineShift Command - 06 Closure confirmation fix (maker-checker).
--
-- FOR A DATABASE THAT ALREADY RAN 04-auth-foundation.sql. (A fresh setup does not need this
-- file: the same rule is already inside 04-auth-foundation.sql.)
--
-- Rule: the person who requested a closure can NOT decline it or confirm it (Resolve) themselves.
-- Another authorised person must do it: another Shift In-Charge, or a Manager with can_operate.
-- An Overman still cannot decline or resolve. If there is NO closure request, a Shift In-Charge
-- can still resolve directly with the resolution note (5+ characters).
--
-- This file ONLY replaces two functions: decline_closure and resolve_exception.
-- It changes no table and no data. Safe to run more than once.

begin;

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

-- Same access as before: signed-in users only.
revoke all on function public.decline_closure(uuid, text)   from public, anon;
revoke all on function public.resolve_exception(uuid, text) from public, anon;
grant execute on function public.decline_closure(uuid, text)   to authenticated;
grant execute on function public.resolve_exception(uuid, text) to authenticated;

commit;

-- Check (read-only): both functions should show the new message text.
select p.proname,
       position('You cannot confirm or decline your own closure request' in pg_get_functiondef(p.oid)) > 0 as has_new_rule
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('decline_closure', 'resolve_exception')
order by p.proname;
