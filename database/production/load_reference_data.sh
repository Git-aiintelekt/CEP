#!/usr/bin/env bash
# The second step on a new production database, after build_production_db.sh: the production settings
# (reference_data.sql), then the Platform workspace and the first platform administrator, whose password is typed in here.
# No customers and no demo data: production workspaces are created in the back-office, the demo by load_demo_data.sh.
#
#   PGHOST=... PGPORT=5432 PGUSER=postgres PGDATABASE=cep_db \
#   PYTHON=/opt/cep/backend/.venv/bin/python DJANGO_SETTINGS_MODULE=config.settings.production \
#   CEP_PUBLIC_URL=https://c360.example.com \
#   bash database/production/load_reference_data.sh platform@aiintelekt.com "Platform Admin"
#
# The administrator command runs with the app's own settings (.env), on the back-office login. Safe to run again: the
# settings are set to the same values, and an administrator that exists keeps its password unless one is typed.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
email="${1:?usage: load_reference_data.sh <administrator email> [display name]}"
name="${2:-Platform Admin}"
: "${PGDATABASE:?set PGDATABASE (and PGHOST, PGPORT, PGUSER) to the production database}"
: "${DJANGO_SETTINGS_MODULE:?set DJANGO_SETTINGS_MODULE (config.settings.production on a server)}"
PYTHON="${PYTHON:-python}"

built=$(psql -X -tAc "SELECT to_regclass('schema_patch') IS NOT NULL")
[ "$built" = "t" ] || { echo "$PGDATABASE was not built by build_production_db.sh (no schema_patch table)." >&2; exit 1; }

echo "== production settings"
psql -X -q -v ON_ERROR_STOP=1 -v public_url="${CEP_PUBLIC_URL:-}" -f "$here/reference_data.sql"

echo "== the Platform workspace and $email"
cd "$here/../../backend"
"$PYTHON" manage.py create_platform_admin "$email" --name "$name" ${CEP_ADMIN_NO_PASSWORD:+--no-password}
