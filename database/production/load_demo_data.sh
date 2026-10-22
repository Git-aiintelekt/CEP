#!/usr/bin/env bash
# The demo workspace: loads a workspace exported on another installation (the dev server's NWA, with EXPORT_FOR_COPY) into
# this database under a new code and name. Optional, after build_production_db.sh and load_reference_data.sh.
#
#   on the dev server:  python manage.py run_tenant_operation --tenant NWA --operation EXPORT_FOR_COPY
#                       (or Tenants -> Move and Offboard -> EXPORT_FOR_COPY in the back-office); copy the .c360ws.zip across
#   here:               PGHOST=... PGPORT=5432 PGUSER=postgres PGDATABASE=cep_db \
#                       PYTHON=/opt/cep/app/backend/.venv/bin/python DJANGO_SETTINGS_MODULE=config.settings.production \
#                       bash database/production/load_demo_data.sh NWA-<stamp>.c360ws.zip [DEMO] ["C360 Demo"] [INSIGHTS]
#
# Everything is checked before anything changes, and the load is one transaction. The people come across disabled with
# placeholder addresses; secrets are not in the file, so the workspace's keys are entered again here.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
archive="$(cd "$(dirname "${1:?usage: load_demo_data.sh <file> [code] [name] [plan]}")" && pwd)/$(basename "$1")"
code="${2:-DEMO}"
name="${3:-C360 Demo}"
plan="${4:-INSIGHTS}"
: "${PGDATABASE:?set PGDATABASE (and PGHOST, PGPORT, PGUSER) to the production database}"
: "${DJANGO_SETTINGS_MODULE:?set DJANGO_SETTINGS_MODULE (config.settings.production on a server)}"
PYTHON="${PYTHON:-python}"
# the load copies rows with triggers off, which needs the owner; its password stays in PGPASSWORD / ~/.pgpass
export OWNER_DATABASE_URL="${OWNER_DATABASE_URL:-postgres://${PGUSER:-postgres}@${PGHOST:-localhost}:${PGPORT:-5432}/${PGDATABASE}}"

cd "$here/../../backend"
"$PYTHON" manage.py import_workspace "$archive" --code "$code" --name "$name" --plan "$plan" --check
"$PYTHON" manage.py import_workspace "$archive" --code "$code" --name "$name" --plan "$plan"
