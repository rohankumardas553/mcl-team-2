-- =============================================================================
-- 10-ist-shift-control-verify.sql  -  ONE verification table for the state AFTER 10 (read-only).
-- It changes nothing. Every line must say OK. Run it after 10-ist-shift-control.sql (and after 07).
-- This file replaces the old 07 line "A06 ... ONLY the 8 action functions, my_access and app_rank":
-- after 10 the exact list is those 10 plus shift_clock(), and this file checks that list.
-- =============================================================================
-- Each check is run safely: if something it needs is missing (for example 10 was not run yet) it reports PROBLEM
-- instead of stopping with an error.
create or replace function pg_temp.ist_check(q text) returns boolean language plpgsql as $f$
declare r boolean;
begin execute q into r; return coalesce(r, false);
exception when others then return false; end
$f$;

select v.n as no, v.name as check_name, case when pg_temp.ist_check(v.q) then 'OK' else 'PROBLEM' end as result
from (values
  (1, 'Signed-out visitors (anon) can run NO function in the public schema', $q$select not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'execute'))$q$),
  (2, 'Signed-in users can run EXACTLY: the 8 action functions, my_access, app_rank and shift_clock', $q$select (select coalesce(array_agg(p.proname::text order by p.proname::text), '{}'::text[]) from pg_proc p where p.pronamespace = 'public'::regnamespace and has_function_privilege('authenticated', p.oid, 'execute')) = array['add_remark','app_rank','change_priority','create_exception','decline_closure','my_access','reopen_exception','request_closure','resolve_exception','shift_clock','start_exception']$q$),
  (3, 'The 4 IST helper functions exist and are NOT callable by signed-in or signed-out users', $q$select count(*) = 4 and not bool_or(has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('ist_shift','ist_operational_date','_shift_start_text','_check_live_shift')$q$),
  (4, 'shift_clock() is SECURITY DEFINER with a pinned search_path', $q$select count(*) = 1 and bool_and(p.prosecdef and exists (select 1 from unnest(p.proconfig) x where x like 'search_path=%')) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'shift_clock'$q$),
  (5, 'create_exception is SECURITY DEFINER, pinned search_path, and contains the IST shift check', $q$select count(*) = 1 and bool_and(p.prosecdef and exists (select 1 from unnest(p.proconfig) x where x like 'search_path=%') and pg_get_functiondef(p.oid) like '%_check_live_shift(p_shift, now())%') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'create_exception'$q$),
  (6, 'create_exception still limits creation to Overman and Shift In-Charge (no role bypass)', $q$select pg_get_functiondef(p.oid) like '%v_a.role not in (''overman'', ''shift_incharge'')%' from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'create_exception'$q$),
  (7, 'Row level security is ON for all 4 tables', $q$select count(*) = 4 and bool_and(c.relrowsecurity) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('shift_exceptions','profiles','exception_remarks','exception_audit')$q$),
  (8, 'Signed-out visitors (anon) have NO privilege on the 4 tables', $q$select not exists (select 1 from information_schema.role_table_grants g where g.grantee = 'anon' and g.table_schema = 'public' and g.table_name in ('shift_exceptions','profiles','exception_remarks','exception_audit'))$q$),
  (9, 'Signed-in users have SELECT only on the 4 tables (no direct insert, update or delete)', $q$select count(*) filter (where privilege_type = 'SELECT') = 4 and count(*) filter (where privilege_type <> 'SELECT') = 0 from information_schema.role_table_grants g where g.grantee = 'authenticated' and g.table_schema = 'public' and g.table_name in ('shift_exceptions','profiles','exception_remarks','exception_audit')$q$),
  (10, 'Shift rules: 04:59 Night, 05:00 First, 12:59 First, 13:00 Second, 20:59 Second, 21:00 Night, 00:00 Night, 02:30 Night', $q$select public.ist_shift('2026-10-01 04:59+05:30') = 'Night' and public.ist_shift('2026-10-01 05:00+05:30') = 'First' and public.ist_shift('2026-10-01 12:59+05:30') = 'First' and public.ist_shift('2026-10-01 13:00+05:30') = 'Second' and public.ist_shift('2026-10-01 20:59+05:30') = 'Second' and public.ist_shift('2026-10-01 21:00+05:30') = 'Night' and public.ist_shift('2026-10-02 00:00+05:30') = 'Night' and public.ist_shift('2026-10-02 02:30+05:30') = 'Night'$q$),
  (11, 'Operational Day: 04:59 IST belongs to the previous day, 05:00 starts a new day, 02:30 belongs to the day before', $q$select public.ist_operational_date('2026-10-01 04:59+05:30') = date '2026-09-30' and public.ist_operational_date('2026-10-01 05:00+05:30') = date '2026-10-01' and public.ist_operational_date('2026-10-02 02:30+05:30') = date '2026-10-01'$q$),
  (12, 'The shift guard accepts the shift that is running now (it raises an error for any other shift)', $q$select count(*) = 1 from (select public._check_live_shift(public.ist_shift(now()), now())) x$q$)
) as v(n, name, q)
order by v.n;

-- Information only: the database clock as the pages see it (shows an error if 10 has not been run).
select now() as database_time, public.ist_shift(now()) as current_shift, public.ist_operational_date(now()) as operational_day;
