#!/usr/bin/env bash
# Applies one patch from database/patches as the database owner, in a single transaction, and records it in schema_patch:
#   PGHOST=... PGPORT=... PGUSER=<owner> PGDATABASE=cep_db database/apply_patch.sh 0072_production_reference.sql
# The password comes from PGPASSWORD or ~/.pgpass, never from the command line. A patch already recorded is not run again
# unless --again is given (every patch is idempotent, so running one twice is safe; the record says when it last ran).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
name="${1:?usage: apply_patch.sh <patch file name> [--again]}"
name="$(basename "$name")"
file="$here/patches/$name"
[ -f "$file" ] || { echo "No patch $name in $here/patches" >&2; exit 1; }

recorded=$(psql -X -tAc "SELECT to_regclass('schema_patch') IS NOT NULL AND EXISTS (SELECT 1 FROM schema_patch WHERE name = '$name')" 2>/dev/null || echo f)
if [ "$recorded" = "t" ] && [ "${2:-}" != "--again" ]; then
  echo "$name is already applied to $PGDATABASE (give --again to run it once more)."
  exit 0
fi

echo "== applying $name to $PGDATABASE on ${PGHOST:-localhost}"
(cd "$here/patches" && psql -X -q -1 -v ON_ERROR_STOP=1 -f "$name")
psql -X -q -v ON_ERROR_STOP=1 -c "INSERT INTO schema_patch (name, how) VALUES ('$name', 'PATCH')
                                   ON CONFLICT (name) DO UPDATE SET applied_at = now(), applied_by = current_user, how = 'PATCH'"
echo "== $name applied and recorded"
