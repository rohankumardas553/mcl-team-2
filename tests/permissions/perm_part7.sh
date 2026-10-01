source "$(dirname "${BASH_SOURCE[0]:-$0}")/../lib/env.sh"

source $LIB/perm_test.sh
MODE=${MODE:-after}   # before = old rule (baseline); after = new rule
DENY="permission denied"
mkx(){ $PSQL -c "set role authenticated; select set_config('request.jwt.claim.sub','${UID_[${2:-overman1}]}',false); select create_exception((select shift_clock()->>'shift'),'Siding 1','Coal Despatch','Weather','$1',30,'Medium')" | tail -1; }
resolved(){ local id; id=$(mkx "$1" "${2:-overman1}"); run overman2 "select start_exception('$id')" >/dev/null; run sic1 "select request_closure('$id','Closure note for $1')" >/dev/null 2>&1; run sic2 "select resolve_exception('$id')" >/dev/null; echo $id; }
echo "=== N. REOPEN authority ($MODE the 08 change)"
declare -A WANT; if [ "$MODE" = after ]; then WANT=([overman1]=no [overman2]=no [sic1]=yes [sic2]=yes [manager1]=yes [manager2]=yes [po1]=yes [gm1]=yes); else WANT=([overman1]=no [overman2]=no [sic1]=yes [sic2]=yes [manager1]=no [manager2]=yes [po1]=no [gm1]=no); fi
for u in overman1 overman2 sic1 sic2 manager1 manager2 po1 gm1; do
  R=$(resolved "RO $u")
  if [ "${WANT[$u]}" = yes ]; then
    ok  "$u CAN reopen" $u "select reopen_exception('$R','Found a defect during the inspection')"
    val "$u reopen: status Open and ALL current-cycle fields cleared" "Open||||||||||" postgres "select status||'|'||coalesce(resolved_at::text,'')||'|'||coalesce(resolved_by::text,'')||'|'||coalesce(resolved_by_name,'')||'|'||coalesce(closure_requested_by::text,'')||'|'||coalesce(closure_requested_at::text,'')||'|'||coalesce(closure_requested_by_name,'')||'|'||coalesce(started_by::text,'')||'|'||coalesce(started_at::text,'')||'|'||coalesce(started_by_name,'')||'|' from shift_exceptions where id='$R'"
    val "$u reopen: audit line has actor, role, old, new, reason, server time" "t" postgres "select actor_name is not null and actor_role=(select role from profiles where user_id='${UID_[$u]}') and old_value='Resolved' and new_value='Open' and note='Found a defect during the inspection' and created_at > now()-interval '1 minute' from exception_audit where exception_id='$R' and action='reopened'"
    val "$u reopen: earlier start / closure / resolve history still there" "t" postgres "select count(*) filter (where action='started')=1 and count(*) filter (where action='closure_requested')=1 and count(*) filter (where action='resolved')=1 and count(*) filter (where action='created')=1 from exception_audit where exception_id='$R'"
    val "$u reopen: closure-note remark kept" "1" postgres "select count(*) from exception_remarks where exception_id='$R'"
  else
    err "$u can NOT reopen" "cannot reopen" $u "select reopen_exception('$R','Found a defect during the inspection')"
    val "$u refused: record untouched (still Resolved, audit unchanged)" "Resolved|0" postgres "select status||'|'||(select count(*) from exception_audit where exception_id='$R' and action='reopened') from shift_exceptions where id='$R'"
  fi
done
echo "--- reopen rules that do not change"
R=$(resolved "RO rules")
err "reason under 5 characters refused (even for gm1)" "at least 5" gm1 "select reopen_exception('$R','no')"
err "empty reason refused" "at least 5" gm1 "select reopen_exception('$R',null)"
N=$(mkx "RO notresolved"); err "cannot reopen an Open record" "Only a Resolved" gm1 "select reopen_exception('$N','Reason long enough')"
run overman2 "select start_exception('$N')" >/dev/null; err "cannot reopen an In progress record" "Only a Resolved" sic1 "select reopen_exception('$N','Reason long enough')"
err "unknown record" "not found" gm1 "select reopen_exception(gen_random_uuid(),'Reason long enough')"
ok  "a Manager may reopen a record resolved by someone else entirely" manager1 "select reopen_exception('$R','Second review found a gap')"
echo "--- everything else in the authority model is unchanged"
M=$(mkx "RO unchanged"); 
for u in manager1 po1 gm1; do err "$u still cannot Start" "cannot Start" $u "select start_exception('$M')"; done
ok  "manager2 (can_operate) starts" manager2 "select start_exception('$M')"
ok  "sic1 requests closure" sic1 "select request_closure('$M','Verified by sic1 for the unchanged test')"
for u in manager1 po1 gm1; do err "$u still cannot Decline" "cannot decline" $u "select decline_closure('$M','Not my operational job')"; err "$u still cannot Resolve" "cannot Resolve" $u "select resolve_exception('$M')"; done
err "MAKER-CHECKER: sic1 cannot decline own request" "your own closure request" sic1 "select decline_closure('$M','declining my own request')"
err "MAKER-CHECKER: sic1 cannot resolve own request" "your own closure request" sic1 "select resolve_exception('$M')"
ok  "sic2 declines" sic2 "select decline_closure('$M','Photo missing from the request')"
ok  "sic1 requests again" sic1 "select request_closure('$M','Photo added now, please confirm')"
ok  "manager2 confirms" manager2 "select resolve_exception('$M')"
err "overman still cannot reopen" "cannot reopen" overman1 "select reopen_exception('$M','Overman cannot do this')"
P=$(mkx "RO priority")
ok  "po1 sets priority High" po1 "select change_priority('$P','High','Project level decision')"
err "manager1 cannot override PO (rank lock)" "set by a Project Officer" manager1 "select change_priority('$P','Low','trying to override')"
ok  "gm1 sets priority" gm1 "select change_priority('$P','Medium','General Manager decision')"
err "po1 cannot override GM (rank lock)" "set by a General Manager" po1 "select change_priority('$P','High','trying to override')"
err "overman cannot change priority" "cannot change priority" overman1 "select change_priority('$P','Low','not allowed')"
echo "--- lockdown intact"
for t in shift_exceptions profiles exception_remarks exception_audit; do err "anon cannot read $t" "$DENY" anon "select * from $t"; done
err "anon cannot run reopen_exception" "$DENY" anon "select reopen_exception('$P','Reason long enough')"
err "anon cannot insert" "$DENY" anon "insert into shift_exceptions(shift) values ('First')"
for u in overman1 sic1 manager1 po1 gm1; do err "$u direct UPDATE blocked" "$DENY" $u "update shift_exceptions set status='Open' where id='$R'"; done
err "gm1 direct INSERT blocked" "$DENY" gm1 "insert into shift_exceptions(shift) values ('First')"
err "gm1 direct DELETE blocked" "$DENY" gm1 "delete from shift_exceptions"
err "history cannot be edited (owner too)" "append-only" postgres "update exception_audit set note='x'"
echo "PASS=$PASS FAIL=$FAIL"
