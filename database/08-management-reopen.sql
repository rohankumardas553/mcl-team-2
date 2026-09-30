-- MineShift Command - 08 Management reopen (authority-model correction).
--
-- FOR THE LIVE DATABASE, WHICH HAS ALREADY RUN 04, 05, 06 AND 07-lockdown.sql.
-- (A fresh setup does not need this file: the same rule is already inside 04-auth-foundation.sql.)
--
-- NEW RULE: a Resolved exception may be reopened by a Shift In-Charge, a Manager, a Project Officer
-- or a General Manager. A Manager does NOT need can_operate for this. An Overman / Supervisor still
-- cannot reopen. Reason: reopening after an inspection or review is a supervisory or managerial
-- intervention, not routine closure. Any of these roles may reopen regardless of who resolved it;
-- the mandatory reason (5+ characters) and the immutable audit line give the accountability.
--
-- Nothing else changes: Start, Decline and Resolve keep their rules; maker-checker and the priority
-- rank lock are untouched.
--
-- WHAT THIS FILE DOES: it replaces ONLY the function reopen_exception and states its access again
-- (signed-in users only, nothing for signed-out visitors). It changes no table, no row, no policy
-- and does not weaken the lockdown. Safe to run more than once.
--
-- TO UNDO: run 08-management-reopen-rollback.sql (restores: Shift In-Charge, or a Manager with
-- can_operate).

begin;

do $$
begin
  if to_regprocedure('public.reopen_exception(uuid,text)') is null
     or to_regprocedure('public.app_actor()') is null then
    raise exception 'Please run 04-auth-foundation.sql first. Nothing was changed.';
  end if;
end $$;

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

-- Same access as before: signed-in users only. Signed-out visitors (anon) get nothing.
revoke all on function public.reopen_exception(uuid, text) from public, anon;
grant execute on function public.reopen_exception(uuid, text) to authenticated;

commit;

-- Check (read-only): one result table.
select 'reopen_exception is currently set to'                       as item,
       case when pg_get_functiondef(p.oid) like '%''project_officer'', ''general_manager''%' then 'NEW rule: Shift In-Charge, Manager, Project Officer, General Manager' else 'PREVIOUS rule: Shift In-Charge, or Manager with can_operate' end as detail
from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'reopen_exception'
union all
select 'signed-out visitors can run reopen_exception (must be false)',
       has_function_privilege('anon', 'public.reopen_exception(uuid,text)', 'execute')::text
union all
select 'signed-in users can run reopen_exception (must be true)',
       has_function_privilege('authenticated', 'public.reopen_exception(uuid,text)', 'execute')::text
union all
select 'signed-out visitors can run ANY function in public (must be false)',
       exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                and has_function_privilege('anon', p.oid, 'execute'))::text;
