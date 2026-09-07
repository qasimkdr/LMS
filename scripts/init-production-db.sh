#!/usr/bin/env bash
set -euo pipefail

SCHEMA="packages/database/prisma/schema.prisma"
MIGRATIONS="packages/database/prisma/migrations"

if [[ "${INIT_PRODUCTION_DB:-false}" != "true" ]]; then
  echo "Production DB initialization disabled (INIT_PRODUCTION_DB != true)."
  exit 0
fi

if [[ -z "${DIRECT_URL:-}" ]]; then
  echo "DIRECT_URL is required for production database initialization." >&2
  exit 1
fi

# Never run schema bootstrap through a transaction-pooler URL.
export DATABASE_URL="${DIRECT_URL}"

echo "Initializing Nexora production database..."
echo "Step 1/2: synchronizing Prisma-managed core schema."
npx prisma db push --skip-generate --schema "${SCHEMA}"

echo "Step 2/2: applying operational SQL migrations in repository order."
while IFS= read -r migration; do
  echo "Applying ${migration}"
  npx prisma db execute --schema "${SCHEMA}" --file "${migration}"
done < <(find "${MIGRATIONS}" -mindepth 2 -maxdepth 2 -name migration.sql | sort)

echo "Nexora production database initialization completed."
echo "Security/operations action required: set INIT_PRODUCTION_DB=false (or remove it) after this successful first deployment."
