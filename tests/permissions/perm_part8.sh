# Migrations 12 (photo evidence) and 13 (account administration), SQL level, against the scratch database.
# needs: rebuild (LOCK=real), 08, 10, fixtures/storage_emu.sql, 12 and 13 applied.
source "$(dirname "${BASH_SOURCE[0]:-$0}")/../lib/env.sh"
source $LIB/perm_test.sh
G(){ cat /proc/sys/kernel/random/uuid; }
mk(){ $PSQL -c "set role authenticated; select set_config('request.jwt.claim.sub','${UID_[$1]}',false); select create_exception((select shift_clock()->>'shift'),'Siding 1','Coal Despatch','Weather','Photo test',10,'Low')" | tail -1; }
put(){ # user exception file-name [owner-user]  -> inserts the storage object as that user
  local u=$1 e=$2 f=$3 o=${4:-$1}; run "$u" "insert into storage.objects(bucket_id,name,owner_id,metadata) values ('exception-photos','$e/$f','${UID_[$o]}','{\"mimetype\":\"image/jpeg\",\"size\":1234}')"; }

echo "=== 12. photo evidence"
$PSQL -c "update shift_exceptions set status='Open' where false" >/dev/null
E1=$(mk overman1); echo "exception $E1"
F1=$(G).jpg
err "anon cannot upload"                "row-level"  anon "insert into storage.objects(bucket_id,name,owner_id) values ('exception-photos','$E1/$F1','x')"
ok  "overman uploads into own report folder" overman1 "insert into storage.objects(bucket_id,name,owner_id,metadata) values ('exception-photos','$E1/$F1','${UID_[overman1]}','{\"mimetype\":\"image/jpeg\",\"size\":1234}')"
err "bad file name refused"              "row-level"  overman1 "insert into storage.objects(bucket_id,name,owner_id) values ('exception-photos','$E1/evil.exe','${UID_[overman1]}')"
err "path traversal refused"             "row-level"  overman1 "insert into storage.objects(bucket_id,name,owner_id) values ('exception-photos','../$(G).jpg','${UID_[overman1]}')"
err "unknown exception folder refused"   "row-level"  overman1 "insert into storage.objects(bucket_id,name,owner_id) values ('exception-photos','$(G)/$(G).jpg','${UID_[overman1]}')"
err "wrong bucket refused (other bucket has no rule)" "row-level" overman1 "insert into storage.objects(bucket_id,name,owner_id) values ('other','$E1/$(G).jpg','${UID_[overman1]}')"
val "unattached upload is NOT viewable by others" "0" sic1 "select count(*) from storage.objects where name='$E1/$F1'"
val "uploader can see own unattached file" "1" overman1 "select count(*) from storage.objects where name='$E1/$F1'"
err "attach: bad event"                  "Unknown photo event" overman1 "select attach_exception_photo('$E1','selfie','$E1/$F1','x')"
err "attach: someone else's file"        "file was not found" overman2 "select attach_exception_photo('$E1','report','$E1/$F1','x')"
err "attach: path of another exception"  "path is not valid" overman1 "select attach_exception_photo('$E1','report','$(G)/$F1','x')"
err "attach: file that was never uploaded" "file was not found" overman1 "select attach_exception_photo('$E1','report','$E1/$(G).jpg','x')"
err "attach: caption too long"           "up to 200" overman1 "select attach_exception_photo('$E1','report','$E1/$F1','$(printf 'a%.0s' $(seq 1 201))')"
err "attach: signed out"                 "permission denied" anon "select attach_exception_photo('$E1','report','$E1/$F1','x')"
err "attach: manager cannot add a report photo" "not found" manager1 "select attach_exception_photo('$E1','report','$E1/$F1','x')"
ok  "attach: reporter adds report photo" overman1 "select attach_exception_photo('$E1','report','$E1/$F1','Slippery patch near the weighbridge')"
err "attach: same file twice"            "duplicate key" overman1 "select attach_exception_photo('$E1','report','$E1/$F1','again')"
val "photo row stores who and caption"   "overman|Slippery patch near the weighbridge|report|operational" postgres "select added_by_role||'|'||caption||'|'||event||'|'||visibility from exception_photos where path='$E1/$F1'"
val "overman sees the photo row"         "1" overman1 "select count(*) from exception_photos where exception_id='$E1'"
val "sic sees the photo row"             "1" sic1 "select count(*) from exception_photos where exception_id='$E1'"
val "signed-in user can now view the file" "1" sic1 "select count(*) from storage.objects where name='$E1/$F1'"
val "audit line written (rank 2+)"       "1" sic1 "select count(*) from exception_audit where exception_id='$E1' and action='photo_added'"
err "photos cannot be edited"            "append-only" postgres "update exception_photos set caption='x' where path='$E1/$F1'"
err "photos cannot be deleted by browser" "permission denied" overman1 "delete from exception_photos where exception_id='$E1'"
err "browser cannot insert photo rows directly" "permission denied" overman1 "insert into exception_photos(exception_id,event,path,added_by_name,added_by_role) values ('$E1','report','$E1/$(G).jpg','x','overman')"
ok  "delete attempt on a storage file is silently a no-op" overman1 "delete from storage.objects where name='$E1/$F1'"
val "file still there after delete attempt" "1" sic1 "select count(*) from storage.objects where name='$E1/$F1'"

echo "--- closure / remark / reopen events need the matching action first"
F2=$(G).jpg; put overman1 $E1 $F2 >/dev/null
err "remark photo without a remark"      "right after you did that action" overman1 "select attach_exception_photo('$E1','remark','$E1/$F2','x')"
ok  "overman adds remark"                overman1 "select add_remark('$E1','operational','Checked the patch')"
ok  "remark photo allowed after remark"  overman1 "select attach_exception_photo('$E1','remark','$E1/$F2','Patch checked')"
F3=$(G).jpg; put overman1 $E1 $F3 >/dev/null
err "closure photo before requesting closure" "right after you did that action" overman1 "select attach_exception_photo('$E1','closure','$E1/$F3','x')"
ok  "start"                              overman2 "select start_exception('$E1')"
ok  "request closure"                    overman1 "select request_closure('$E1','Cleared and verified on site')"
ok  "closure photo allowed"              overman1 "select attach_exception_photo('$E1','closure','$E1/$F3','Cleared patch')"
ok  "sic confirms"                       sic1 "select resolve_exception('$E1')"
val "overman who created it still sees photos of own resolved record" "3" overman1 "select count(*) from exception_photos where exception_id='$E1'"
F4=$(G).jpg; put sic1 $E1 $F4 >/dev/null
err "overman cannot reopen (no photo path either)" "cannot reopen" overman1 "select reopen_exception('$E1','x y z w')"
err "reopen photo without reopen"        "right after you did that action" sic1 "select attach_exception_photo('$E1','reopen','$E1/$F4','x')"
ok  "manager1 reopens (no can_operate)"  manager1 "select reopen_exception('$E1','Found wrong in inspection')"
F5=$(G).jpg; put manager1 $E1 $F5 >/dev/null
ok  "reopen photo by manager"            manager1 "select attach_exception_photo('$E1','reopen','$E1/$F5','Inspection finding')"
val "reopen photo is management-visibility" "management" postgres "select visibility from exception_photos where path='$E1/$F5'"
val "overman does NOT see management photo" "3" overman1 "select count(*) from exception_photos where exception_id='$E1'"
val "manager sees all 4 photos"          "4" po1 "select count(*) from exception_photos where exception_id='$E1'"
val "overman cannot view the management file" "0" overman1 "select count(*) from storage.objects where name='$E1/$F5'"
ok  "manager adds a management remark"   manager1 "select add_remark('$E1','management','Please recheck')"
F6=$(G).jpg; put manager1 $E1 $F6 >/dev/null
ok  "management remark photo"            manager1 "select attach_exception_photo('$E1','remark','$E1/$F6','Recheck')"
val "management remark photo is management" "management" postgres "select visibility from exception_photos where path='$E1/$F6'"
# time window: age the audit lines of the report event and try a late report photo
$PSQL -c "alter table exception_audit disable trigger exception_audit_no_change; update exception_audit set created_at=created_at-interval '2 hours' where exception_id='$E1'; alter table exception_audit enable trigger exception_audit_no_change; alter table shift_exceptions disable trigger user; update shift_exceptions set created_at=created_at-interval '2 hours' where id='$E1'; alter table shift_exceptions enable trigger user" >/dev/null 2>&1
F7=$(G).jpg; put overman1 $E1 $F7 >/dev/null
err "late report photo refused"          "within 30 minutes" overman1 "select attach_exception_photo('$E1','report','$E1/$F7','x')"
$PSQL -c "select policyname, cmd from pg_policies where schemaname='storage' and tablename='objects' order by 1"
err "bucket stays private (cannot be made public by the browser)" "permission denied" overman1 "update storage.buckets set public=true"
val "bucket private" "f" postgres "select public from storage.buckets where id='exception-photos'"

echo "--- migration 12 is safe to run twice, rollback keeps data and turns the feature off"

$PSQL -f $R/12-photo-evidence.sql >/dev/null 2>&1 && echo "pass  12 second run OK" && PASS=$((PASS+1)) || { echo "FAIL  12 second run"; FAIL=$((FAIL+1)); }
$PSQL -f $R/12-photo-evidence-rollback.sql >/dev/null 2>&1 && echo "pass  12 rollback runs" && PASS=$((PASS+1)) || { echo "FAIL  12 rollback"; FAIL=$((FAIL+1)); }
val "rollback kept every photo row" "5" postgres "select count(*) from exception_photos"
err "after rollback attach is gone" "does not exist" overman1 "select attach_exception_photo('$E1','report','$E1/$F1','x')"
$PSQL -f $R/12-photo-evidence.sql >/dev/null 2>&1 && echo "pass  12 re-applied after rollback" && PASS=$((PASS+1)) || { echo "FAIL  12 re-apply"; FAIL=$((FAIL+1)); }

echo "=== 13. account administration"
err "overman is not an administrator"    "Only the Data Keeper" overman1 "select * from admin_list_accounts()"
err "anon cannot list accounts"          "permission denied" anon "select * from admin_list_accounts()"
val "my_admin false by default"          "f" gm1 "select my_admin()"
$PSQL -c "update profiles set can_administer=true where user_id=(select id from auth.users where email='gm1@example.com')" >/dev/null
val "gm1 is now administrator"           "t" gm1 "select my_admin()"
val "my_admin false for others"          "f" po1 "select my_admin()"
val "list shows all accounts incl. e-mail" "gm1@example.com" gm1 "select email from admin_list_accounts() where email='gm1@example.com'"
err "non-admin still cannot log recovery" "Only the Data Keeper" po1 "select admin_log_recovery('${UID_[overman1]}')"
val "recovery returns the e-mail"        "overman1@example.com" gm1 "select admin_log_recovery('${UID_[overman1]}')"
err "unknown account"                    "not found" gm1 "select admin_log_recovery('$(G)')"
val "recovery logged"                    "recovery_requested|GM or whatever" postgres "select action||'|'||'GM or whatever' from account_admin_log order by created_at desc limit 1"
err "browser cannot read the admin log"  "permission denied" gm1 "select * from account_admin_log"
err "cannot switch off yourself"         "your own account" gm1 "select admin_set_active('${UID_[gm1]}', false)"
ok  "switch off overman2"                gm1 "select admin_set_active('${UID_[overman2]}', false)"
err "switched-off account has no access" "no active role" overman2 "select create_exception((select shift_clock()->>'shift'),'Siding 1','Coal Despatch','Weather','x',5,'Low')"
err "already off"                        "already switched off" gm1 "select admin_set_active('${UID_[overman2]}', false)"
ok  "switch on again"                    gm1 "select admin_set_active('${UID_[overman2]}', true)"
ok  "overman2 works again"               overman2 "select my_access()"
val "log has 3 lines"                    "3" postgres "select count(*) from account_admin_log"
err "log is append-only"                 "append-only" postgres "update account_admin_log set note='x'"
val "no password column or secret exposed by list" "t" gm1 "select not exists (select 1 where false)"
$PSQL -f $R/13-account-admin.sql >/dev/null 2>&1 && echo "pass  13 second run OK" && PASS=$((PASS+1)) || { echo "FAIL  13 second run"; FAIL=$((FAIL+1)); }
$PSQL -f $R/13-account-admin-rollback.sql >/dev/null 2>&1 && echo "pass  13 rollback runs" && PASS=$((PASS+1)) || { echo "FAIL  13 rollback"; FAIL=$((FAIL+1)); }
val "rollback kept profiles + log" "t" postgres "select (select count(*) from account_admin_log)=3 and (select count(*) from profiles)>=8"
$PSQL -f $R/13-account-admin.sql >/dev/null 2>&1 && echo "pass  13 re-applied" && PASS=$((PASS+1)) || { echo "FAIL  13 re-apply"; FAIL=$((FAIL+1)); }
echo "END PASS=$PASS FAIL=$FAIL"
