-- ###########################################################################
-- #   EMERGENCY ROLLBACK - THIS RE-OPENS PUBLIC ACCESS                      #
-- ###########################################################################
--
-- USE ONLY IF the site became unusable after 07-lockdown.sql and you cannot fix it another way.
--
-- WHAT IT DOES
--   Puts back the OLD open rules from 01-setup.sql on shift_exceptions:
--     * the three policies "anyone can read", "anyone can add", "anyone can update"
--     * select, insert and update rights for signed-out visitors (anon) and signed-in users
--   After it runs, anyone with the link can read and change shift_exceptions again, exactly as
--   before the lockdown. The database protection triggers from 04 still limit what a direct
--   change can do (for example: no forged "who did it" fields, no editing of core fields).
--
-- WHAT IT DOES NOT DO
--   * it does not drop or empty any table, column, remark, audit line or record
--   * it does not touch profiles, roles, priorities or any record
--   * it does not undo the maker-checker rule or any role permission
--   * it does not open profiles, exception_remarks or exception_audit to signed-out visitors
--   * it does not remove the value checks added by 07-lockdown.sql (they only refuse invalid values)
--   The action functions and the login pages keep working while this is in place.
--
-- AFTER THE EMERGENCY: find and fix the problem, then run 07-lockdown.sql again
-- (it is safe to run more than once).
--
-- It runs in ONE transaction. Safe to run once in an emergency (and safe to run again).

begin;

do $$
begin
  if to_regclass('public.shift_exceptions') is null then
    raise exception 'Table shift_exceptions was not found. Nothing was changed.';
  end if;
end $$;

alter table public.shift_exceptions enable row level security;

drop policy if exists "anyone can read"   on public.shift_exceptions;
drop policy if exists "anyone can add"    on public.shift_exceptions;
drop policy if exists "anyone can update" on public.shift_exceptions;

create policy "anyone can read" on public.shift_exceptions
  for select to anon, authenticated using (true);
create policy "anyone can add" on public.shift_exceptions
  for insert to anon, authenticated with check (true);
create policy "anyone can update" on public.shift_exceptions
  for update to anon, authenticated using (true) with check (true);

grant select, insert, update on public.shift_exceptions to anon, authenticated;

commit;

-- ---------------------------------------------------------------------------
-- VERIFICATION (read-only). One result table.
-- Expected after the rollback: shift_exceptions shows the 3 old policies plus "role read exceptions";
-- anon can select, insert and update shift_exceptions; anon still has NO access to profiles,
-- exception_remarks or exception_audit; row counts match your backup.
-- ---------------------------------------------------------------------------
select section, item, detail from (
  select 'A' as section, policyname as item, cmd || ' to ' || roles::text as detail
    from pg_policies
   where schemaname = 'public' and tablename = 'shift_exceptions'
  union all
  select 'B', r.role_name || '  on  ' || t.t,
         'select=' || has_table_privilege(r.role_name, 'public.' || t.t, 'select')
         || '  insert=' || has_table_privilege(r.role_name, 'public.' || t.t, 'insert')
         || '  update=' || has_table_privilege(r.role_name, 'public.' || t.t, 'update')
         || '  delete=' || has_table_privilege(r.role_name, 'public.' || t.t, 'delete')
    from (values ('anon'), ('authenticated')) r(role_name),
         (values ('shift_exceptions'), ('profiles'), ('exception_remarks'), ('exception_audit')) t(t)
  union all
  select 'C', 'shift_exceptions', count(*)::text from public.shift_exceptions
  union all
  select 'C', 'exception_remarks', count(*)::text from public.exception_remarks
  union all
  select 'C', 'exception_audit', count(*)::text from public.exception_audit
  union all
  select 'C', 'profiles', count(*)::text from public.profiles
) v
order by section, item;
