# A production database

Three scripts, run in this order on the app server, from the repository root, with the backend's virtualenv and the
production `.env` in place. Each needs `PGHOST`, `PGPORT`, `PGUSER` (a superuser or the database owner) and `PGDATABASE`;
the owner's password comes from `PGPASSWORD` or `~/.pgpass`. No password is ever written into a script or printed.

| Step | Script | What it does |
|---|---|---|
| 1 | `build_production_db.sh` | The extensions, the login roles `cep_backend` (API) and `cep_platform` (back-office), whose passwords it asks for, the five schema layers **without** the sample data, the record of the patches they contain, and Django's own tables. It refuses a database that already has tables. |
| 2 | `load_reference_data.sh <email> [name]` | The production settings (`reference_data.sql`: staff must use two-step verification, people are told about platform access, the public address from `CEP_PUBLIC_URL`), then the **Platform** workspace and its first platform administrator, whose password it asks for. Safe to run again. |
| 3 | `load_demo_data.sh <file> [code] [name] [plan]` | Optional: the demo workspace, from a file exported on the dev server with `run_tenant_operation --tenant NWA --operation EXPORT_FOR_COPY` (or the back-office's Move and Offboard). Checked first, loaded in one transaction, every table's row count compared; people disabled with placeholder addresses; secrets are not in the file. |

Then `psql -X -f database/production/verify.sql` checks the result and lists what is there.

```bash
# as a superuser, once
psql -d postgres -c "CREATE DATABASE cep_db TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'en-US' LOCALE 'C'"

export PGHOST=<db host> PGPORT=5432 PGUSER=postgres PGDATABASE=cep_db
export PYTHON=/opt/cep/backend/.venv/bin/python DJANGO_SETTINGS_MODULE=config.settings.production
bash database/production/build_production_db.sh
CEP_PUBLIC_URL=https://<production address> bash database/production/load_reference_data.sh platform@aiintelekt.com "Platform Admin"
psql -X -f database/production/verify.sql
```

`DATABASE_URL` and `PLATFORM_DATABASE_URL` in `.env` use `cep_backend` and `cep_platform` with the passwords typed in step 1.
After step 2, sign in at `/admin/` and set up two-step verification at once: production requires it for staff.

## Later patches

The reference data the code relies on (the permissions, the plans with the Insights-only plan, the platform settings and
industry profiles) is part of the layers, so every installation has it. New patches are applied, before the services
restart, with

```bash
bash database/apply_patch.sh 0073_<name>.sql
```

which runs the patch in one transaction as the owner and records it in `schema_patch`. `SELECT * FROM schema_patch ORDER BY
name` shows what a database has: `BUILD` for the patches its layers already held, `PATCH` for each one applied since.
