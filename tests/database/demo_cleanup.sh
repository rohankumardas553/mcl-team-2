#!/bin/bash
# Tests 11-demo-shift-label-cleanup.sql and its rollback on a SCRATCH database (never on live data).
source "$(dirname "${BASH_SOURCE[0]:-$0}")/../lib/env.sh"
D="psql -h $MS_PGHOST -p $MS_PGPORT -U postgres -d ms -At"; P="psql -h $MS_PGHOST -p $MS_PGPORT -U postgres -q -d ms -v ON_ERROR_STOP=1"
PASS=0; FAIL=0; ck(){ if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "pass  $1"; else FAIL=$((FAIL+1)); echo "FAIL  $1 -> got '$2' expected '$3'"; fi; }
DEMO="position('[DEMO-2026-PRESENTATION]' in description) = 1"
MIS="shift is distinct from public.ist_shift(created_at)"
LOCK=real bash $LIB/rebuild.sh >/dev/null 2>&1; $P -f $R/08-management-reopen.sql >/dev/null 2>&1; $P -f $R/09-presentation-demo-data.sql >/dev/null 2>&1
# a NON-demo row with a wrong label (a manual entry) and a non-demo correct one: must never be touched
$D -c "insert into shift_exceptions(created_at,shift,location,category,issue_type,description,impact_minutes,urgency,status) values ('2026-09-01 10:00+05:30','Night','Siding 1','Coal Despatch','Coal shortage','manual entry, not demo',5,'Low','Open')" >/dev/null
# fingerprint of everything EXCEPT the shift column, for every row
FP="select md5(string_agg(t::text, '|' order by id)) from (select e.id, e.created_at, e.updated_at, e.location, e.category, e.issue_type, e.description, e.impact_minutes, e.urgency, e.status, e.reported_priority, e.current_priority, e.started_at, e.resolved_at, e.closure_requested_at, e.created_by_name from shift_exceptions e) t"
FPALL="select md5(string_agg(t::text, '|' order by id)) from shift_exceptions t"
N=$($D -c "select count(*) from shift_exceptions where $DEMO"); MB=$($D -c "select count(*) from shift_exceptions where $DEMO and $MIS")
echo "demo rows: $N, mismatches before: $MB"
ck "the demo data really has mismatches to fix (the reported ~15%)" "$([ "$MB" -gt 50 ] && echo yes)" yes
F0=$($D -c "$FP"); ALL0=$($D -c "$FPALL"); MAN0=$($D -c "select shift from shift_exceptions where description='manual entry, not demo'")
AUD0=$($D -c "select count(*) from exception_audit")
OUT=$($P -f $R/11-demo-shift-label-cleanup.sql 2>&1 | tail -4)
echo "$OUT"
ck "after cleanup: 0 demo mismatches remain" "$($D -c "select count(*) from shift_exceptions where $DEMO and $MIS")" 0
ck "every field except shift is identical for every row (incl. updated_at)" "$($D -c "$FP")" "$F0"
ck "the non-demo manual row was NOT touched" "$($D -c "select shift from shift_exceptions where description='manual entry, not demo'")" "$MAN0"
ck "number of rows unchanged" "$($D -c "select count(*) from shift_exceptions where $DEMO")" "$N"
ck "audit trail untouched (no lines added or removed)" "$($D -c "select count(*) from exception_audit")" "$AUD0"
ck "the verification summary reports inspected / before / corrected / remaining" "$($D -c "select (select count(*) from demo_shift_label_backup where restored_at is null)")" "$MB"
ck "every corrected row now matches its IST time (spot rule: 04:59 Night / 05:00 First)" "$($D -c "select count(*) from shift_exceptions where $DEMO and shift <> case when (created_at at time zone 'Asia/Kolkata')::time >= time '05:00' and (created_at at time zone 'Asia/Kolkata')::time < time '13:00' then 'First' when (created_at at time zone 'Asia/Kolkata')::time >= time '13:00' and (created_at at time zone 'Asia/Kolkata')::time < time '21:00' then 'Second' else 'Night' end")" 0
F1=$($D -c "$FPALL"); $P -f $R/11-demo-shift-label-cleanup.sql >/dev/null 2>&1; ck "second run changes nothing (safe to run twice)" "$($D -c "$FPALL")" "$F1"
ck "backup table is closed to signed-in and signed-out users" "$($D -c "select has_table_privilege('authenticated','public.demo_shift_label_backup','select') or has_table_privilege('anon','public.demo_shift_label_backup','select')")" f
ck "row level security is ON for the backup table" "$($D -c "select relrowsecurity from pg_class where oid='public.demo_shift_label_backup'::regclass")" t
$P -f $R/11-demo-shift-label-cleanup-rollback.sql >/dev/null 2>&1
ck "rollback restores the original labels exactly (every field identical to before the cleanup)" "$($D -c "$FPALL")" "$ALL0"
ck "rollback: the demo mismatches are back (original state)" "$($D -c "select count(*) from shift_exceptions where $DEMO and $MIS")" "$MB"
ck "rollback: the manual non-demo row is still untouched" "$($D -c "select shift from shift_exceptions where description='manual entry, not demo'")" "$MAN0"
$P -f $R/11-demo-shift-label-cleanup-rollback.sql >/dev/null 2>&1; ck "rollback twice is safe" "$($D -c "$FPALL")" "$ALL0"
$P -f $R/11-demo-shift-label-cleanup.sql >/dev/null 2>&1; ck "cleanup can be applied again after a rollback" "$($D -c "select count(*) from shift_exceptions where $DEMO and $MIS")" 0
ck "(and again changes only the shift column)" "$($D -c "$FP")" "$F0"
# the presentation rollback (09) still works after 11
$P -f $R/09-presentation-demo-data-rollback.sql >/dev/null 2>&1
ck "09 rollback after 11: zero demo rows remain" "$($D -c "select count(*) from shift_exceptions where $DEMO")" 0
ck "09 rollback after 11: the manual non-demo row is still there" "$($D -c "select count(*) from shift_exceptions where description='manual entry, not demo'")" 1
# running 11 on a database with NO demo rows does nothing
$P -f $R/11-demo-shift-label-cleanup.sql >/dev/null 2>&1; ck "11 on data without demo rows changes nothing (manual row keeps its own label)" "$($D -c "select shift from shift_exceptions where description='manual entry, not demo'")" "$MAN0"
echo "PASS=$PASS FAIL=$FAIL"
