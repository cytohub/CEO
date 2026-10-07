#!/bin/sh
# Runs once, when the database volume is first created: adds the restricted
# role the app connects as. It can read and write rows but not change the
# schema; tables the owner creates later (migrations) grant it access
# automatically.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set app_password="$APP_DB_PASSWORD" <<'SQL'
CREATE ROLE ceo_app LOGIN PASSWORD :'app_password';
GRANT USAGE ON SCHEMA public TO ceo_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ceo IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ceo_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ceo IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ceo_app;
SQL
