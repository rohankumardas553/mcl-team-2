source "$(dirname "${BASH_SOURCE[0]:-$0}")/../lib/env.sh"

S=$LIB; D=$MS_PGHOST; R=$R
P="psql -h $D -p $MS_PGPORT -U postgres -At -d ms"
LOCK=none bash $LIB/rebuild.sh 2>&1 | grep -v NOTICE
snap(){ for t in shift_exceptions exception_audit exception_remarks profiles; do $P -c "select md5(coalesce(string_agg(x::text,'|' order by x::text),'')) from $t x"; done | tr '\n' ' '; }
SCHEMA="select md5(string_agg(table_name||'.'||column_name||':'||data_type, ',' order by table_name, ordinal_position)) from information_schema.columns where table_schema='public'"
B=$(snap); SB=$($P -c "$SCHEMA"); TB=$($P -c "select count(*) from information_schema.tables where table_schema='public'")
echo "--- BEFORE 07 (old open site): anon insert works? $(psql -h $D -p $MS_PGPORT -U postgres -q -At -d ms -c "set role anon; insert into shift_exceptions(shift,location,category,issue_type,description,impact_minutes,urgency,status) values ('First','Siding 1','Coal Despatch','Weather','pre-lockdown old page',5,'Low','Open') returning 'yes'" 2>&1 | head -1)"
B=$(snap)
echo "--- running 07"; psql -h $D -p $MS_PGPORT -U postgres -q -d ms -v ON_ERROR_STOP=1 -f $R/07-lockdown.sql >/tmp/07out1.txt 2>&1 && echo "07 ran without error" || echo "07 FAILED"
grep -c NOTICE /tmp/07out1.txt | sed 's/^/notices on first run: /'
A=$(snap); SA=$($P -c "$SCHEMA"); TA=$($P -c "select count(*) from information_schema.tables where table_schema='public'")
[ "$B" = "$A" ] && echo "DATA in all 4 tables identical before/after 07: YES" || echo "DATA CHANGED BY 07 (BAD)"
[ "$SB" = "$SA" ] && echo "table columns identical: YES" || echo "COLUMNS CHANGED (BAD)"
[ "$TB" = "$TA" ] && echo "no table dropped or added: YES ($TA tables)" || echo "TABLE COUNT CHANGED (BAD)"
psql -h $D -p $MS_PGPORT -U postgres -q -d ms -v ON_ERROR_STOP=1 -f $R/07-lockdown.sql >/tmp/07out2.txt 2>&1 && echo "07 SECOND run without error" || echo "07 second run FAILED"
grep -c "NOTICE" /tmp/07out2.txt | sed 's/^/notices on second run (want 0): /'
echo "verification summary lines: OK=$(grep -c '| OK' /tmp/07out2.txt) PROBLEM=$(grep -c 'PROBLEM' /tmp/07out2.txt)"
