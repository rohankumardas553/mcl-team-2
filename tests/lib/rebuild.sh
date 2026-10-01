source "$(dirname "${BASH_SOURCE[0]:-$0}")/env.sh"

# Rebuilds the scratch database 'ms': 01-03 demo state, 8 fictional users, 04, 05, 06 (and 07 lockdown when LOCK=real).
# usage: LOCK=none|real [F04=path/to/04.sql] bash tests/lib/rebuild.sh   (F04=tests/fixtures/04-pre-ist.sql gives a live-like database from before the IST work)
D=$MS_PGHOST; S=$LIB; R=$R
P="psql -h $D -p $MS_PGPORT -U postgres -v ON_ERROR_STOP=1 -q"
$P -f $FIX/pg_setup.sql 2>&1 | grep -v NOTICE; $P -d ms -f $FIX/emu.sql && $P -d ms -f $R/01-setup.sql && $P -d ms -f $R/02-live-test-rows.sql && $P -d ms -f $R/03-new-category-demo-rows.sql
$P -d ms -c "insert into auth.users(email) values ('overman1@example.com'),('overman2@example.com'),('sic1@example.com'),('sic2@example.com'),('manager1@example.com'),('manager2@example.com'),('po1@example.com'),('gm1@example.com'),('ghost@example.com'),('off@example.com')"
F04=${F04:-$R/04-auth-foundation.sql}; $P -d ms -f $F04 >/dev/null 2>&1 && $P -d ms -f $R/05-location-renames.sql >/dev/null 2>&1 && $P -d ms -f $R/06-closure-confirmation-fix.sql >/dev/null 2>&1 || echo "MIGRATION FAILED"
if [ -z "$SKIP06" ]; then :; fi
$P -d ms -c "insert into profiles(user_id, full_name, role, active) select id,'Switched Off','overman',false from auth.users where email='off@example.com'"

if [ "$LOCK" = real ]; then $P -d ms -f $R/07-lockdown.sql >/dev/null 2>&1 && echo '07 applied' || echo '07 FAILED'; fi
