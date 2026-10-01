source "$(dirname "${BASH_SOURCE[0]:-$0}")/../lib/env.sh"

source $LIB/perm_test.sh
echo "=== C. after (simulated) lockdown: visibility and lockout"
err "anon cannot read exceptions" "permission denied" anon "select * from shift_exceptions"
err "anon cannot insert" "permission denied" anon "insert into shift_exceptions(shift) values ('First')"
err "anon cannot update" "permission denied" anon "update shift_exceptions set status='Resolved'"
err "signed-in cannot insert directly" "permission denied" overman1 "insert into shift_exceptions(shift,location,category,issue_type,description,impact_minutes,urgency,status) values ('First','Siding 1','Coal Despatch','Weather','x',1,'Low','Open')"
err "signed-in cannot update directly" "permission denied" sic1 "update shift_exceptions set status='Resolved'"
err "signed-in cannot delete" "permission denied" gm1 "delete from shift_exceptions"
TOTAL=$($PSQL -c "select count(*) from shift_exceptions")
ACTIVE=$($PSQL -c "select count(*) from shift_exceptions where status <> 'Resolved'")
OV1_VISIBLE=$($PSQL -c "select count(*) from shift_exceptions where status <> 'Resolved' or created_by='${UID_[overman1]}'")
OV2_VISIBLE=$($PSQL -c "select count(*) from shift_exceptions where status <> 'Resolved' or created_by='${UID_[overman2]}'")
echo "(total=$TOTAL active=$ACTIVE overman1_expected=$OV1_VISIBLE overman2_expected=$OV2_VISIBLE)"
val "sic1 sees everything" "$TOTAL" sic1 "select count(*) from shift_exceptions"
val "manager1 sees everything" "$TOTAL" manager1 "select count(*) from shift_exceptions"
val "po1 sees everything" "$TOTAL" po1 "select count(*) from shift_exceptions"
val "gm1 sees everything" "$TOTAL" gm1 "select count(*) from shift_exceptions"
val "overman1 sees active + own history" "$OV1_VISIBLE" overman1 "select count(*) from shift_exceptions"
val "overman2 sees active + own history" "$OV2_VISIBLE" overman2 "select count(*) from shift_exceptions"
val "overman2 sees NO resolved record made by overman1" "0" overman2 "select count(*) from shift_exceptions where status='Resolved' and created_by='${UID_[overman1]}'"
val "overman1 sees his own resolved record" "t" overman1 "select count(*) > 0 from shift_exceptions where status='Resolved' and created_by='${UID_[overman1]}'"
val "overman sees no audit" "0" overman1 "select count(*) from exception_audit"
val "sic sees audit" "t" sic1 "select count(*) > 10 from exception_audit"
val "overman sees no management remarks" "0" overman1 "select count(*) from exception_remarks where kind='management'"
val "overman sees operational remarks" "t" overman1 "select count(*) > 0 from exception_remarks where kind='operational'"
val "sic sees management remarks" "t" sic1 "select count(*) > 0 from exception_remarks where kind='management'"
val "manager sees both kinds" "2" manager1 "select count(distinct kind) from exception_remarks"
val "overman sees only own profile" "1" overman1 "select count(*) from profiles"
ok  "workflow still works after lockdown: create" overman1 "select create_exception((select shift_clock()->>'shift'),'Siding 1','Coal Despatch','Weather','after lockdown',10,'Low')"
ok  "workflow still works after lockdown: start (sic)" sic1 "select start_exception((select id from shift_exceptions where description='after lockdown'))"
err "overman cannot remark on an exception he cannot see... (Resolved, not his)" "not Resolved" overman2 "select add_remark((select id from shift_exceptions where status='Resolved' and created_by='${UID_[overman1]}' limit 1),'operational','should be refused')"
echo "PASS=$PASS FAIL=$FAIL"
