# CLAUDE.md - read this first, in every session

## About us
- We are a team of 4-5 people from Mahanadi Coalfields Limited (MCL) at an
  IIM Sambalpur MDP. We are NOT programmers.
- Explain everything in plain English, in short sentences. If you must use a
  technical word, explain it in one line.
- We build ONE small web tool in phases. Only one Claude session works at a
  time. The Progress Log at the end of this file is our handover logbook.

## What we are building
- A tool with at most 3 pages: index.html (entry page), dashboard.html
  (dashboard) and login.html (sign in). The shared helper file auth.js is not
  a page.
- Every record has location, priority (Low / Medium / High) and status
  (Open / In progress / Resolved), plus the columns in "Our tool" below.
- The tool is now a role-based operational decision-support PROTOTYPE with
  individual login (see "Roles and permissions"). It is still a training
  prototype.
- All data is MADE UP. Never add real names, phone numbers, employee IDs or
  real MCL figures. Test accounts are fictional (example.com e-mail addresses).

## Technical rules
1. Plain HTML, CSS and JavaScript only. Pages stay in the top folder; SQL
   files go in the database folder. No frameworks, no npm, no package.json,
   no build step.
2. Vercel publishes the site from the main branch. Use relative links only,
   e.g. href="dashboard.html".
3. Load Supabase from the jsDelivr CDN, then our settings, then the shared
   sign-in helper, in this order:
     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
     <script src="config.js"></script>
     <script src="auth.js"></script>
   auth.js creates the one database client. Use it as MineShift.db (do not
   call any variable "supabase"). auth.js was added when login was introduced;
   the older pages (index.html, dashboard.html) still create their own client
   until they are moved to auth.js in Phase B.
4. The Project URL and the publishable key live only in config.js. Never use
   or ask for a secret key, a service_role key or the database password.
   Never put a password, a token or a real e-mail address in any file.
5. For charts, load Chart.js from the jsDelivr CDN.
6. Individual login with Supabase Auth (e-mail and password). No public
   sign-up: the Data Keeper creates every account. No shared passwords and
   no hard-coded usernames or passwords. A person's role comes from the
   protected profiles table, never from anything the user can edit.
   Hiding a button is not security: every important permission must be
   enforced in the database (RLS, triggers and functions).
7. You may not be able to reach our database. Do NOT try to test the database
   connection. Write the code; we test it on the live website. (You may test
   SQL and pages against a scratch local copy, never against the live one.)
8. If anything fails, show a friendly message on the page that also includes
   the actual error text, so we can pass it on.
9. Every page must work well on a mobile phone: large buttons, readable text,
   no sideways scrolling. Use the same header and menu on every page.
10. Never delete config.js or CLAUDE.md.

## Database rules
- Our Data Keeper runs all SQL by pasting it into the Supabase SQL Editor.
  You cannot run SQL yourself.
- Give SQL as ONE block that runs in one go. Also save it in the database
  folder: 01-setup.sql, then 02-..., 03-..., 04-... for later changes.
- Tables (all in the public schema): shift_exceptions (the records),
  profiles (who each login account is and its role), exception_remarks
  (remarks) and exception_audit (history). Every table has
  id uuid primary key default gen_random_uuid() (profiles uses user_id) and
  created_at timestamptz not null default now().
- Row Level Security is ON for every table. Signed-out visitors get NO access
  once 05-lockdown.sql has been run. Signed-in users see data only according
  to their role.
- Changes to records go through the named database functions (create_exception,
  start_exception, request_closure, decline_closure, resolve_exception,
  reopen_exception, change_priority, add_remark). Browser users get read-only
  table access; there is no direct insert, update or delete for them.
- Remarks and audit lines are append-only. Nobody edits or deletes them.
- Never drop a table, never delete rows, never overwrite existing data.
  Every migration is additive and safe to run twice. Old records are kept.
- The reported priority (reported_priority) is never overwritten. current_priority
  is the one used for the dashboard, Top 3, OVERDUE and analytics. urgency stays
  as a compatibility copy of current_priority.
- Keep an emergency rollback file (05-rollback.sql) next to 05-lockdown.sql.
- Grants are explicit. Remember Supabase gives new tables and functions to
  anon by default, so revoke what is not needed.

## Roles and permissions
- Roles, lowest to highest: Overman / Supervisor (1), Shift In-Charge (2),
  Manager (3), Project Officer (4), General Manager (5). There is no
  separate "Project Manager" role.
- Create: Overman, Shift In-Charge. Start: Overman, Shift In-Charge, Manager
  only when can_operate. Request closure (note of 5+ characters): Overman,
  Shift In-Charge. Decline closure (reason), Resolve, Reopen (reason,
  Resolved to Open): Shift In-Charge, Manager only when can_operate. Resolve
  without a closure request needs a resolution note of 5+ characters.
- Change priority (reason of 5+ characters): Shift In-Charge and above, never
  the Overman after creation. Rank lock: if the last person who set the
  priority ranks higher, a lower rank cannot override it.
- Remarks: operational = Overman, Shift In-Charge. Management = Manager,
  Project Officer, General Manager. Overmen never see management remarks.
- Visibility: Shift In-Charge and above see everything. An Overman sees active
  exceptions plus their own history. Analytics, Top 3 and the chart are for
  Shift In-Charge and above.
- After creation these are never editable: shift, location, category, issue
  type, description, impact minutes, reported priority. Corrections are
  added as remarks.
- Test accounts (fictional): overman1, overman2, sic1, manager1, manager2
  (can_operate), po1, gm1 at example.com. Passwords are set by the Data
  Keeper in Supabase and are never stored in this repository.

## How to work with us
- Make one change at a time. Do not change parts that already work unless we
  ask.
- After each change, reply in 3 short bullets: what you changed and what we
  should test on the live website.
- Commit and push your work at every stopping point.

## Takeover and handover
- At the START of every session: read the Progress Log below and summarize it
  in 3 bullets (what exists, what works, what is next).
- At a "save point": add a new entry at the end of the Progress Log (phase,
  builder, what was built, what works, known problems, next step). Then
  commit and push.

## Our tool (filled in during Phase 1)
- Team:
- Tool name: MineShift Command
- Problem: Shift problems in Coal Despatch and Dust Suppression are not recorded in one place.
- Who records / who decides: Shift staff record; shift managers decide (to confirm).
- Table name and columns: shift_exceptions - id, created_at, shift, location, category, issue_type, description, impact_minutes, urgency, status, resolved_at, plus (from 04) created_by, created_by_role, reported_priority, current_priority, priority_changed_by, priority_changed_by_role, priority_changed_at, priority_change_reason, started_by, started_at, closure_requested_by, closure_requested_at, resolved_by, updated_at. Other tables: profiles, exception_remarks, exception_audit.
- Pages: index.html = entry page; dashboard.html = dashboard; login.html = sign in (helper: auth.js)

## Progress Log (newest entry at the bottom)
- Phase 0 (starter): placeholder index.html, config.js without settings and
  this CLAUDE.md. Next: Phase 1 - the table and the entry page.
- Phase 1 (Claude): entry page index.html (Add Shift Exception) for Coal Despatch and Dust Suppression only; database/01-setup.sql (non-destructive, adds 12 demo rows). Works: not yet tested live. Known problems: config.js still has placeholder URL and key. Next: Data Keeper runs 01-setup.sql; team fills config.js; then test on live site.
- Phase 2 (Claude): dashboard.html - 4 number cards (not resolved, High not resolved, impact minutes and exceptions for last 14 days), one stacked bar chart of impact minutes per day by category, list of latest 10 exceptions. Added Dashboard link to menu on both pages. No database change. Works: not yet tested live. Known problems: none known; still needs config.js filled and 01-setup.sql run. Next: team tests dashboard; later phases (Start/Resolve, OVERDUE, Top 3) not built.
- Phase 3 (Claude): dashboard.html only. 3 KPI cards (Open Exceptions, High Priority, Active Impact Minutes; all records, no date limit). Filters for Category, Shift, Location (work together; change list and all 3 cards). Start (Open -> In progress) and Resolve (In progress -> Resolved, sets resolved_at) buttons save to Supabase and refresh. OVERDUE label = High, not Resolved, older than 30 minutes. List now shows all matching records (no limit of 10). Chart untouched (Phase 4). No database change. Works: not yet tested live. Next: Phase 4 chart.
- Phase 4 (Claude): dashboard.html only. Filters moved to the top and now change the list, 3 KPI cards, Top 3 and chart. Added Top 3 - Act Now (not Resolved; High > Medium > Low, then higher impact_minutes, then older created_at; first 3). Chart replaced by Active Impact Minutes by Category (two bars, not Resolved, no date limit). Added Why this tool exists box. Start/Resolve, OVERDUE, entry page and database unchanged. Works: not yet tested live. Next: final live test and publishing.
- Phase 5 (Claude): polish and final check, no new features. Reviewed both pages and config.js (only Project URL and publishable key; no secrets; relative links only; same header, menu and footer). Small clean-up in dashboard.html: removed unused code, and Top 3 sorting now puts an unexpected urgency value last. Could not test the live database or CDN libraries from here. Known problems: none known. Next: team runs the full live test and publishes.
- Phase 6 (Claude): look and ease-of-use only, no change to rules or database. Dashboard: wider two-column layout on large screens (Top 3 and chart left, exception list right), bigger cards, text, chart and buttons, filters in one panel with a 'Show all' reset button. Entry page: after saving, a 'See it on the Dashboard' link. Earlier: Start/Resolve errors now show under the button. Tested with a stand-in database only, not live. Known problems: Resolve problem from live test still open (need exact red text). Next: team re-tests live.
- Live test rows (Claude): database/02-live-test-rows.sql adds 6 fictional Open exceptions dated now for a live Start/Resolve demo. Data Keeper runs it once. No table change. Known problems: Resolve problem from live test still open (need the exact red text under the button).
- Entry page redesign (Claude): index.html restyled - three step cards (When and where / What happened / How serious), big touch buttons for Shift, Category and Urgency, quick minute buttons (15/30/60/120), clearer messages, wider form on big screens. Same fields, same saved values, same rules (status Open; created_at by database). Header restyled the same way on both pages (initials mark, active menu tab). No database change. Tested with a stand-in database only, not live.
- Dashboard redesign (Claude): dashboard.html restyled to match the entry page - page title with one-line help, tidy filter panel, KPI cards with coloured top edge (red for High Priority), section headings with amber marker, exception and Top 3 rows as separate cards, OVERDUE rows tinted red. Only look changed; numbers, filters, Top 3, chart, Start/Resolve and OVERDUE rules are the same. No database change. Tested with a stand-in database only, not live.
- Expansion to 4 categories (Claude): added Haul Road and Coal Quality (12 issue types each) to the entry page and the dashboard Category filter; chart now has 4 bars (active impact minutes per category). Same table shift_exceptions, same columns, same Top 3, KPI, Start/Resolve and OVERDUE rules. database/03-new-category-demo-rows.sql adds 8 fictional demo rows for the new categories (no table change; Data Keeper runs it once). Tested with a stand-in database only, not live.
- Resolve fix attempt (Claude): live test said 'Resolve button did nothing'. dashboard.html only: the button now says 'Saving...', the page reads the record back from the database to confirm the change, and a pop-up at the bottom of the screen says 'X is now Resolved.' (green) or shows the error (red). If the database quietly refuses the change, the pop-up now says so. Real cause not yet known: need the red text or the pop-up text from the live site, plus the Data Keeper's policy check (see chat). No database change. Tested with a stand-in database only.
- Login and roles, Phase A (Claude): database/04-auth-foundation.sql (additive; adds profiles, remarks, audit, new columns, protection triggers, 8 change functions, read rules, and links 7 fictional test accounts), auth.js (shared sign-in helper) and login.html (sign in and role check). index.html and dashboard.html are NOT changed yet and still work as before. The old open rules are still ON. Tested against a scratch local Postgres copy, not the live database. Next: Data Keeper takes a backup, runs 04, creates the 7 accounts in Supabase Auth, re-runs the link block; Phase B builds the role-aware pages; then 05-lockdown.sql and 05-rollback.sql. Do NOT run 05 before login and all roles are tested.
