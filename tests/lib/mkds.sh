#!/bin/bash
source "$(dirname "${BASH_SOURCE[0]:-$0}")/env.sh"

# usage: mkds.sh N HR NIGHT   (rebuilds the scratch database and loads exactly N exceptions)
S=$LIB; cd $LIB
F04=$R/04-auth-foundation.sql LOCK=real bash $LIB/rebuild.sh 2>&1 | grep -v NOTICE | tail -1
psql -h $MS_PGHOST -p $MS_PGPORT -U postgres -q -d ms -v ON_ERROR_STOP=1 -v N=$1 -v HR=$2 -v NIGHT=$3 -f $FIX/ds.sql 2>&1 | grep -v "NOTICE\|setseed\|^---\|^ *$\|row\|^(" | head -5
psql -h $MS_PGHOST -p $MS_PGPORT -U postgres -At -d ms -c "select count(*) from shift_exceptions" | sed 's/^/rows: /'
