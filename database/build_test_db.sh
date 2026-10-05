#!/usr/bin/env bash
# Builds a CEP database from nothing, for CI and for a throwaway local copy:
#   PGHOST=localhost PGPORT=5432 PGUSER=postgres PGDATABASE=cep_ci database/build_test_db.sh
# It needs a superuser connection (PG* variables) to an EMPTY database, and creates the app's login roles with the
# passwords in CEP_APP_PASSWORD / CEP_PLATFORM_PASSWORD. Never point it at a database that holds data.
#
# Order, as the files' headers give it: core, enterprise hardening, SaaS tenancy, hybrid services, the sample workspace
# NWA (CEP_Seed_Data.sql), then platform operations (idempotent; it brings the database to the latest patch).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
: "${CEP_APP_PASSWORD:?set CEP_APP_PASSWORD}"
: "${CEP_PLATFORM_PASSWORD:?set CEP_PLATFORM_PASSWORD}"
run() { echo "== $1"; psql -X -q -v ON_ERROR_STOP=1 -f "$here/$1"; }

tables=$(psql -X -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")
if [ "$tables" != "0" ]; then
  echo "The database $PGDATABASE already has $tables tables: this script only builds an empty one." >&2
  exit 1
fi

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
run CEP_Seed_Data.sql
run CEP_Database_Schema_Platform_Operations.sql
echo "== built: $(psql -X -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'") tables"
