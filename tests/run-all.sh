#!/bin/bash
# Runs the whole MineShift test set against the SCRATCH database. Takes about 20 minutes.
# NEVER RUN THESE TESTS AGAINST LIVE PRODUCTION SUPABASE DATA (see README.md).
# usage: bash tests/run-all.sh            (from the repository root; the scratch Postgres must be running: bash tests/lib/setup-scratch-db.sh)
source "$(dirname "${BASH_SOURCE[0]:-$0}")/lib/env.sh" || exit 1
cd "$TESTS"
P="psql -h $MS_PGHOST -p $MS_PGPORT -U postgres -q -d ms -v ON_ERROR_STOP=1"
last(){ grep -E "FAIL|PASS="; }
fresh(){ LOCK=real bash lib/rebuild.sh 2>&1 | grep -v NOTICE | tail -1 >/dev/null; $P -f $R/08-management-reopen.sql >/dev/null 2>&1; $P -f $R/10-ist-shift-control.sql >/dev/null 2>&1; }
TOTAL_FAIL=0; section(){ echo; echo "## $1"; }
run(){ out=$("$@" 2>&1 | last); echo "$out"; echo "$out" | grep -q "^FAIL" && TOTAL_FAIL=1; }

section "unit (no database): IST boundaries, handover windows, ages under three device timezones"
for z in UTC America/New_York Pacific/Auckland; do TZ=$z node unit/handover_unit.js | tail -1; done
section "unit with scratch database: shift functions agree with the page code"
fresh; for z in UTC America/New_York Pacific/Auckland; do TZ=$z node unit/ist_unit.js | tail -1; done
section "analytics calculations (Phase C, D, E)"
for t in test_compute test_compare test_compare_unit test_ready test_attention; do echo -n "$t: "; node analytics/$t.js 2>&1 | tail -1; done
section "analytics pages (historical data set)"
fresh; $P -f $FIX/seed_hist.sql >/dev/null 2>&1
run node analytics/pb_test6_phase_c_page.js; run node analytics/pb_test7_phase_d_page.js; run node analytics/pb_test9_phase_e_page.js
echo -n "test_ready_sql: "; node analytics/test_ready_sql.js 2>&1 | tail -1
section "dashboard reads more than 1,000 rows (pagination)"
bash lib/mkds.sh 2326 1000 1200 >/dev/null 2>&1; $P -f $R/08-management-reopen.sql >/dev/null 2>&1; $P -f $R/10-ist-shift-control.sql >/dev/null 2>&1
FORCE_NIGHT=1 LABEL=2326 FILTERS='[{},{"category":"Haul Road"},{"shift":"Night"},{"category":"Coal Quality"}]' run node browser/pb_test8.js
section "presentation data: demo suite, management overview, IST scoping, handover cleanup"
fresh; $P -f $R/09-presentation-demo-data.sql >/dev/null 2>&1
FORCE_NIGHT=1 run node browser/pb_demo9.js; run node browser/mg2.js
run node database/ist_db.js; run node browser/ist_ui.js; run node browser/ist_ui2.js; run node browser/ist_ui4.js; run node browser/ist_p3.js; run node browser/ist_ui3.js
section "role and workflow suites (UI + database)"
fresh
for t in pb_test1 pb_test2 pb_test3 pb_test4 pb_test5; do echo -n "$t: "; FORCE_NIGHT=1 node browser/$t.js 2>&1 | last | tail -1; done
section "permissions, maker-checker, reopen, lockdown (SQL)"
(source lib/perm_test.sh; source permissions/perm_part5.sh; echo "maker-checker END PASS=$PASS FAIL=$FAIL") 2>&1 | tail -1
fresh; (source lib/perm_test.sh; MODE=after; source permissions/perm_part7.sh; echo "reopen + lockdown END PASS=$PASS FAIL=$FAIL") 2>&1 | tail -1
section "migrations: verification, account linking, rollback and re-apply"
bash database/ist_verify_linking_rollback.sh 2>&1 | grep -E "FAIL|PASS="
section "demo data cleanup (11) and its rollback"
bash database/demo_cleanup.sh 2>&1 | grep -E "FAIL|PASS="
section "new product features: draft, handover end-to-end, five-role walkthrough, weak network, 390 px"
fresh; run node browser/draft.js; fresh; run node browser/handover_e2e.js; fresh; run node browser/role_walkthrough.js
echo; echo "DONE (any line starting with FAIL needs attention)"; exit $TOTAL_FAIL
