#!/bin/sh
# Web container entrypoint: apply database migrations (as the schema owner,
# MIGRATION_DATABASE_URL), then serve the app.
set -e
node_modules/.bin/prisma migrate deploy
echo "✔ Migrations applied"
exec node_modules/.bin/next start -H 0.0.0.0 -p "${PORT:-3000}"
