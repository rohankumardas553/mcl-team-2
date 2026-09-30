-- MineShift Command - 07 FINAL SECURITY LOCKDOWN.
--
-- AFTER THIS FILE RUNS:
--   * signed-out visitors can read and change NOTHING
--   * every use of the tool needs an individual login
--   * signed-in users can only READ, and only what their role allows (row level security)
--   * every change goes through the 8 database functions (create_exception, start_exception,
--     request_closure, decline_closure, resolve_exception, reopen_exception, change_priority,
--     add_remark) - there is no direct insert, update or delete for anybody in the browser
--   * roles, the priority rank lock and the maker-checker rule work exactly as before
--
-- WHEN TO RUN IT: only after the login pages are LIVE on the main branch (Vercel production) and
-- every role has passed the preview tests. The OLD public pages stop working the moment this runs.
--
-- ORDER: 04-auth-foundation.sql, 05-location-renames.sql and 06-closure-confirmation-fix.sql must
-- already have been run. This file checks that and stops with a clear message if not.
--
-- SAFE: it deletes nothing, updates no record, drops no table and does not touch remarks, audit
-- or profiles data. It only removes the old open access rules and changes who may do what.
-- It is safe to run more than once. It runs in ONE transaction: if any step fails, nothing changes.
--
-- IF THE SITE BECOMES UNUSABLE: run 07-rollback.sql (EMERGENCY ONLY - it re-opens public access).
--
-- Do NOT run this file until the Data Keeper has read the notes in CLAUDE.md ("Final lockdown").

begin;

-- ---------------------------------------------------------------------------
-- 0. Safety checks: refuse to run if the pieces this lockdown relies on are missing,
--    or if it would lock everybody out.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.exception_remarks') is null
     or to_regclass('public.exception_audit') is null
     or to_regprocedure('public.create_exception(text,text,text,text,text,integer,text)') is null
     or to_regprocedure('public.my_access()') is null
     or to_regprocedure('public.app_rank()') is null then
    raise exception 'Please run 04-auth-foundation.sql first. Nothing was changed.';
  end if;

  if position('You cannot confirm or decline your own closure request'
              in pg_get_functiondef('public.resolve_exception(uuid,text)'::regprocedure)) = 0
     or position('You cannot confirm or decline your own closure request'
              in pg_get_functiondef('public.decline_closure(uuid,text)'::regprocedure)) = 0 then
    raise exception 'Please run 06-closure-confirmation-fix.sql first. Nothing was changed.';
  end if;

  if not exists (select 1 from public.profiles where active) then
    raise exception 'No active profile exists, so everybody would be locked out. Link the accounts first (04-auth-foundation.sql). Nothing was changed.';
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'shift_exceptions'
                 and policyname = 'role read exceptions') then
    raise exception 'The role-based read rule "role read exceptions" is missing (04-auth-foundation.sql). Nothing was changed.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Row level security stays ON for all four tables.
-- ---------------------------------------------------------------------------
alter table public.shift_exceptions  enable row level security;
alter table public.profiles          enable row level security;
alter table public.exception_remarks enable row level security;
alter table public.exception_audit   enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Remove the OLD open / public rules on shift_exceptions
--    (from 01-setup.sql: "anyone can read", "anyone can add", "anyone can update").
--    Any other leftover rule on this table that is not our role-based read rule is removed
--    too, because it would silently keep public access open. The names removed are shown
--    in the messages. The role-based rule "role read exceptions" is kept.
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'shift_exceptions'
      and policyname <> 'role read exceptions'
  loop
    execute format('drop policy %I on public.shift_exceptions', r.policyname);
    raise notice 'Removed old policy on shift_exceptions: %', r.policyname;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Table access.
--    Signed-out visitors (anon): nothing.
--    Signed-in users (authenticated): SELECT only (row level security decides which rows).
--    Nobody in the browser can insert, update, delete or truncate.
-- ---------------------------------------------------------------------------
revoke all on public.shift_exceptions  from public, anon, authenticated;
revoke all on public.profiles          from public, anon, authenticated;
revoke all on public.exception_remarks from public, anon, authenticated;
revoke all on public.exception_audit   from public, anon, authenticated;

grant select on public.shift_exceptions  to authenticated;
grant select on public.profiles          to authenticated;   -- own row only (row level security)
grant select on public.exception_remarks to authenticated;
grant select on public.exception_audit   to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Function access.
--    Signed-out visitors: no function at all.
--    Signed-in users: the 8 action functions, my_access(), and app_rank() (the read rules
--    call it). Everything else is internal and is not exposed.
--    The action functions stay SECURITY DEFINER with a pinned search_path (not touched here).
-- ---------------------------------------------------------------------------
do $$
declare
  s text;
  callable text[] := array[
    'public.create_exception(text,text,text,text,text,integer,text)',
    'public.start_exception(uuid)',
    'public.request_closure(uuid,text)',
    'public.decline_closure(uuid,text)',
    'public.resolve_exception(uuid,text)',
    'public.reopen_exception(uuid,text)',
    'public.change_priority(uuid,text,text)',
    'public.add_remark(uuid,text,text)',
    'public.my_access()',
    'public.app_rank()'];
  internal text[] := array[
    'public.role_rank(text)',
    'public.role_label(text)',
    'public.app_role()',
    'public.app_can_operate()',
    'public.app_actor()',
    'public._audit(uuid,text,public.profiles,text,text,text)',
    'public._issue_type_ok(text,text)',
    'public.block_history_change()',
    'public.exceptions_before_insert()',
    'public.exceptions_before_change()',
    'public.exceptions_audit_direct()'];
begin
  foreach s in array callable loop
    if to_regprocedure(s) is not null then
      execute format('revoke all on function %s from public, anon', s);
      execute format('grant execute on function %s to authenticated', s);
    end if;
  end loop;
  foreach s in array internal loop
    if to_regprocedure(s) is not null then
      execute format('revoke all on function %s from public, anon, authenticated', s);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Value checks (added as NOT VALID: they apply to NEW and CHANGED rows only; old rows are
--    not scanned or rewritten). A check is added only if no existing row would break it,
--    so it can never block a later Start / Resolve on an old record. Safe to run twice.
-- ---------------------------------------------------------------------------
do $$
declare
  c record;
  bad bigint;
begin
  for c in
    select * from (values
      ('shift_exceptions_status_chk',    'status in (''Open'', ''In progress'', ''Resolved'')'),
      ('shift_exceptions_shift_chk',     'shift in (''First'', ''Second'', ''Night'')'),
      ('shift_exceptions_category_chk',  'category in (''Coal Despatch'', ''Dust Suppression'', ''Haul Road'', ''Coal Quality'')'),
      ('shift_exceptions_urgency_chk',   'urgency in (''Low'', ''Medium'', ''High'')'),
      ('shift_exceptions_reported_chk',  'reported_priority in (''Low'', ''Medium'', ''High'')'),
      ('shift_exceptions_current_chk',   'current_priority in (''Low'', ''Medium'', ''High'')'),
      ('shift_exceptions_minutes_chk',   'impact_minutes between 0 and 1440')
    ) as v(name, expr)
  loop
    if exists (select 1 from pg_constraint
               where conrelid = 'public.shift_exceptions'::regclass and conname = c.name) then
      continue;
    end if;
    execute format('select count(*) from public.shift_exceptions where not coalesce((%s), true)', c.expr) into bad;
    if bad = 0 then
      execute format('alter table public.shift_exceptions add constraint %I check (%s) not valid', c.name, c.expr);
      raise notice 'Added check (NOT VALID): %', c.name;
    else
      raise notice 'Skipped check % because % existing row(s) would break it. Nothing was changed for them.', c.name, bad;
    end if;
  end loop;
end $$;

commit;

-- ===========================================================================
-- VERIFICATION (read-only). Run this last query and read the result.
-- It is ONE result table. Section "A" must show OK on every line.
--   A = summary checks          B = policies still on the tables
--   C = who can do what on the tables      D = who can run which function
--   E = value checks            F = row counts (compare with your backup)
-- What you must see:
--   anon (signed-out): C all false, D all false.
--   authenticated (signed in): C true ONLY for select, D true ONLY for the 8 action functions,
--   my_access and app_rank.
-- ===========================================================================
with
tbls(t) as (values ('shift_exceptions'), ('profiles'), ('exception_remarks'), ('exception_audit')),
privs(p) as (values ('select'), ('insert'), ('update'), ('delete'), ('truncate'), ('references'), ('trigger')),
checks(sort, check_name, ok) as (
  select 1, 'Row level security is ON for all 4 tables',
         (select count(*) = 4 from pg_class c
           where c.oid in ('public.shift_exceptions'::regclass, 'public.profiles'::regclass,
                           'public.exception_remarks'::regclass, 'public.exception_audit'::regclass)
             and c.relrowsecurity)
  union all
  select 2, 'shift_exceptions has ONLY the role-based read rule (no old public rules)',
         (select count(*) = 1 and bool_and(policyname = 'role read exceptions')
            from pg_policies where schemaname = 'public' and tablename = 'shift_exceptions')
  union all
  select 3, 'Signed-out visitors (anon) have NO access to any of the 4 tables',
         not exists (select 1 from tbls, privs where has_table_privilege('anon', 'public.' || t, p))
         and not exists (select 1 from tbls
                          where has_any_column_privilege('anon', 'public.' || t, 'select')
                             or has_any_column_privilege('anon', 'public.' || t, 'insert')
                             or has_any_column_privilege('anon', 'public.' || t, 'update'))
  union all
  select 4, 'Signed-in users (authenticated) can ONLY SELECT on the 4 tables',
         (select bool_and(has_table_privilege('authenticated', 'public.' || t, 'select')) from tbls)
         and not exists (select 1 from tbls, privs
                          where p <> 'select' and has_table_privilege('authenticated', 'public.' || t, p))
         and not exists (select 1 from tbls
                          where has_any_column_privilege('authenticated', 'public.' || t, 'insert')
                             or has_any_column_privilege('authenticated', 'public.' || t, 'update'))
  union all
  select 5, 'Signed-out visitors (anon) can run NO function in the public schema',
         not exists (select 1 from pg_proc p
                      where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'execute'))
  union all
  select 6, 'Signed-in users can run ONLY the 8 action functions, my_access and app_rank',
         (select coalesce(array_agg(p.proname::text order by p.proname::text), '{}'::text[]) from pg_proc p
           where p.pronamespace = 'public'::regnamespace and has_function_privilege('authenticated', p.oid, 'execute'))
         = array['add_remark','app_rank','change_priority','create_exception','decline_closure',
                 'my_access','reopen_exception','request_closure','resolve_exception','start_exception']
  union all
  select 7, 'The 8 action functions and my_access are SECURITY DEFINER with a pinned search_path',
         (select count(*) = 9 and bool_and(p.prosecdef and exists (select 1 from unnest(p.proconfig) x where x like 'search_path=%'))
            from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('create_exception','start_exception','request_closure','decline_closure',
                               'resolve_exception','reopen_exception','change_priority','add_remark','my_access'))
  union all
  select 8, 'History is protected: remarks and audit have their append-only triggers',
         (select count(*) >= 4 from pg_trigger t
           where not t.tgisinternal
             and t.tgrelid in ('public.exception_remarks'::regclass, 'public.exception_audit'::regclass))
  union all
  select 9, 'Maker-checker rule is present in resolve_exception and decline_closure',
         position('You cannot confirm or decline your own closure request'
                  in pg_get_functiondef('public.resolve_exception(uuid,text)'::regprocedure)) > 0
         and position('You cannot confirm or decline your own closure request'
                  in pg_get_functiondef('public.decline_closure(uuid,text)'::regprocedure)) > 0
)
select section, item, detail from (
  select 'A' as section, lpad(sort::text, 2, '0') || '  ' || check_name as item,
         case when ok then 'OK' else 'PROBLEM' end as detail
    from checks
  union all
  select 'B', tablename || '  -  ' || policyname, cmd || ' to ' || roles::text
    from pg_policies
   where schemaname = 'public'
     and tablename in ('shift_exceptions', 'profiles', 'exception_remarks', 'exception_audit')
  union all
  select 'C', r.role_name || '  on  ' || t.t,
         'select=' || has_table_privilege(r.role_name, 'public.' || t.t, 'select')
         || '  insert=' || has_table_privilege(r.role_name, 'public.' || t.t, 'insert')
         || '  update=' || has_table_privilege(r.role_name, 'public.' || t.t, 'update')
         || '  delete=' || has_table_privilege(r.role_name, 'public.' || t.t, 'delete')
         || '  truncate=' || has_table_privilege(r.role_name, 'public.' || t.t, 'truncate')
    from (values ('anon'), ('authenticated')) r(role_name),
         (values ('shift_exceptions'), ('profiles'), ('exception_remarks'), ('exception_audit')) t(t)
  union all
  select 'D', p.proname,
         'signed-out can run=' || has_function_privilege('anon', p.oid, 'execute')
         || '   signed-in can run=' || has_function_privilege('authenticated', p.oid, 'execute')
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
  union all
  select 'E', c.conname,
         case when c.convalidated then 'validated' else 'not valid (applies to new and changed rows only)' end
    from pg_constraint c
   where c.conrelid = 'public.shift_exceptions'::regclass and c.contype = 'c'
  union all
  select 'F', 'shift_exceptions', count(*)::text from public.shift_exceptions
  union all
  select 'F', 'exception_remarks', count(*)::text from public.exception_remarks
  union all
  select 'F', 'exception_audit', count(*)::text from public.exception_audit
  union all
  select 'F', 'profiles', count(*)::text from public.profiles
) v
order by section, item;
