#!/bin/bash
# Creates and starts a scratch Postgres cluster for the tests (once). Needs Postgres 14+ binaries (initdb, pg_ctl, psql).
# usage: bash tests/lib/setup-scratch-db.sh [start|stop]
source "$(dirname "${BASH_SOURCE[0]:-$0}")/env.sh"
BIN="${PG_BIN:-$(dirname "$(ls /usr/lib/postgresql/*/bin/initdb 2>/dev/null | tail -1)")}"
[ -x "$BIN/initdb" ] || BIN="$(dirname "$(command -v initdb)")"
D="$MS_PGHOST"
RUNAS=""; [ "$(id -u)" = 0 ] && RUNAS="su postgres -c"
run() { if [ -n "$RUNAS" ]; then $RUNAS "$*"; else bash -c "$*"; fi; }
case "${1:-start}" in
  stop)  run "$BIN/pg_ctl -D $D/data stop -m fast" ;;
  start)
    mkdir -p "$D"; [ -n "$RUNAS" ] && chown postgres "$D"
    [ -d "$D/data" ] || run "$BIN/initdb -D $D/data -A trust >/dev/null"
    run "$BIN/pg_ctl -D $D/data -o '-p $MS_PGPORT -k $D' -l $D/log -w start" ;;
esac
