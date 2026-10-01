#!/bin/bash
source "$(dirname "${BASH_SOURCE[0]:-$0}")/env.sh"

S=$LIB
PSQL="psql -h $MS_PGHOST -p $MS_PGPORT -U postgres -q -At -d ms"
declare -A UID_
for e in overman1 overman2 sic1 sic2 manager1 manager2 po1 gm1; do UID_[$e]=$($PSQL -c "select id from auth.users where email='$e@example.com'"); done
PASS=0; FAIL=0
run() { # user sql  -> prints output/error
  local u=$1; shift; local sql="$*"
  if [ "$u" = anon ]; then $PSQL -c "set role anon; $sql" 2>&1
  elif [ "$u" = postgres ]; then $PSQL -c "$sql" 2>&1
  else $PSQL -c "set role authenticated; select set_config('request.jwt.claim.sub','${UID_[$u]}',false); $sql" 2>&1 | grep -v '^[0-9a-f-]\{36\}$'; fi
}
ok()  { local l=$1; shift; local out; out=$(run "$@"); if echo "$out" | grep -qi "error"; then echo "FAIL  $l  -> $out"; FAIL=$((FAIL+1)); else echo "pass  $l"; PASS=$((PASS+1)); fi; }
err() { local l=$1 pat=$2; shift 2; local out; out=$(run "$@"); if echo "$out" | grep -qi "error.*$pat"; then echo "pass  $l"; PASS=$((PASS+1)); else echo "FAIL  $l (wanted error '$pat') -> $out"; FAIL=$((FAIL+1)); fi; }
val() { local l=$1 want=$2; shift 2; local out; out=$(run "$@" | tail -1); if [ "$out" = "$want" ]; then echo "pass  $l"; PASS=$((PASS+1)); else echo "FAIL  $l (wanted '$want') got '$out'"; FAIL=$((FAIL+1)); fi; }
