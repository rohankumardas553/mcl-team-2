-- =============================================================================
-- 04b-link-accounts.sql  -  link the FICTIONAL test accounts to their roles.
--
-- Use this (NOT 04-auth-foundation.sql) whenever you only need to link accounts, and ALWAYS
-- after 07-lockdown.sql / 10-ist-shift-control.sql have been run. It touches nothing but the
-- profiles table: no function, grant, policy or shift rule is changed.
--
-- Create the accounts in Supabase first (Authentication > Users). This does nothing for an
-- account that does not exist yet and never changes a profile that is already linked.
-- Safe to run more than once. Same list as block 9 of 04-auth-foundation.sql.
-- =============================================================================
begin;

insert into public.profiles (user_id, full_name, role, can_operate)
select u.id, v.full_name, v.role, v.can_operate
from (values
  ('overman1@example.com', 'Test Overman One',          'overman',         false),
  ('overman2@example.com', 'Test Overman Two',          'overman',         false),
  ('sic1@example.com',     'Test Shift In-Charge One',  'shift_incharge',  false),
  ('sic2@example.com',     'Test Shift In-Charge Two',  'shift_incharge',  false),
  ('manager1@example.com', 'Test Manager One',          'manager',         false),
  ('manager2@example.com', 'Test Manager Two (operate)','manager',         true),
  ('po1@example.com',      'Test Project Officer One',  'project_officer', false),
  ('gm1@example.com',      'Test General Manager One',  'general_manager', false)
) as v(email, full_name, role, can_operate)
join auth.users u on lower(u.email) = v.email
on conflict (user_id) do nothing;

commit;

-- Read-only check: the linked accounts.
select p.full_name, p.role, p.can_operate, p.active, u.email
from public.profiles p join auth.users u on u.id = p.user_id
order by public.role_rank(p.role), p.full_name;
