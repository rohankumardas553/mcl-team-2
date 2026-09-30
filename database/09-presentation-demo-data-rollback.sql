-- =============================================================================
-- MineShift Command - 09 ROLLBACK: remove the PRESENTATION DEMO DATA only
-- =============================================================================
-- Removes ONLY what 09-presentation-demo-data.sql created:
--   * every shift exception whose description contains the exact marker
--       [DEMO-2026-PRESENTATION]
--   * the audit lines and remarks that belong to those exceptions
--     (including any lines added to a demo exception during the workshop, because they
--      belong to that exception)
-- It never touches an exception without the marker, nor that exception's audit lines or
-- remarks, nor any table, column, policy, grant, function, profile or account.
--
-- Audit lines and remarks are append-only (a trigger blocks delete). This script switches
-- those two triggers off INSIDE the transaction, deletes only the demo lines, and switches
-- them on again. If anything goes wrong the whole transaction is rolled back, so the triggers
-- are never left switched off. It must be run by the table owner (the Supabase SQL Editor
-- user). It is safe to run twice: the second run finds nothing to delete.
-- =============================================================================

begin;

create temp table demo_ids on commit drop as
select id from public.shift_exceptions
where position('[DEMO-2026-PRESENTATION]' in description) > 0;

do $$
declare n int;
begin
  select count(*) into n from demo_ids;
  raise notice 'Demo exceptions found: %', n;
end $$;

alter table public.exception_audit   disable trigger exception_audit_no_change;
alter table public.exception_remarks disable trigger exception_remarks_no_change;

delete from public.exception_audit   where exception_id in (select id from demo_ids);
delete from public.exception_remarks where exception_id in (select id from demo_ids);

alter table public.exception_audit   enable trigger exception_audit_no_change;
alter table public.exception_remarks enable trigger exception_remarks_no_change;

delete from public.shift_exceptions where id in (select id from demo_ids);

-- Checks: nothing of the demo is left, and the append-only triggers are back on.
do $$
declare n int;
begin
  select count(*) into n from public.shift_exceptions where position('[DEMO-2026-PRESENTATION]' in description) > 0;
  if n > 0 then raise exception 'ROLLBACK CHECK FAILED: % demo exceptions are still there', n; end if;
  select count(*) into n from public.exception_audit   a where a.exception_id in (select id from demo_ids);
  if n > 0 then raise exception 'ROLLBACK CHECK FAILED: % demo audit lines are still there', n; end if;
  select count(*) into n from public.exception_remarks r where r.exception_id in (select id from demo_ids);
  if n > 0 then raise exception 'ROLLBACK CHECK FAILED: % demo remarks are still there', n; end if;
  select count(*) into n from pg_trigger
   where tgname in ('exception_audit_no_change', 'exception_remarks_no_change') and tgenabled <> 'O' and not tgisinternal;
  if n > 0 then raise exception 'ROLLBACK CHECK FAILED: an append-only trigger is still switched off'; end if;
end $$;

commit;

-- Read-only result: should show 0 demo exceptions, and your other data unchanged.
select 'demo exceptions left' as item,
       count(*) filter (where position('[DEMO-2026-PRESENTATION]' in description) > 0)::text as value
  from public.shift_exceptions
union all
select 'all other exceptions', count(*) filter (where position('[DEMO-2026-PRESENTATION]' in description) = 0)::text
  from public.shift_exceptions
union all
select 'audit lines (all)', count(*)::text from public.exception_audit
union all
select 'remarks (all)', count(*)::text from public.exception_remarks;
