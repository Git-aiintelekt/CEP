#!/usr/bin/env bash
# Builds an EMPTY production database: extensions, the login roles, the five schema layers WITHOUT the sample data, the
# record of the patches they contain, and Django's own tables. No workspace, no user, no demo: load_reference_data.sh comes
# next, and load_demo_data.sh only where a demo workspace is wanted.
#
#   1. As a superuser, create the database with ICU collation (lists sort as people expect):
#        CREATE DATABASE cep_db TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'en-US' LOCALE 'C';
#   2. From the repository root on the app server, with the backend's virtualenv and production .env in place:
#        PGHOST=... PGPORT=5432 PGUSER=postgres PGDATABASE=cep_db \
#        PYTHON=/opt/cep/backend/.venv/bin/python DJANGO_SETTINGS_MODULE=config.settings.production \
#        bash database/production/build_production_db.sh
#
# PGUSER is a superuser or the database owner; its password comes from PGPASSWORD or ~/.pgpass. The passwords of the two
# login roles the app uses (cep_backend for the API, cep_platform for the back-office) are asked for here and typed in,
# unless CEP_APP_PASSWORD / CEP_PLATFORM_PASSWORD are set (CI). They go into the database, and into DATABASE_URL and
# PLATFORM_DATABASE_URL in .env; this script never prints them. It refuses a database that already has tables.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
db="$(cd "$here/.." && pwd)"
: "${PGDATABASE:?set PGDATABASE (and PGHOST, PGPORT, PGUSER) to the new, empty database}"
: "${DJANGO_SETTINGS_MODULE:?set DJANGO_SETTINGS_MODULE (config.settings.production on a server)}"
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"     # the layers' "already exists, skipping" notices are expected
run() { echo "== $1"; psql -X -q -v ON_ERROR_STOP=1 -f "$db/$1"; }

ask() {   # ask <variable> <what it is for>: read a password twice without showing it, unless the variable is already set
  local var="$1" first second
  if [ -n "${!var:-}" ]; then return; fi
  while true; do
    read -r -s -p "Password for $2: " first; echo
    read -r -s -p "Again: " second; echo
    if [ -z "$first" ]; then echo "A password is needed." >&2; continue; fi
    if [ "$first" != "$second" ]; then echo "They differ; once more." >&2; continue; fi
    if [ "${#first}" -lt 16 ]; then echo "Use at least 16 characters." >&2; continue; fi
    printf -v "$var" '%s' "$first"; export "${var?}"; return
  done
}

tables=$(psql -X -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")
if [ "$tables" != "0" ]; then
  echo "The database $PGDATABASE already has $tables tables: this script only builds an empty one." >&2
  exit 1
fi

ask CEP_APP_PASSWORD "cep_backend (the API's login)"
ask CEP_PLATFORM_PASSWORD "cep_platform (the back-office's login)"

psql -X -q -v ON_ERROR_STOP=1 \
     -v app_password="$CEP_APP_PASSWORD" -v platform_password="$CEP_PLATFORM_PASSWORD" <<'SQL'
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cep_app') THEN CREATE ROLE cep_app NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cep_admin') THEN CREATE ROLE cep_admin NOLOGIN BYPASSRLS; END IF;
END $$;
SELECT format('CREATE ROLE cep_backend LOGIN PASSWORD %L IN ROLE cep_app', :'app_password')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cep_backend') \gexec
SELECT format('CREATE ROLE cep_platform LOGIN BYPASSRLS PASSWORD %L IN ROLE cep_admin', :'platform_password')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cep_platform') \gexec
SQL

run CEP_Database_Schema.sql
run CEP_Database_Schema_Enterprise_Hardening.sql
run CEP_Database_Schema_SaaS_Tenancy.sql
run CEP_Database_Schema_Hybrid_Services.sql
run CEP_Database_Schema_Platform_Operations.sql

# the layers already hold every patch: record them, so apply_patch.sh starts from the next one
echo "== recording the patches the layers contain"
for file in "$db"/patches/*.sql; do
  psql -X -q -v ON_ERROR_STOP=1 -c "INSERT INTO schema_patch (name, how) VALUES ('$(basename "$file")', 'BUILD') ON CONFLICT (name) DO NOTHING"
done

echo "== Django's tables"
owner_url="postgres://${PGUSER:-postgres}@${PGHOST:-localhost}:${PGPORT:-5432}/${PGDATABASE}"   # the password stays in PGPASSWORD / ~/.pgpass
DATABASE_URL="$owner_url" PLATFORM_DATABASE_URL="$owner_url" bash "$db/prepare_django_tables.sh"

echo "== built $PGDATABASE: $(psql -X -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'") tables, \
$(psql -X -tAc "SELECT count(*) FROM permission") permissions, plans $(psql -X -tAc "SELECT string_agg(code, ', ' ORDER BY code) FROM subscription_plan"), \
$(psql -X -tAc "SELECT count(*) FROM schema_patch") patches recorded, $(psql -X -tAc "SELECT count(*) FROM tenant") workspaces"
echo "Next: bash database/production/load_reference_data.sh"
