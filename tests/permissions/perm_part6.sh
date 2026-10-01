source "$(dirname "${BASH_SOURCE[0]:-$0}")/../lib/env.sh"

source $LIB/perm_test.sh
DENY="permission denied"
mkx(){ $PSQL -c "set role authenticated; select set_config('request.jwt.claim.sub','${UID_[${2:-overman1}]}',false); select create_exception((select shift_clock()->>'shift'),'Siding 1','Coal Despatch','Weather','$1',30,'Medium')" | tail -1; }
echo "=== G. AFTER 07-lockdown: SIGNED OUT (anon)"
for t in shift_exceptions profiles exception_remarks exception_audit; do err "anon cannot read $t" "$DENY" anon "select * from $t"; done
err "anon cannot insert shift_exceptions" "$DENY" anon "insert into shift_exceptions(shift,location,category,issue_type,description,impact_minutes,urgency,status) values ('First','Siding 1','Coal Despatch','Weather','x',1,'Low','Open')"
err "anon cannot update shift_exceptions" "$DENY" anon "update shift_exceptions set status='Resolved'"
err "anon cannot delete shift_exceptions" "$DENY" anon "delete from shift_exceptions"
err "anon cannot write profiles" "$DENY" anon "update profiles set role='general_manager'"
err "anon cannot write remarks/audit" "$DENY" anon "insert into exception_audit(exception_id,action) values (gen_random_uuid(),'x')"
X=$(mkx 'LOCK seed')
for f in "create_exception((select shift_clock()->>'shift'),'Siding 1','Coal Despatch','Weather','x',5,'Low')" "start_exception('$X')" "request_closure('$X','some closing note')" "decline_closure('$X','some decline reason')" "resolve_exception('$X','some resolution note')" "reopen_exception('$X','some reopen reason')" "change_priority('$X','Low','some priority reason')" "add_remark('$X','operational','some remark text')" "my_access()" "app_rank()"; do
  err "anon cannot run ${f%%(*}" "$DENY" anon "select $f"; done

echo "=== H. OVERMAN (overman1)"
ACT=$($PSQL -c "select count(*) from shift_exceptions where status<>'Resolved'")
OWN=$($PSQL -c "select count(*) from shift_exceptions where status='Resolved' and created_by=(select id from auth.users where email='overman1@example.com')")
val "overman1 reads active + own history only" "$((ACT+OWN))" overman1 "select count(*) from shift_exceptions"
O1=$(mkx 'LOCK overman flow')
ok  "create via RPC" overman1 "select create_exception((select shift_clock()->>'shift'),'ABC Patch','Haul Road','Potholes','LOCK via rpc',10,'Low')"
ok  "start via RPC" overman1 "select start_exception('$O1')"
ok  "request closure via RPC" overman1 "select request_closure('$O1','Verified by the overman on site')"
err "cannot direct UPDATE the table" "$DENY" overman1 "update shift_exceptions set status='Resolved' where id='$O1'"
err "cannot direct INSERT" "$DENY" overman1 "insert into shift_exceptions(shift,location,category,issue_type,description,impact_minutes,urgency,status) values ('First','Siding 1','Coal Despatch','Weather','x',1,'Low','Open')"
err "cannot direct DELETE" "$DENY" overman1 "delete from shift_exceptions where id='$O1'"
err "cannot write profiles" "$DENY" overman1 "update profiles set role='general_manager'"
err "cannot write remarks" "$DENY" overman1 "insert into exception_remarks(exception_id,kind,body,author_name,author_role) values ('$O1','operational','forged','x','y')"
err "cannot write audit" "$DENY" overman1 "insert into exception_audit(exception_id,action) values ('$O1','x')"
ok  "operational remark via RPC" overman1 "select add_remark('$O1','operational','Crew informed at the site')"
ok  "manager1 adds a management remark" manager1 "select add_remark('$O1','management','Management-only note')"
val "overman sees NO management remarks" "0" overman1 "select count(*) from exception_remarks where kind='management'"
val "overman sees operational remarks" "t" overman1 "select count(*) > 0 from exception_remarks where kind='operational'"
val "overman sees no audit table rows" "0" overman1 "select count(*) from exception_audit"
val "overman sees only his own profile" "1" overman1 "select count(*) from profiles"
err "overman cannot Resolve" "cannot Resolve" overman1 "select resolve_exception('$O1')"
err "overman cannot Decline" "cannot decline" overman1 "select decline_closure('$O1','not for overmen')"
err "overman cannot Reopen" "cannot reopen" overman1 "select reopen_exception('$O1','not for overmen')"
err "overman cannot change priority" "cannot change priority" overman1 "select change_priority('$O1','Low','not for overmen')"
for f in "app_role()" "app_can_operate()" "role_rank('overman')" "role_label('overman')" "app_actor()" "_issue_type_ok('Haul Road','Potholes')"; do err "internal helper ${f%%(*} is not callable" "$DENY" overman1 "select public.$f"; done
ok  "app_rank() (needed by the read rules) works" overman1 "select app_rank()"
val "my_access still works" "overman" overman1 "select my_access()->>'role'"

echo "=== I. SHIFT IN-CHARGE (sic1 / sic2)"
TOT=$($PSQL -c "select count(*) from shift_exceptions")
val "sic1 reads everything permitted" "$TOT" sic1 "select count(*) from shift_exceptions"
val "sic1 reads the audit history" "t" sic1 "select count(*) > 0 from exception_audit"
val "sic1 sees management remarks" "t" sic1 "select count(*) > 0 from exception_remarks where kind='management'"
err "sic1 direct UPDATE blocked" "$DENY" sic1 "update shift_exceptions set status='Resolved' where id='$O1'"
S1=$(mkx 'LOCK sic flow' sic1)
ok  "sic1 creates" sic1 "select create_exception((select shift_clock()->>'shift'),'Siding 2','Dust Suppression','Heavy dust','LOCK sic create',10,'Low')"
ok  "sic1 starts" sic1 "select start_exception('$S1')"
ok  "sic1 requests closure" sic1 "select request_closure('$S1','Checked on site by sic1')"
err "MAKER-CHECKER: sic1 cannot decline own request" "your own closure request" sic1 "select decline_closure('$S1','declining my own request')"
err "MAKER-CHECKER: sic1 cannot confirm own request" "your own closure request" sic1 "select resolve_exception('$S1')"
ok  "sic2 declines sic1's request" sic2 "select decline_closure('$S1','Needs one more check')"
ok  "sic1 requests again" sic1 "select request_closure('$S1','Second check completed')"
ok  "sic2 confirms sic1's request" sic2 "select resolve_exception('$S1')"
ok  "sic1 declines the OVERMAN's pending request (another person)" sic1 "select decline_closure('$O1','Please add the weighment slip')"
ok  "overman requests again; sic1 confirms it" overman1 "select request_closure('$O1','Weighment slip attached')"
ok  "sic1 resolves the overman's request" sic1 "select resolve_exception('$O1')"
S2=$(mkx 'LOCK direct resolve' sic1); ok "sic1 starts another" sic1 "select start_exception('$S2')"
err "direct resolve without a note refused" "resolution note" sic1 "select resolve_exception('$S2')"
ok  "direct resolve WITH a note" sic1 "select resolve_exception('$S2','Cleared by the crew, nothing pending')"
ok  "sic1 reopens" sic1 "select reopen_exception('$S2','Fault returned after closing')"
ok  "sic1 changes priority" sic1 "select change_priority('$S2','High','Escalated after the fault returned')"
ok  "sic1 operational remark" sic1 "select add_remark('$S2','operational','Shift plan updated')"
err "sic1 cannot add a management remark" "cannot add management" sic1 "select add_remark('$S2','management','not for sic')"

echo "=== J. MANAGER (normal) manager1"
val "manager1 reads everything" "$TOT" manager1 "select count(*) from shift_exceptions"
ok  "manager1 changes priority" manager1 "select change_priority('$S2','Medium','Manager review')"
ok  "manager1 management remark" manager1 "select add_remark('$S2','management','Watch this one')"
err "manager1 cannot create" "Only an Overman" manager1 "select create_exception((select shift_clock()->>'shift'),'Siding 1','Coal Despatch','Weather','x',5,'Low')"
err "manager1 cannot start" "cannot Start" manager1 "select start_exception('$S2')"
err "manager1 cannot request closure" "cannot request closure" manager1 "select request_closure('$S2','not a manager job')"
err "manager1 cannot decline" "cannot decline" manager1 "select decline_closure('$S2','not a manager job')"
err "manager1 cannot resolve" "cannot Resolve" manager1 "select resolve_exception('$S2','not a manager job')"
err "manager1 cannot reopen" "cannot reopen" manager1 "select reopen_exception('$S2','not a manager job')"
err "manager1 cannot add operational remark" "cannot add operational" manager1 "select add_remark('$S2','operational','not a manager job')"
err "manager1 direct UPDATE blocked" "$DENY" manager1 "update shift_exceptions set status='Resolved'"

echo "=== K. MANAGER with can_operate (manager2)"
M1=$(mkx 'LOCK manager operate' sic1)
ok  "manager2 starts" manager2 "select start_exception('$M1')"
ok  "sic1 requests closure" sic1 "select request_closure('$M1','Verified by sic1 for manager test')"
err "MAKER-CHECKER still enforced for sic1" "your own closure request" sic1 "select resolve_exception('$M1')"
ok  "manager2 declines a Shift In-Charge request" manager2 "select decline_closure('$M1','Photo needed first')"
ok  "sic1 requests again" sic1 "select request_closure('$M1','Photo added as requested')"
ok  "manager2 resolves it" manager2 "select resolve_exception('$M1')"
ok  "manager2 reopens" manager2 "select reopen_exception('$M1','Recheck required by manager')"
err "manager2 direct UPDATE blocked" "$DENY" manager2 "update shift_exceptions set status='Open'"
err "manager2 still cannot create" "Only an Overman" manager2 "select create_exception((select shift_clock()->>'shift'),'Siding 1','Coal Despatch','Weather','x',5,'Low')"

echo "=== L. PROJECT OFFICER (po1) and GENERAL MANAGER (gm1)"
P1=$(mkx 'LOCK priority chain' overman1); ok "manager2 starts it" manager2 "select start_exception('$P1')"
ok  "po1 changes priority" po1 "select change_priority('$P1','High','Project level decision')"
ok  "po1 management remark" po1 "select add_remark('$P1','management','PO note')"
for f in "start_exception('$P1')" "decline_closure('$P1','not a PO job')" "resolve_exception('$P1','not a PO job')" "reopen_exception('$P1','not a PO job')" "request_closure('$P1','not a PO job')" "add_remark('$P1','operational','not a PO job')" "create_exception((select shift_clock()->>'shift'),'Siding 1','Coal Despatch','Weather','x',5,'Low')"; do
  err "po1 cannot ${f%%(*}" "cannot\|Only an Overman" po1 "select $f"; done
err "manager1 cannot override PO" "set by a Project Officer" manager1 "select change_priority('$P1','Low','trying to override')"
err "sic1 cannot override PO" "set by a Project Officer" sic1 "select change_priority('$P1','Low','trying to override')"
ok  "gm1 changes priority" gm1 "select change_priority('$P1','Medium','General Manager decision')"
ok  "gm1 management remark" gm1 "select add_remark('$P1','management','GM note')"
err "po1 cannot override GM" "set by a General Manager" po1 "select change_priority('$P1','High','trying to override GM')"
err "manager1 cannot override GM" "set by a General Manager" manager1 "select change_priority('$P1','High','trying to override GM')"
err "manager2 cannot override GM" "set by a General Manager" manager2 "select change_priority('$P1','High','trying to override GM')"
err "sic1 cannot override GM" "set by a General Manager" sic1 "select change_priority('$P1','High','trying to override GM')"
for f in "start_exception('$P1')" "resolve_exception('$P1','not a GM job')" "decline_closure('$P1','not a GM job')" "reopen_exception('$P1','not a GM job')"; do err "gm1 cannot ${f%%(*}" "cannot" gm1 "select $f"; done
val "priority history kept: reported priority unchanged" "Medium" postgres "select reported_priority from shift_exceptions where id='$P1'"

echo "=== M. HISTORY cannot be edited or deleted"
ID=$($PSQL -c "select id from exception_remarks limit 1")
for t in exception_remarks exception_audit; do
  err "signed-in cannot UPDATE $t" "$DENY" sic1 "update $t set id=id"
  err "signed-in cannot DELETE $t" "$DENY" gm1 "delete from $t"
  err "owner cannot UPDATE $t (append-only trigger)" "append-only" postgres "update $t set created_at=created_at"
  err "owner cannot DELETE $t (append-only trigger)" "append-only" postgres "delete from $t"
  err "owner cannot TRUNCATE $t (append-only trigger)" "append-only" postgres "truncate $t"
done
val "audit recorded the maker-checker refusals? (refusals leave NO audit line)" "0" postgres "select count(*) from exception_audit where action in ('resolved','closure_declined') and actor_name='__none__'"
echo "PASS=$PASS FAIL=$FAIL"
