-- MineShift Command - 13 ACCOUNT ADMINISTRATION (Data Keeper: send password reset, switch an account on / off).
--
-- WHAT IT ADDS (all new; nothing existing is changed):
--   * a yes / no column profiles.can_administer (default NO for everybody). It is NOT a new role:
--     every person keeps their role and every existing permission rule is unchanged.
--   * three small functions that ONLY an active person with can_administer = yes can run:
--       admin_list_accounts()                 - name, role, active, e-mail, last sign-in of every account
--       admin_log_recovery(user)              - writes a log line and returns the account e-mail, so the page can
--                                               ask Supabase to SEND a password-reset e-mail (nobody sets another
--                                               person's password; no password is ever seen or stored)
--       admin_set_active(user, true / false)  - switch an account on / off (cannot switch off yourself)
--   * my_admin() - tells the page whether to show the Account administration panel
--   * account_admin_log - append-only record of every administrator action (read it in the SQL Editor)
--
-- No service_role key is needed anywhere. Signed-out visitors can run none of these functions.
--
-- WHEN: after 04 and 07. Safe to run twice. One transaction.
-- UNDO: 13-account-admin-rollback.sql (keeps the log and every profile).
--
-- AFTER IT RUNS you must choose who the Data Keeper account is, with ONE line (replace the text in capitals
-- with the Data Keeper's sign-in e-mail; do not save the real address in any file):
--
--   update public.profiles set can_administer = true
--    where user_id = (select id from auth.users where email = 'PUT-THE-DATA-KEEPER-EMAIL-HERE');
--
-- Then run the verification table at the very end (the last query of this file can be run again on its own).

begin;

do $$
begin
  if to_regclass('public.profiles') is null or to_regprocedure('public.app_actor()') is null
     or to_regprocedure('public.block_history_change()') is null then
    raise exception 'Please run 04-auth-foundation.sql first. Nothing was changed.';
  end if;
end $$;

alter table public.profiles add column if not exists can_administer boolean not null default false;

-- Who did what to which account (append-only; no browser access at all).
create table if not exists public.account_admin_log (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  actor_id    uuid,
  actor_name  text,
  target_user uuid,
  target_name text,
  action      text not null check (action in ('recovery_requested', 'switched_off', 'switched_on')),
  note        text
);
alter table public.account_admin_log enable row level security;
revoke all on public.account_admin_log from public, anon, authenticated;
drop trigger if exists account_admin_log_no_change on public.account_admin_log;
create trigger account_admin_log_no_change before update or delete on public.account_admin_log
  for each row execute function public.block_history_change();
drop trigger if exists account_admin_log_no_truncate on public.account_admin_log;
create trigger account_admin_log_no_truncate before truncate on public.account_admin_log
  for each statement execute function public.block_history_change();

-- Internal: the active administrator making the call, or a clear message.
create or replace function public._admin_actor()
returns public.profiles language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v public.profiles;
begin
  select * into v from public.profiles where user_id = auth.uid() and active and can_administer;
  if v.user_id is null then
    raise exception 'Only the Data Keeper (account administrator) can do this.';
  end if;
  return v;
end
$$;
revoke all on function public._admin_actor() from public, anon, authenticated;

create or replace function public.my_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles where user_id = auth.uid() and active and can_administer)
$$;

create or replace function public.admin_list_accounts()
returns table (user_id uuid, email text, full_name text, role text, active boolean,
               can_operate boolean, can_administer boolean, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_a public.profiles := public._admin_actor();
begin
  return query
    select u.id, u.email::text, p.full_name, p.role, p.active, p.can_operate, p.can_administer, u.last_sign_in_at
      from auth.users u left join public.profiles p on p.user_id = u.id
     order by p.full_name nulls last, u.email;
end
$$;

create or replace function public.admin_log_recovery(p_user uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_a public.profiles := public._admin_actor(); v_email text; v_name text;
begin
  select u.email::text into v_email from auth.users u where u.id = p_user;
  if v_email is null then raise exception 'That account was not found.'; end if;
  select p.full_name into v_name from public.profiles p where p.user_id = p_user;
  insert into public.account_admin_log (actor_id, actor_name, target_user, target_name, action, note)
  values (v_a.user_id, v_a.full_name, p_user, v_name, 'recovery_requested', 'Password reset e-mail requested');
  return v_email;
end
$$;

create or replace function public.admin_set_active(p_user uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_a public.profiles := public._admin_actor(); v_t public.profiles;
begin
  if p_active is null then raise exception 'Please choose on or off.'; end if;
  if p_user = v_a.user_id and not p_active then
    raise exception 'You cannot switch off your own account.'; end if;
  select * into v_t from public.profiles where user_id = p_user;
  if not found then raise exception 'That account has no profile yet.'; end if;
  if v_t.active is not distinct from p_active then
    raise exception 'That account is already switched %.', case when p_active then 'on' else 'off' end; end if;
  update public.profiles set active = p_active where user_id = p_user;
  insert into public.account_admin_log (actor_id, actor_name, target_user, target_name, action)
  values (v_a.user_id, v_a.full_name, p_user, v_t.full_name, case when p_active then 'switched_on' else 'switched_off' end);
end
$$;

revoke all on function public.my_admin()                      from public, anon;
revoke all on function public.admin_list_accounts()           from public, anon;
revoke all on function public.admin_log_recovery(uuid)        from public, anon;
revoke all on function public.admin_set_active(uuid, boolean) from public, anon;
grant execute on function public.my_admin()                      to authenticated;
grant execute on function public.admin_list_accounts()           to authenticated;
grant execute on function public.admin_log_recovery(uuid)        to authenticated;
grant execute on function public.admin_set_active(uuid, boolean) to authenticated;

commit;

-- ONE verification table (every line must say OK, except the last line which just shows a number).
select check_name, result from (
  select 1 as n, 'signed-out visitors cannot run any admin function' as check_name,
         case when not has_function_privilege('anon', 'public.admin_list_accounts()', 'execute')
               and not has_function_privilege('anon', 'public.admin_log_recovery(uuid)', 'execute')
               and not has_function_privilege('anon', 'public.admin_set_active(uuid,boolean)', 'execute')
               and not has_function_privilege('anon', 'public.my_admin()', 'execute')
              then 'OK' else 'PROBLEM' end as result
  union all select 2, 'internal helper _admin_actor is hidden from the browser',
         case when not has_function_privilege('authenticated', 'public._admin_actor()', 'execute')
               and not has_function_privilege('anon', 'public._admin_actor()', 'execute') then 'OK' else 'PROBLEM' end
  union all select 3, 'account_admin_log has row level security and no browser access',
         case when (select relrowsecurity from pg_class where oid = 'public.account_admin_log'::regclass)
               and not has_table_privilege('authenticated', 'public.account_admin_log', 'select')
               and not has_table_privilege('anon', 'public.account_admin_log', 'select') then 'OK' else 'PROBLEM' end
  union all select 4, 'number of administrators right now (run the one-line update from the top of this file if 0)',
         (select count(*)::text from public.profiles where can_administer and active)
) t order by n;
