source "$(dirname "${BASH_SOURCE[0]:-$0}")/../lib/env.sh"

S=$LIB;  R=$R
D="psql -h $MS_PGHOST -p $MS_PGPORT -U postgres -d ms -At"; P="psql -h $MS_PGHOST -p $MS_PGPORT -U postgres -q -d ms -v ON_ERROR_STOP=1"
PASS=0; FAIL=0; ck(){ if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "pass  $1"; else FAIL=$((FAIL+1)); echo "FAIL  $1 -> got '$2' expected '$3'"; fi; }
bad(){ $D -f $R/10-ist-shift-control-verify.sql 2>/dev/null | grep -c "|PROBLEM"; }
has(){ $D -c "select pg_get_functiondef('public.create_exception(text,text,text,text,text,integer,text)'::regprocedure) like '%_check_live_shift%'"; }
fresh(){ F04=${1:-$R/04-auth-foundation.sql} LOCK=real bash $LIB/rebuild.sh 2>&1 | grep -v NOTICE | tail -1 >/dev/null; $P -f $R/08-management-reopen.sql >/dev/null 2>&1; }
echo "## G. verification"
fresh; ck "G1 fresh install (new 04 + 07): verify has no PROBLEM" "$(bad)" 0
cp $FIX/04-pre-ist.sql /tmp/old04.sql
fresh /tmp/old04.sql; ck "G2 negative control: old 04 + 07 WITHOUT 10 -> verify reports problems" "$([ $(bad) -gt 0 ] && echo yes)" yes
$P -f $R/10-ist-shift-control.sql >/dev/null; ck "G3 live-like (old 04 + 07 + 08 + 10): verify has no PROBLEM" "$(bad)" 0
ck "G4 the OLD 07 verification still flags A06 (superseded line) while the new verify is clean" "$($D -f $R/07-lockdown.sql 2>&1 | grep -c 'A|06.*PROBLEM')" 1
ck "G5 ...and the new verify is still clean after that 07 re-run (07 re-run changed nothing important)" "$(bad)" 0
echo "## F. account-linking workflow keeps enforcement"
ck "F0 enforcement present before" "$(has)" t
$P -f $R/04b-link-accounts.sql >/dev/null; ck "F1 04b-link-accounts.sql: shift check still present" "$(has)" t
ck "F2 04b-link-accounts.sql: verify still clean" "$(bad)" 0
fresh; $P -f $R/04-auth-foundation.sql >/dev/null 2>&1; ck "F3 fresh DB, new 04 re-run BEFORE lockdown-sensitive steps: shift check still present" "$(has)" t
fresh /tmp/old04.sql; $P -f $R/10-ist-shift-control.sql >/dev/null; $P -f $R/04-auth-foundation.sql >/dev/null 2>&1; ck "F4 live-like: re-running the NEW 04 after 10 keeps the shift check" "$(has)" t
ck "F5 ...but re-running 04 after 07 re-opens helper functions: the verify file catches it (the reason 04b exists)" "$([ $(bad) -gt 0 ] && echo yes)" yes
ck "F6 OLD 04 re-run after 10 removed the check (the original defect, now documented and avoided by 04b)" "$(fresh /tmp/old04.sql; $P -f $R/10-ist-shift-control.sql >/dev/null; $P -f /tmp/old04.sql >/dev/null 2>&1; has)" f
echo "## H. rollback and re-apply"
fresh /tmp/old04.sql; $P -f $R/10-ist-shift-control.sql >/dev/null
$P -f $R/10-ist-shift-control-rollback.sql >/dev/null; ck "H1 rollback: shift check gone" "$(has)" f
ck "H2 rollback: helpers gone" "$($D -c "select count(*) from pg_proc where proname in ('ist_shift','ist_operational_date','shift_clock','_check_live_shift','_shift_start_text')")" 0
$P -f $R/10-ist-shift-control-rollback.sql >/dev/null; ck "H3 rollback twice is safe" "$?" 0
$P -f $R/10-ist-shift-control.sql >/dev/null; ck "H4 re-apply: check back" "$(has)" t
ck "H5 re-apply: verify clean" "$(bad)" 0
$P -f $R/10-ist-shift-control.sql >/dev/null; ck "H6 apply twice is safe, verify clean" "$(bad)" 0
echo "PASS=$PASS FAIL=$FAIL"
