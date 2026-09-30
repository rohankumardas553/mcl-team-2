-- MineShift Command - 08 Management reopen ROLLBACK.
--
-- Restores the PREVIOUS reopen rule: a Resolved exception may be reopened by a Shift In-Charge, or by
-- a Manager who has can_operate = true. A Manager without can_operate, a Project Officer, a General
-- Manager and an Overman can NOT reopen again.
--
-- It replaces ONLY the function reopen_exception. It changes no table, no row, no policy, no profile,
-- no audit line and no remark, and it does not touch the lockdown (signed-out visitors keep no access).
-- Records that were already reopened under the new rule stay reopened. Safe to run more than once.

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
  if not (v_a.role = 'shift_incharge' or (v_a.role = 'manager' and v_a.can_operate)) then
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
