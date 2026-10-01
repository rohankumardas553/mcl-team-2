# Access governance checklist (for the Data Keeper)

No admin screen exists on purpose. Access is managed in Supabase and in the `profiles` table. Do this before the pilot and then **every month** (put it in a calendar).

> Use `database/04b-link-accounts.sql` for routine account linking.
> **Do not re-run the full `04-auth-foundation.sql` after the lockdown sequence (07).** It re-opens helper functions that 07 hid.

## A. Sign-up and anonymous access
- [ ] Supabase > Authentication > Providers/Settings: **public sign-up is OFF** (accounts are created by the Data Keeper only).
- [ ] Email confirmation / password rules are on as the organisation requires.
- [ ] No anonymous write: run `database/10-ist-shift-control-verify.sql`; checks 1, 8 and 9 must say OK (signed-out users can run no function and have no table access; signed-in users have SELECT only).

## B. Profiles, roles and the active flag
```sql
select p.full_name, p.role, p.can_operate, p.active, u.email, u.last_sign_in_at
from public.profiles p join auth.users u on u.id = p.user_id
order by p.role, p.full_name;
```
- [ ] Every real person who may use the tool has exactly one profile; nobody else has one.
- [ ] Each role is right: Overman / Supervisor (1), Shift In-Charge (2), Manager (3), Project Officer (4), General Manager (5).
- [ ] `can_operate` is true ONLY for Managers who must Start work or confirm closures. It never gives a Manager the right to create exceptions.
- [ ] People who moved or left: set `active = false` the same day (do not delete the profile; audit lines still name them).
```sql
update public.profiles set active = false where user_id = '<user id>';   -- example: disable one person
```
- [ ] Fictional `@example.com` accounts are disabled before real data is used.

## C. What each role can do (spot check on a test day)
- [ ] Overman: creates, starts, requests closure, operational remarks; sees active items and own history; no analytics, no audit, no management remarks.
- [ ] Shift In-Charge: everything operational, confirms another person's closure, changes priority with a reason, reopens, sees analytics and History.
- [ ] Manager: sees everything, management remarks, changes priority, reopens; Starts / confirms closure only with `can_operate`; cannot create.
- [ ] Project Officer and General Manager: view, management remarks, change priority, reopen; cannot create, Start or confirm closure.
- [ ] Nobody can confirm or decline their own closure request (maker-checker).
- [ ] No role can create an exception in another shift (the database refuses; no higher-role bypass exists).

## D. Keys and secrets
- [ ] `config.js` contains only the Project URL and the **publishable** (anon) key.
- [ ] No `service_role` key, database password or token appears in any file in the repository, in `config.js`, or in browser code. Search: `grep -ri "service_role" .` must find only documentation.
- [ ] The service_role key is not shared in chat, e-mail or screenshots.

## E. Monthly access review (30 minutes)
1. Run the profile query in section B and export it.
2. Ask each Manager to confirm their people and roles.
3. Disable leavers and transfers; adjust roles if duties changed; re-check `can_operate`.
4. Run `database/10-ist-shift-control-verify.sql`; all lines OK.
5. Note the date, who reviewed, and what changed (keep with the backup files).

Linking a new account: create the user in Supabase (Authentication > Users), then run `04b-link-accounts.sql` for the fictional test accounts, or insert the profile row for a real person with the right role (ask the project lead).
