#!/usr/bin/env bash
# After database/build_test_db.sh: Django's own tables (users' groups and permissions, content types, sessions, the admin log)
# and the record of the app's migrations. The SQL layers are the app's schema, so its migrations are marked as applied
# (--fake), never run. Needs DATABASE_URL and PLATFORM_DATABASE_URL pointing at a superuser login of the new database, and
# PGHOST/PGPORT/PGUSER/PGDATABASE for the grant. Run from backend/ with the virtualenv's python as $PYTHON.
set -euo pipefail
PYTHON="${PYTHON:-python}"

"$PYTHON" manage.py migrate contenttypes --noinput
"$PYTHON" manage.py migrate auth --noinput
for app in $("$PYTHON" -c "import django, os; os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.test'); django.setup(); from django.apps import apps; import importlib.util as u; print(' '.join(a.label for a in apps.get_app_configs() if a.name.startswith('apps.') and u.find_spec(a.name + '.migrations')))"); do
  "$PYTHON" manage.py migrate "$app" --fake --noinput
done
"$PYTHON" manage.py migrate --noinput

# the back-office role uses Django's tables, as on the servers
psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE t TEXT;
BEGIN
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename ~ '^(auth_|django_)' LOOP
        EXECUTE format('GRANT ALL ON %I TO cep_admin', t);
    END LOOP;
    FOR t IN SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' AND sequencename ~ '^(auth_|django_)' LOOP
        EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %I TO cep_admin', t);
    END LOOP;
END $$;
SQL
echo "== Django tables ready"
