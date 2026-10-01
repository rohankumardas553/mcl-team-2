# Shared settings for every test script. Source this file; do not run it.
# SAFETY: these tests build, change and DELETE data in a SCRATCH Postgres database named "ms" reached over a LOCAL unix socket.
# NEVER RUN THESE TESTS AGAINST LIVE PRODUCTION SUPABASE DATA. The guard below refuses to run if a remote database is configured.
LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TESTS="$(cd "$LIB/.." && pwd)"
REPO="$(cd "$TESTS/.." && pwd)"
R="$REPO/database"
FIX="$TESTS/fixtures"
export MS_PGHOST="${MS_PGHOST:-/var/tmp/mspg}"
export MS_PGPORT="${MS_PGPORT:-5544}"
if [ "${MS_PGHOST:0:1}" != "/" ] || [ -n "$PGHOST$PGHOSTADDR$DATABASE_URL$SUPABASE_URL$SUPABASE_DB_URL" ]; then
  echo "REFUSING TO RUN: tests only use a local scratch Postgres over a unix socket (MS_PGHOST must be a directory path, and PGHOST / DATABASE_URL / SUPABASE_* must be unset)." >&2
  return 1 2>/dev/null || exit 1
fi
