# Moving from the presentation to a real pilot

> **FICTIONAL PRESENTATION DATA MUST NEVER BE MIXED WITH REAL PILOT DATA.**
> Every presentation record starts with `[DEMO-2026-PRESENTATION]` in its description. Real records never do.
> Do the steps below in order, with the Data Keeper doing the SQL. Nothing here runs by itself. Stop at the first step that fails.

**Who:** the Data Keeper (runs SQL in the Supabase SQL Editor) and one Shift In-Charge (checks the pages).
**When:** before the first real shift of the pilot, never during a shift.

## 1. Backup / export
Supabase > Table Editor > export `shift_exceptions`, `exception_audit`, `exception_remarks` and `profiles` as CSV. Keep the files. (Presentation rows are fictional, but the backup proves what was there.)

## 2. Confirm the demo-data marker
```sql
select count(*) as demo_rows from public.shift_exceptions where position('[DEMO-2026-PRESENTATION]' in description) = 1;
select count(*) as other_rows from public.shift_exceptions where position('[DEMO-2026-PRESENTATION]' in description) <> 1;
```
`demo_rows` should be the presentation size (about 788 plus the 26 older test rows if `01` to `03` were run; the older rows have no marker). Write both numbers down. If `other_rows` contains anything you do not recognise, stop and find out why.

## 3. Run the demo rollback
Run `database/09-presentation-demo-data-rollback.sql`. It removes ONLY marker rows (and their audit lines and remarks). It never touches other rows.
(The older `01-03` test rows have no marker; remove them separately only if they should not be in the pilot: ask the Data Keeper lead. They are fictional too.)

## 4. Verify zero demo rows remain
```sql
select count(*) as demo_rows_left from public.shift_exceptions where position('[DEMO-2026-PRESENTATION]' in description) = 1;   -- must be 0
select count(*) as demo_audit_left from public.exception_audit a join public.shift_exceptions e on e.id = a.exception_id
 where position('[DEMO-2026-PRESENTATION]' in e.description) = 1;                                                              -- must be 0
```
`public.demo_shift_label_backup` (created by migration 11, if you ran it) is an internal table that only remembers old labels. It may keep rows after the rollback; they point to deleted demo rows and are harmless. Do not delete them.

## 5. Review profiles and active users
Follow `docs/ACCESS_GOVERNANCE.md`. The 8 `@example.com` test accounts must be **disabled** (`active = false`) or replaced by real accounts for the pilot. Fictional accounts must not remain active with real data.
```sql
select p.full_name, p.role, p.can_operate, p.active, u.email from public.profiles p join auth.users u on u.id = p.user_id order by p.role, p.full_name;
```

## 6. Verify the current IST shift and Operational Day
```sql
select now() as database_time, public.ist_shift(now()) as current_shift, public.ist_operational_date(now()) as operational_day;
```
Compare with a wall clock in India: First 05:00-13:00, Second 13:00-21:00, Night 21:00-05:00; before 05:00 the Operational Day is still the day before.

## 7. Verify the migration state
The files must have been run in this order: 04, accounts (use `04b-link-accounts.sql`), 05, 06, 07-lockdown, 08, 10. `09` and `11` are presentation only and are NOT part of a pilot. Do not re-run `04-auth-foundation.sql` after 07.
```sql
select proname from pg_proc where pronamespace = 'public'::regnamespace and proname in ('ist_shift','shift_clock','_check_live_shift','reopen_exception','create_exception') order by 1;  -- 5 rows
```

## 8. Run the security verification
Run `database/10-ist-shift-control-verify.sql`. **Every line must say OK.** (Ignore line A06 of the old 07 query: it is superseded.) If any line says PROBLEM, stop.

## 9. Create one controlled test exception
Sign in on a phone as a real Overman or Shift In-Charge. Add Shift Exception. Confirm the form shows the current shift, Operational Day and IST time, and that you cannot choose another shift. Use a clearly marked description such as `PILOT-START CHECK (delete not needed)`. Impact minutes are an estimate.

## 10. Verify the dashboard
The record is in the list with its age ("Open for ..."), the Shift Handover panel shows it as unresolved, and the clock bar shows IST.

## 11. Verify Top 3
Make sure the record appears in Top 3 only if it ranks there (High priority first, then impact minutes, then oldest). Change nothing else.

## 12. Verify the lifecycle
Start it. Add an operational remark. Request closure (the person who requests cannot confirm). Sign in as a second authorised officer and confirm. Check "Awaiting confirmation" ageing appears while the request is waiting.

## 13. Verify the audit
As a Shift In-Charge or above, open the record's History: created, started, remark, closure requested, resolved, each with who and when (IST). An Overman must not see the History.

## 14. Only then begin the pilot
Tell the shift staff: **this is real data; nothing fictional is in the system**. Keep the backup from step 1. Review access monthly (`docs/ACCESS_GOVERNANCE.md`).

### If something goes wrong
* Wrong shift shown: check the phone's network, reload; the database clock decides. If entries are rejected all day, see the rollback trigger in `database/10-ist-shift-control-rollback.sql` (rolls back the shift rule only).
* Presentation rows still visible: you skipped step 3 or 4. Do not start the pilot.
