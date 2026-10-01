-- MineShift Command - 13 ROLLBACK: removes the account administration functions.
-- Keeps profiles (including the can_administer column) and the account_admin_log history. Deletes nothing.
begin;
drop function if exists public.admin_list_accounts();
drop function if exists public.admin_log_recovery(uuid);
drop function if exists public.admin_set_active(uuid, boolean);
drop function if exists public.my_admin();
drop function if exists public._admin_actor();
commit;
select 'Account administration is switched off. Profiles and the log were kept.' as result;
