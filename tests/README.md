# MineShift Command - tests

> **NEVER RUN THESE TESTS AGAINST LIVE PRODUCTION SUPABASE DATA.**
> They create, change and DELETE records, switch users and move a fake clock. They only work against a
> **scratch Postgres database on your own computer** (a local unix socket). The scripts refuse to start if
> `PGHOST`, `DATABASE_URL`, `SUPABASE_URL` or `SUPABASE_DB_URL` is set, or if `MS_PGHOST` is not a local folder path.
> All data used here is fictional.

## What is tested

| Folder | What | Needs |
|---|---|---|
| `unit/` | IST shifts, Operational Day, handover windows (05:00 rule), age text, under several device timezones | Node. `ist_unit.js` also needs Postgres. |
| `analytics/` | Phase C, D, E calculations against independent SQL, and the analytics page | Node, Postgres, Playwright (page tests) |
| `database/` | `create_exception` shift enforcement and tampering, migration 10 verify / rollback / re-apply, account linking (04b), demo cleanup 11 and its rollback, lockdown | Postgres (`psql`) |
| `permissions/` | Roles, maker-checker, reopen authority, priority lock, lockdown (SQL level) | Postgres |
| `browser/` | The real pages in Chromium: entry form, dashboard, handover, ageing, drafts, shift rollover, 390 px mobile, role views | Postgres + Playwright |
| `fixtures/` | SQL used to build scratch data (`seed_hist.sql` = 2,300 historical rows, `ds.sql` = N rows, `04-pre-ist.sql` = 04 as it was before the IST work) | - |
| `lib/` | Test harness (`harness.js`), scratch database scripts | - |

## Prerequisites

* Node 18+ and **Playwright** with Chromium (`npm i playwright && npx playwright install chromium`, in any folder; set `PLAYWRIGHT_MODULE=/path/to/node_modules/playwright` if it is not on the normal module path; set `PW_CHROMIUM` to a Chromium binary if needed).
* PostgreSQL 14+ command-line tools (`initdb`, `pg_ctl`, `psql`). Tests use the `auth` and `anon/authenticated` roles that Supabase provides; `fixtures/emu.sql` and `fixtures/pg_setup.sql` create small stand-ins in the scratch database.
* The repository itself needs no install (plain HTML/JS).

## Quick start

```bash
bash tests/lib/setup-scratch-db.sh start      # creates and starts a scratch cluster in /var/tmp/mspg (port 5544)
LOCK=real bash tests/lib/rebuild.sh           # builds database "ms": 01-03, 8 fictional users, 04, 05, 06, 07 lockdown
bash tests/run-all.sh                         # everything (about 20 minutes); any line starting with FAIL needs attention
bash tests/lib/setup-scratch-db.sh stop
```

Change the location with `MS_PGHOST=/some/folder MS_PGPORT=5555`. A single test:

```bash
node tests/unit/handover_unit.js
node tests/browser/handover_e2e.js            # needs: LOCK=real bash tests/lib/rebuild.sh  (a clean database, no demo data)
```

## Which tests need what

* **No database, no browser:** `unit/handover_unit.js`, `analytics/test_compute.js`, `test_compare*.js`, `test_ready.js`, `test_attention.js` (the last ones read the scratch database for some checks).
* **Postgres only:** everything in `database/` and `permissions/`, `unit/ist_unit.js`, `analytics/test_ready_sql.js`.
* **Postgres + Playwright:** everything in `browser/` and the three `analytics/pb_test*_page.js` files.
* Browser tests start their own small web server on port 8765 and replace the Supabase library with a stand-in that sends each request to the scratch database as the signed-in test user, so the real SQL functions, row level security and triggers are exercised. Chart.js is replaced by a stub unless `REAL_CHART=/path/to/chart.umd.js` is set (`browser/chart_real.js` uses the real library).

## Simulated time (IST boundary testing)

The pages and the database both work from India time. Browser tests install a fake clock with Playwright (`page.clock.install`, `fastForward`, `setSystemTime`) and `global.FAKE` makes the stand-in for `shift_clock()` answer with the same fake time; `jump(page, ms)` moves both together. Database-side boundaries are tested by calling `_check_live_shift(shift, timestamp)` with an explicit time, because the real `now()` cannot be faked.

* `unit/ist_unit.js` - 04:59, 05:00, 12:59, 13:00, 17:30, 20:59, 21:00, 23:59, 00:00, 02:30, year end and leap day; page code and SQL must agree.
* `unit/handover_unit.js` - which shift just ended and its exact window, including 05:00 (Night belongs to the previous Operational Day).
* `browser/ist_ui*.js`, `ist_p3.js` - future shifts disabled, hidden old rows, page open across 13:00 / 21:00 / 05:00, wrong device clock, sleep / wake, open forms during a shift change.
* `browser/handover_e2e.js` - the full Night to First sequence at 04:50 / 05:10 with real database functions; `browser/role_walkthrough.js` - the five roles on the same handover at 390 px, plus a dashboard action failing on a weak network.
* Old suites that build rows with every shift label run with `FORCE_NIGHT=1` (the page clock is set to the Night shift of the current Operational Day so no shift is "in the future").

## Migration verification, rollback and re-apply

`database/ist_verify_linking_rollback.sh` runs `10-ist-shift-control-verify.sql` on a fresh install, on a live-like database (04 before IST + 07 + 08 + 10), and as a negative control (it must report PROBLEM without 10); it proves `04b-link-accounts.sql` keeps shift enforcement, then rolls 10 back, re-applies it and applies it twice. `database/demo_cleanup.sh` does the same for `11-demo-shift-label-cleanup.sql` and checks that only demo-marker rows and only the shift column change.

## Role tests

`permissions/perm_part1..7.sh` (SQL as each of the 8 fictional users: create / start / close / resolve / reopen / priority / remarks / visibility / lockdown / maker-checker) and `browser/pb_test1..5.js` (the same rules through the pages: what each role sees and which buttons exist).

## Analytics tests

`analytics/test_*.js` compare every number with independent SQL; `pb_test6/7/9` open the real analytics page, change filters and compare what is on screen with SQL (Phase C figures, Phase D comparison, Phase E readiness). `browser/mg2.js` checks the Management Overview (only 2 charts by default, filters update hidden sections, no sideways scroll at 320 / 390 / 768 / 1280 px).

## 390 px mobile testing

Browser tests open pages at `{ width: 390, height: 800 }` and assert no sideways scroll (`document.documentElement.scrollWidth <= innerWidth`) and minimum text and button sizes. `browser/handover_e2e.js` and `browser/draft.js` include 390 px checks; screenshots are written to `/tmp`.

## Adding a test

Put it in the folder that matches what it proves, `require('../lib/harness.js')` for browser tests (`newPage`, `check`, `done`, `psql`, `asUser`), print lines starting with `pass` / `FAIL`, end with `done()`. Keep tests deterministic: fixed fake times, fixed past dates for seeded rows.
