# CLAUDE.md - read this first, in every session

## About us
- We are a team of 4-5 people from Mahanadi Coalfields Limited (MCL) at an
  IIM Sambalpur MDP. We are NOT programmers.
- Explain everything in plain English, in short sentences. If you must use a
  technical word, explain it in one line.
- We build ONE small web tool in phases. Only one Claude session works at a
  time. The Progress Log at the end of this file is our handover logbook.

## What we are building
- A tool with at most 4 pages: index.html (entry page), dashboard.html
  (dashboard: what needs action now), analytics.html (historical analytics and
  period comparison and forecast readiness for management) and login.html (sign in). The shared helper file auth.js and the
  analytics code file analytics.js are not pages.
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
   call any variable "supabase"). Every page uses it: MineShift.start(pageId)
   requires a signed-in person with an active role, fills the header (name,
   role, role-aware menu, Sign out) and redirects to login.html otherwise.
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
  Order so far: 01, 02, 03 (demo data), 04 (auth foundation), 05 (location
  renames), 06 (closure confirmation fix, for a database that already ran 04),
  07-lockdown.sql (final security lockdown) and 07-rollback.sql (EMERGENCY ONLY
  - it re-opens public access), then 08-management-reopen.sql (higher
  authorities may reopen; for a database that already ran 04 and 07) with
  08-management-reopen-rollback.sql to undo it. See "Final lockdown" below.
- Tables (all in the public schema): shift_exceptions (the records),
  profiles (who each login account is and its role), exception_remarks
  (remarks) and exception_audit (history). Every table has
  id uuid primary key default gen_random_uuid() (profiles uses user_id) and
  created_at timestamptz not null default now().
- Row Level Security is ON for every table. Signed-out visitors get NO access
  once 07-lockdown.sql has been run. Signed-in users see data only according
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
- Keep an emergency rollback file (07-rollback.sql) next to 07-lockdown.sql.
- Grants are explicit. Remember Supabase gives new tables and functions to
  anon by default, so revoke what is not needed.

## Roles and permissions
- Roles, lowest to highest: Overman / Supervisor (1), Shift In-Charge (2),
  Manager (3), Project Officer (4), General Manager (5). There is no
  separate "Project Manager" role.
- Create: Overman, Shift In-Charge. Start: Overman, Shift In-Charge, Manager
  only when can_operate. Request closure (note of 5+ characters): Overman,
  Shift In-Charge. Decline closure (reason) and Resolve: Shift In-Charge,
  Manager only when can_operate. Resolve without a closure request needs a
  resolution note of 5+ characters.
- Reopen (Resolved to Open, reason of 5+ characters): Shift In-Charge,
  Manager, Project Officer and General Manager. A Manager does NOT need
  can_operate to reopen. An Overman / Supervisor can NOT reopen. Reason: a
  higher authority may reopen a closed issue that is found wrong during an
  inspection or review; that is a supervisory or managerial intervention, not
  routine operational closure. Any of these roles may reopen regardless of who
  resolved it (no rank lock for reopening). The mandatory reason and the
  immutable audit line (who, role, when, why) give the accountability.
  A Manager without can_operate, a Project Officer and a General Manager still
  cannot Start, Decline or Resolve.
- Maker-checker: whoever requested a closure can NOT decline it or confirm it
  (Resolve) themselves. Another Shift In-Charge, or a Manager with can_operate,
  must do it. Enforced in the database (decline_closure, resolve_exception).
- Change priority (reason of 5+ characters): Shift In-Charge and above, never
  the Overman after creation. Rank lock: if the last person who set the
  priority ranks higher, a lower rank cannot override it.
- Remarks: operational = Overman, Shift In-Charge. Management = Manager,
  Project Officer, General Manager. Overmen never see management remarks.
- Visibility: Shift In-Charge and above see everything. An Overman sees active
  exceptions plus their own history. Analytics, Top 3 and the chart are for
  Shift In-Charge and above.
- Locations (from 05): ABC Patch, XYZ Patch, Haul Road A, Haul Road B, MDP Junction,
  Stockyard 1, Siding 1, Siding 2.
- Lifecycle: Resolve clears the active closure request (its history stays in the
  audit and remarks). Reopen (Resolved to Open) starts a fresh cycle and clears
  resolved_at, resolved_by, closure_requested_by, closure_requested_at,
  started_by and started_at. Earlier audit and remarks are never removed.
- An Overman's "my history" means Resolved exceptions he CREATED (created_by
  never changes). Workflow fields are not used for history.
- The browser gets no list of staff. Names shown for "set by" come from the
  name snapshots stored on each record.
- After creation these are never editable: shift, location, category, issue
  type, description, impact minutes, reported priority. Corrections are
  added as remarks.
- Test accounts (fictional, 8): overman1, overman2, sic1, sic2, manager1,
  manager2 (can_operate), po1, gm1 at example.com. Passwords are set by the Data
  Keeper in Supabase and are never stored in this repository.

## Phase C analytics (analytics.html and analytics.js)
- PURPOSE: answer the management question "What recurring operational
  constraints are causing the greatest loss of time, where are they occurring,
  and are they improving or worsening?" using only data already in
  shift_exceptions and exception_audit. It is analytics ONLY: no forecasting,
  no AI recommendations, no automated decisions and no writes.
- WHO: Shift In-Charge, Manager, Project Officer, General Manager (the same
  people who can already see all records and the audit trail; role rank 2 and
  above, the "view_analytics" permission in auth.js). An Overman does not see
  the Analytics menu link, and opening analytics.html by hand shows "Not
  authorised" and requests no data. The database rules (RLS, lockdown) are
  unchanged: the page only SELECTs rows the person is already allowed to read.
  There is NO new SQL, view, function or grant for Phase C.
- HOW: two bulk reads (shift_exceptions filtered by the chosen period, shift,
  category and location, read in pages of 1000 rows; then exception_audit lines
  with action "reopened" or "priority_changed"), then all numbers are worked out
  in the browser by compute() in analytics.js. No read per record.
- FILTERS: Date range (Last 7 days, Last 30 days (default), Last 90 days, All
  time, Custom From and To), Shift, Category, Location. Last N days = today
  plus the N-1 days before it (local calendar days). Custom From and To are
  both included. Everything on the page follows the filters.
- CREATED_AT RULE: the selected period filters exceptions by created_at
  (browser local time). Lifecycle numbers (start, resolve) are then taken from
  the records that were created in that period. Stored timestamps are never changed.
- REOPENED RULE: an exception counts as reopened if it has at least one
  exception_audit line with action = 'reopened' (at any time, even after the
  period ended). Reopen Count of a group = its reopened exceptions, not events.
- KPI DEFINITIONS: Total Exceptions = count. Total Impact Minutes = sum of
  impact_minutes. Average Impact = total impact / total exceptions. Average Time
  to Start = mean of (started_at - created_at) in minutes over exceptions that
  have started_at. Average Time to Resolve = mean of (resolved_at - created_at)
  over currently Resolved exceptions that have resolved_at. Reopened Exceptions =
  reopened count. When there is no data the page shows a dash and "No data".
- CHART DEFINITIONS: Exceptions Created Over Time and Impact Minutes Over Time
  (line; daily buckets when the range is 90 days or less, monthly buckets for
  longer ranges; All time uses the span from the first record). Impact Minutes by
  Category, by Location (bars). Exceptions by Shift (bars). Top Issue Types
  (horizontal bars, top 10 by number of exceptions; issue types are grouped
  inside their category because "Other", "Weather" and "Water tanker required"
  exist in more than one category).
- RECURRING OPERATIONAL CONSTRAINTS: group by category + issue type + location;
  columns Count, Total Impact, Average Impact, Resolved Count (currently
  Resolved), Reopened Count, Last Occurrence (latest created_at). Sorted by total
  impact minutes, then count (then name, so the order never changes between
  reloads). Top 15 by default with a "Show all" button.
- OPERATIONAL HOTSPOTS: top 5 category + location combinations by total impact
  minutes (then count). No overall good/bad score.
- RESPONSE AND CLOSURE PERFORMANCE: median time to start, median time to
  resolve (same records as the averages; the median of an even count is the mean
  of the two middle values), Percentage Resolved = currently Resolved / total,
  Percentage Reopened = reopened / total (one decimal).
- PRIORITY: distribution counts and total impact by current_priority (High,
  Medium, Low; "Not recorded" only if any exist). Priority Changes = exceptions
  with at least one 'priority_changed' audit line. No severity is inferred.
- MANAGEMENT ATTENTION (Phase C wording; replaced by "Strategic Management Attention" in Phase D, see below): up to 3 fixed-pattern factual sentences, no AI, no
  prediction, no advice, no invented thresholds: (1) the category + location
  with the highest total impact, (2) the category share of total impact
  minutes, (3) the most recurring issue type; a location fact is used only to
  fill a missing slot. A statement is left out when there is nothing to compare
  (fewer than two groups) or the impact is zero. Ties are stated as ties. If
  nothing can be said: "Not enough historical data for a meaningful comparison."
- LIMITATION (multiple lifecycle cycles): an exception can be reopened and
  worked again. Phase C does NOT add up the cycles. Time to Start uses the
  CURRENT started_at (cleared by a reopen until it is started again), and Time
  to Resolve uses the CURRENT resolved_at of currently Resolved records. Earlier
  cycles are visible only through the audit history and the reopened counts.
- NOT YET (later phases only, when asked): forecasting, AI recommendations,
  automated decisions. (Comparison with a previous period was added in Phase D.)
- PERFORMANCE NOTE: if the data ever becomes too large for the browser,
  first consider narrower default periods; only then consider a database view
  or function, and only one that keeps the same row level security (never a
  SECURITY DEFINER shortcut that bypasses it). Ask before writing SQL.

## Phase D period comparison (in analytics.html and analytics.js)
- PURPOSE: answer "Compared with the immediately preceding equivalent period, what
  has changed?" It is a DECISION-SUPPORT view: facts only. No forecasting, no AI
  recommendations, no automated decisions, no scores, no good/bad labels, no
  causes, no advice. No new SQL, no new grant, no write of any kind.
- WHO: exactly as Phase C (Shift In-Charge, Manager, Project Officer, General
  Manager). The Overman has no menu link, sees "Not authorised" and no data is
  requested.
- COMPARISON PERIOD RULE: the previous period has the SAME number of local
  calendar days as the current one and ends exactly where the current one starts
  (the two never overlap, nothing is skipped). Last 7 / 30 / 90 days: the 7 / 30 /
  90 days before the current period. Custom From/To (both days included): if it
  has N days, the previous period is the N days before From. A one-day custom
  period is compared with the day before. All time: NO comparison; the page says
  "Period comparison is not available for All time." and hides all comparison
  parts. Periods are chosen by created_at (browser local time), stored
  timestamps never change. Shift, Category and Location filters apply to BOTH
  periods.
- DATA: still read-only. ONE bulk read of shift_exceptions covers both periods
  (they touch each other), read in pages of 1000; ONE bulk read of the audit lines
  "reopened" and "priority_changed". Then computeAll() splits the rows by
  created_at and does everything in the browser. The old stale-answer guard is
  kept: a slow answer never overwrites a newer filter choice.
- AUDIT CONVENTION (same as Phase C): an exception belongs to the period in which
  it was CREATED. It counts as reopened if it has at least one "reopened" audit
  line, and as priority-changed if it has at least one "priority_changed" line,
  even if that line was written after the period ended. Counted once per
  exception, not per event.
- FORMULAS: Change = current - previous, worked out from the SHOWN values
  (counts and minutes whole numbers, averages and medians one decimal), so a
  reader can check it. Percentage change = change / previous x 100. Increased /
  Decreased / No change are descriptive words only (a longer time is "Increased",
  never "bad").
- ZERO AND MISSING VALUES: if the previous value is 0 (or a value is missing) NO
  percentage is calculated (shown as "n/a" or "Percentage change not available");
  the absolute change is still shown. Never NaN, never Infinity. If an average or
  median has no data in one period the change reads "Not available".
- PERCENTAGE POINTS: % Resolved and % Reopened are compared as percentage points
  (current % minus previous %), e.g. 72.4% vs 66.1% = +6.3 percentage points. They
  are never shown as a percentage change.
- WHAT IS COMPARED: the 6 KPI cards (each card also shows Previous, Change and the
  direction word); Category Change (sorted by impact change, largest increase
  first, decreases last); Location Change (sorted by the size of the impact change
  either way; improved locations stay visible); Recurring Issue Change (category +
  issue type, top 10 by size of impact change, groups with no change left out);
  Hotspot Movement (category + location; Highest Increases and Highest Decreases,
  top 5 each; rows with no change are in neither); Response & Closure Performance
  (average and median time to start and resolve, % Resolved, % Reopened);
  Priority comparison (current_priority High/Medium/Low: counts and impact) and
  Priority Changes. Categories and locations with no exceptions in either period
  are left out of their tables. Ties are ordered by name so the order never changes.
- TREND CHARTS: for periods of 90 days or less the previous period is drawn as a
  dashed line under the same day number (day 1 of the previous period lines up
  with day 1 of the current one). For longer periods (monthly buckets do not line
  up) there is no overlay.
- STRATEGIC MANAGEMENT ATTENTION (replaces the Phase C "Management Attention"):
  at most 5 fixed-pattern factual sentences, made only from computed values, in
  this order, and each one only if it exists: (1) total impact minutes changed
  from X to Y; (2) the category + location with the largest increase in impact
  minutes; (3) the category + location with the largest decrease; (4) the
  recurring issue type with the largest increase in number of exceptions; (5)
  average time to start changed from X to Y minutes. Only when fewer than 5 exist
  are these added in this order: the location with the largest increase, the
  category with the largest decrease, average time to resolve, reopened
  exceptions. Ties are stated as ties. No causes, no prediction, no advice, no
  "should", no thresholds. When it is not possible (All time, or either period has
  no exceptions): "Not enough comparable historical data for period-over-period
  analysis." (The Phase C category-share and location facts are no longer in this
  box; Operational Hotspots and the tables still show that information.)
- MANAGEMENT REVIEW CANDIDATES: NOT a recommendation engine, no score, no colour
  rank. Grouped by category + issue type + location. A group is listed when its
  current impact minutes, OR current number of exceptions, OR current reopened
  count is higher than in the previous period. Sorted by impact increase, then
  exception-count increase, then reopened increase (all largest first), then
  latest occurrence (newest first), then name. Top 15. Columns: current and
  previous count, impact, reopened, impact change and latest occurrence. It is
  shown only when both periods have exceptions.
- LIMITATION (multiple lifecycle cycles): as in Phase C. Time to Start and Time to
  Resolve use the CURRENT started_at and resolved_at of each record. An exception
  that was reopened and worked again is one record in the period of its creation.
- NOT YET (later phases only, when asked): forecasting, confidence ranges,
  anomaly detection, AI or LLM recommendations, automated decisions.

## Phase E forecast readiness (in analytics.html and analytics.js)
- PURPOSE: before any forecasting exists, answer "Is there enough historical data
  to make a statistically meaningful forecast?" It is a DATA-SUFFICIENCY check.
  It makes NO forecast: no future values, no ranges, no "next week", no "likely",
  no AI or LLM recommendations, no operational judgement. No new SQL, no new
  grant, no new function, no write, no extra database request (it reuses the rows
  the page already loaded).
- NATURE OF THE THRESHOLDS: prototype ENGINEERING defaults for data sufficiency,
  NOT operational thresholds. They are listed on the page (under "Prototype
  engineering thresholds") and live in one place in analytics.js (READINESS).
  States are only Not Ready / Limited / Ready. There is no score and no traffic
  light; the badge colours are deliberately neutral (no red or green).
- WHO: as Phase C and D (Shift In-Charge, Manager, Project Officer, General
  Manager). The Overman stays blocked and nothing is requested.
- FILTERS: the same Date range, Shift, Category and Location as the rest of the
  page. All time is allowed. A custom range assesses only the selected window. The
  CURRENT period only is assessed (never the previous comparison period). Because
  the date range limits the history, Last 7 and Last 30 days can never reach 56
  days; choose Last 90 days or All time to assess more history.
- DEFINITIONS (local calendar dates of created_at): Historical span = latest
  exception day minus earliest exception day + 1 (of the filtered exceptions, not
  of the filter window). Distinct active days = unique days with at least one
  exception. Zero-event days = span minus distinct active days (descriptive only).
  Weeks = unique ISO 8601 weeks (Monday to Sunday). Months = unique calendar months.
- EXCEPTION COUNT FORECAST: Not Ready if ANY of: span under 14 days, under 20
  exceptions, under 7 distinct active days. Ready only if ALL of: span at least 56
  days, at least 50 exceptions, at least 21 distinct active days. Otherwise
  Limited. Weeks represented are shown as information only (no threshold).
- IMPACT MINUTES FORECAST: the same three history thresholds, counted on the
  exceptions that have a recorded impact value; plus: if total impact minutes is
  0 it is Not Ready; if ONE exception contributes MORE than 50% of total impact
  minutes it can never be Ready (it is Limited; exactly 50% is allowed). The 50%
  rule applies to impact, not to the exception count forecast.
- TIME-TO-START FORECAST: usable observation = started_at present and not before
  created_at. Not Ready under 10 usable observations. Ready only if at least 30
  usable observations AND at least 50% of filtered exceptions have one AND those
  observations cover at least 28 calendar days (first to last created_at). Otherwise
  Limited.
- TIME-TO-RESOLVE FORECAST: usable observation = status Resolved, resolved_at
  present and not before created_at. Not Ready under 10. Ready only if at least 30
  usable observations AND at least 40% of filtered exceptions AND at least 28 days
  of represented history. Otherwise Limited.
- OVERALL FORECAST READINESS: Ready only if Exception Count AND Impact Minutes are
  both Ready; Not Ready if either is Not Ready; otherwise Limited. Time-to-start and
  time-to-resolve have their own readiness and do NOT change the overall state. Each
  forecast type needs its own Ready state.
- SHOWN ON THE PAGE: Forecast Readiness (overall, four metric cards each with the
  state, a summary line and written factual reasons, and Readiness Notes),
  Historical Coverage, Data Concentration (largest single impact and its share,
  top category and top location share of impact minutes, top category + issue type
  share of the exception count; ties are stated), Recurrence Coverage (per
  category: exceptions, distinct days, distinct locations, issue types; and how many
  category + issue type combinations occur once, 2 to 4 times, 5 or more times).
  Rare groups are not called insignificant; nothing here infers a cause.
- FORECAST GATE FOR A LATER PHASE: MineAnalytics.assessReadiness(rows, reopenedIds)
  returns { overall, exceptionCount, impactMinutes, timeToStart, timeToResolve,
  coverage, concentration, recurrence, notes, thresholds } and every metric has
  state and reasons. MineAnalytics.isReady(readiness, metric) is true only when that
  metric is "Ready". A forecasting phase must not produce a forecast for a metric
  unless it is Ready.
- LIMITATION (multiple lifecycle cycles): as before. Reopened exceptions are
  measured by their CURRENT cycle only; earlier cycles are not reconstructed. The
  lifecycle cards say so when reopened exceptions are present.
- NOT YET (later phases only, when asked): forecasting itself, confidence ranges,
  anomaly detection, AI or LLM recommendations, automated decisions.

## Final lockdown (07-lockdown.sql)
- WHEN: run it ONLY after the login pages are live on the main branch (Vercel
  production) and every role has passed the preview tests. The old public pages
  stop working the moment it runs. Claude never runs SQL; the Data Keeper does.
- WHAT IT DOES: removes the old open rules on shift_exceptions ("anyone can
  read / add / update" and any other leftover rule except "role read
  exceptions"); takes ALL table and function access away from signed-out
  visitors (anon); gives signed-in users SELECT only on shift_exceptions,
  profiles, exception_remarks and exception_audit (row level security decides
  which rows); allows signed-in users to run only the 8 action functions,
  my_access() and app_rank() (the read rules use it); hides every internal
  helper; keeps row level security ON for all 4 tables; adds value checks
  (status, shift, category, priorities, impact minutes) as NOT VALID, only
  where no old row would break them. It deletes nothing, updates no record
  and drops no table. It runs in one transaction, checks that 04 and 06 were
  run and that an active profile exists (so nobody is locked out), and is
  safe to run twice.
- AFTER IT: the browser can never insert, update or delete anything directly.
  Every change goes through the 8 functions, so roles, the priority rank lock
  and maker-checker keep working exactly as before.
- CHECK IT: the last query of the file gives one result table. Section A must
  show OK on all 9 lines; section C must show anon all false and authenticated
  true only for select; section D must show signed-out can run = false for
  every function.
- 07-rollback.sql restores ONLY the old open rules and grants on
  shift_exceptions. It is for emergencies only, keeps every table, column,
  record, audit line, profile, role and the maker-checker rule, and does not
  open the new tables. After an emergency, fix the cause and run
  07-lockdown.sql again.
- NEW WORK AFTER LOCKDOWN: every new table needs row level security and an
  explicit revoke from anon and authenticated before use; every new function
  must be granted to authenticated explicitly and revoked from anon and public
  (Supabase gives anon access by default). Re-run the 07 verification query
  after each database change.
- MIGRATION ORDER: backup, 04, accounts, 04 again, 05, 06, test every role on
  the preview, merge to main (pages live), 07-lockdown.sql, run the verification
  query, run the post-lockdown role tests, keep 07-rollback.sql for emergencies.

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

## Maintenance notes
- Dashboard pagination fix (bug above 1,000 rows): the database returns at most 1,000
  rows per request, even if the code asks for more. dashboard.html used to read
  the exceptions with a limit of 1,000 and the remarks with a limit of 5,000, so
  with more rows it silently worked on only the first 1,000 (wrong cards, Top 3,
  chart, OVERDUE, list, and missing remarks). Fix: both bulk reads now use
  repeated 1,000-row reads (.range) in a stable order (created_at, then id)
  until a page comes back short, so the dashboard uses ALL matching rows. The
  per-record History read is unchanged (it is one record at a time). Nothing
  else changed: no database, security, role or rule change.

## Our tool (filled in during Phase 1)
- Team:
- Tool name: MineShift Command
- Problem: Shift problems in Coal Despatch and Dust Suppression are not recorded in one place.
- Who records / who decides: Shift staff record; shift managers decide (to confirm).
- Table name and columns: shift_exceptions - id, created_at, shift, location, category, issue_type, description, impact_minutes, urgency, status, resolved_at, plus (from 04) created_by, created_by_role, reported_priority, current_priority, priority_changed_by, priority_changed_by_role, priority_changed_at, priority_change_reason, started_by, started_at, closure_requested_by, closure_requested_at, resolved_by, updated_at, and name snapshots created_by_name, priority_changed_by_name, started_by_name, closure_requested_by_name, resolved_by_name. Other tables: profiles, exception_remarks, exception_audit.
- Pages: index.html = entry page (Overman and Shift In-Charge only); dashboard.html = role-aware dashboard; analytics.html (+ analytics.js) = historical analytics, period-to-period comparison and forecast readiness (Shift In-Charge and above); login.html = sign in (helper: auth.js)

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
- Login and roles, Phase A (Claude): database/04-auth-foundation.sql (additive; adds profiles, remarks, audit, new columns, protection triggers, 8 change functions, read rules, and links 8 fictional test accounts), auth.js (shared sign-in helper) and login.html (sign in and role check). index.html and dashboard.html are NOT changed yet and still work as before. The old open rules are still ON. Tested against a scratch local Postgres copy, not the live database. Next: Data Keeper takes a backup, runs 04, creates the 8 accounts in Supabase Auth, re-runs the link block; Phase B builds the role-aware pages; then 07-lockdown.sql and 07-rollback.sql. Do NOT run 07 before login and all roles are tested.
- Login and roles, Phase A corrections (Claude): (1) create_exception now accepts the NEW location names; a separate database/05-location-renames.sql renames existing records (Coal Face A to ABC Patch, Coal Face B to XYZ Patch, Junction A to MDP Junction, Stockyard A to Stockyard 1, Siding A to Siding 1, Siding B to Siding 2; Haul Road A and B unchanged). It changes ONLY the location field, deletes nothing, leaves updated_at alone, adds one audit line per renamed record and is safe to run twice. Run it AFTER 04. 01 to 03 still use the old names, so run any of them you have not yet run BEFORE 05, and do not re-run them after 05. The old public pages still show the old names until Phase B. Future lockdown files are now 07-lockdown.sql and 07-rollback.sql (not written yet). (2) Resolve now clears the active closure request. (3) Reopen now also clears started_by and started_at. (4) An Overman's history is the Resolved exceptions he created. (5) The people view is removed; name snapshots are stored on the record instead, so the browser cannot list staff. Migration order: backup, 04, create accounts, re-run 04 link block, 05, build Phase B, test every role on the preview, merge Phase B, 07-lockdown, full permission test, keep 07-rollback for emergencies.
- Login and roles, Phase B (Claude): index.html and dashboard.html are now role-aware and use auth.js. Not signed in, no profile or an inactive profile sends you to login.html. Header shows name, role and Sign out; menu is role-aware (Manager, Project Officer and General Manager see Dashboard only). Entry page: only Overman and Shift In-Charge; others see "Your role cannot create operational exceptions"; field renamed Reported Priority; saves with the create_exception function; final location names only. Dashboard: Overman sees active list, My history (resolved records he created), filters, remarks, closure state and permitted buttons, but no cards, Top 3, chart, management remarks or audit. Shift In-Charge and above see 3 cards, Top 3, chart, all records, history (audit) and their buttons. Everything uses current_priority; reported and current priority, who set it, when and why are shown. Every change goes through the database functions (start_exception, request_closure, decline_closure, resolve_exception, reopen_exception, change_priority, add_remark); database errors are shown on the card. No database change in Phase B. Tested against a scratch local Postgres copy driven through the real pages, not the live Supabase. Old location names may still appear inside the description text of older demo records (05 changes only the location field). Next: Data Keeper runs 04 and 05 and creates the accounts, team tests every role on the Vercel preview, then merge, then 07-lockdown.sql (not written yet).
- Maker-checker fix (Claude): live testing found that a Shift In-Charge could confirm or decline their own closure request. Now decline_closure and resolve_exception reject the action when the caller is the person who requested the closure ("You cannot confirm or decline your own closure request. Another Shift In-Charge or authorised Manager must review it."). A Manager with can_operate may still review a Shift In-Charge or Overman request; an Overman still cannot decline or resolve; with NO closure request a Shift In-Charge can still resolve directly with a note of 5+ characters. Fixed in 04-auth-foundation.sql (fresh setups) and in the small new database/06-closure-confirmation-fix.sql (replaces only those two functions; for the database that already ran 04; no table or data change). dashboard.html shows the requester "Awaiting confirmation by another authorised officer." instead of Decline / Confirm Resolved. The future lockdown files are now 07-lockdown.sql and 07-rollback.sql (not written). New migration order: backup, 04, accounts, 04 again, 05, 06, test every role on the preview, merge, 07-lockdown, full permission test. Tested against a scratch local Postgres copy, not the live Supabase.
- Final lockdown prepared (Claude): database/07-lockdown.sql and database/07-rollback.sql written, NOT run. 07-lockdown.sql removes the old public rules on shift_exceptions, takes all table and function access away from signed-out visitors, leaves signed-in users SELECT only plus the 8 action functions, my_access and app_rank, keeps row level security on for all 4 tables, adds NOT VALID value checks where safe, and ends with one verification table. 07-rollback.sql (EMERGENCY ONLY, re-opens public access) restores only the old open policies and grants on shift_exceptions. Tested against a scratch local Postgres copy set up like the live database: data identical before and after, second run changes nothing, every role and the maker-checker rule still work, direct writes are blocked, and the pages still work. NOT tested on the live Supabase. Must not be run until the login pages are live on main and every role has passed the preview tests.
- Management reopen (Claude): authority-model correction after the lockdown. A Resolved exception may now be reopened by a Shift In-Charge, Manager (no can_operate needed), Project Officer or General Manager; an Overman still cannot; a reason of 5+ characters is required and the audit line records who, role, Resolved to Open, the reason and the server time. Reopen still clears every current-cycle field (resolved_*, closure_requested_*, started_*, including the name snapshots) and never touches earlier audit or remarks. Start, Decline and Resolve rules, maker-checker and the priority rank lock are unchanged. Done in 04-auth-foundation.sql (fresh setups) and in the small database/08-management-reopen.sql for the live, already locked-down database (replaces ONLY reopen_exception; no table, row, policy or grant change; safe to run twice). database/08-management-reopen-rollback.sql restores the previous rule (Shift In-Charge, or Manager with can_operate). auth.js shows the Reopen button for the four roles. Tested against a scratch local Postgres copy that had 04, 05, 06 and 07 applied, then 08; not tested on the live Supabase.
- Phase C analytics (Claude): new analytics.html and analytics.js (historical analytics for Shift In-Charge, Manager, Project Officer and General Manager; the Overman gets no menu link and a "Not authorised" message on a manual visit), one line in auth.js to add the Analytics menu item for the "view_analytics" permission, and this CLAUDE.md section. Filters (date range, shift, category, location), 6 KPI cards, rule-based Management Attention, 6 charts, Operational Hotspots, Recurring Operational Constraints table, Response and Closure Performance, Priority Distribution and Priority Changes. Read-only, client-side aggregation of rows the person may already read; NO new SQL, no new grant, no change to the lockdown, maker-checker, reopen authority or priority rules. Known limitation: multiple lifecycle cycles are not added up. No forecasting and no AI recommendations yet. Tested against a scratch local Postgres copy with 2,326 demo rows over about 13 months; not tested on the live Supabase.
- Phase D period comparison (Claude): extended analytics.html and analytics.js (no new page, no SQL, no grant, no change to auth.js, the lockdown, maker-checker, reopen authority or priority rules). Compares the selected period with the immediately preceding period of the same length (custom ranges too; not for All time): Period Comparison banner, comparison lines on the 6 KPI cards, Strategic Management Attention (up to 5 factual sentences), Category Change, Location Change, Recurring Issue Change, Hotspot Movement (increases and decreases), Management Review Candidates (factual list, not recommendations), Response & Closure comparison (percentage points), Priority comparison and Priority Changes, dashed previous-period line on the trend charts (periods up to 90 days). Read-only; one bulk read covers both periods. No forecasting and no AI recommendations yet. Known limitation: multiple lifecycle cycles are not added up. Tested against a scratch local Postgres copy with 2,326 demo rows; not tested on the live Supabase.
- Phase E forecast readiness (Claude): extended analytics.html and analytics.js (no new page, no SQL, no grant, no function, no extra database request, no change to auth.js, the lockdown, maker-checker, reopen authority or priority rules). New "Forecast Readiness" section: Not Ready / Limited / Ready for Exception Count, Impact Minutes, Time-to-Start and Time-to-Resolve forecasts, each with written factual reasons, plus an overall state, Readiness Notes, Historical Coverage, Data Concentration and Recurrence Coverage. Prototype engineering thresholds (data sufficiency, not operational) are shown on the page and listed above. Reusable gate for a later phase: MineAnalytics.assessReadiness and isReady. NO forecasting, no scores and no AI recommendations yet. Known limitation: multiple lifecycle cycles are not reconstructed. Tested against a scratch local Postgres copy with 2,326 demo rows and hand-built boundary datasets; not tested on the live Supabase.
