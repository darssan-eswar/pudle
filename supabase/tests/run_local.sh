#!/usr/bin/env bash
# Runs the Supabase policy tests against throwaway local PostgreSQL databases.
# Never point this at a populated or hosted Supabase project.
# Usage: supabase/tests/run_local.sh   (needs psql/createdb for a local superuser)
set -euo pipefail
cd "$(dirname "$0")"
PSQL=${PSQL:-psql}
status=0
for test in convoy_rls.psql hazard_events.psql; do
  db="pudle_test_$$_${test%%.*}"
  createdb "$db"
  # Roles are cluster-wide; recreate them so each file starts clean.
  $PSQL -q -d "$db" -c "drop role if exists anon; drop role if exists authenticated;" >/dev/null 2>&1 || true
  if $PSQL -q -X -d "$db" -f "$test" >"/tmp/$db.log" 2>&1; then
    echo "PASS $test: $(grep -E 'checks passed' "/tmp/$db.log" | tr -s ' ' | head -1)"
  else
    echo "FAIL $test"; tail -20 "/tmp/$db.log"; status=1
  fi
  dropdb "$db"
  $PSQL -q -d postgres -c "drop role if exists anon; drop role if exists authenticated;" >/dev/null 2>&1 || true
done
exit $status
