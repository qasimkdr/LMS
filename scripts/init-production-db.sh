#!/usr/bin/env bash
set -euo pipefail

SCHEMA="packages/database/prisma/schema.prisma"
MIGRATIONS="packages/database/prisma/migrations"

if [[ "${INIT_PRODUCTION_DB:-false}" != "true" ]]; then
  echo "Production DB initialization disabled (INIT_PRODUCTION_DB != true)."
  exit 0
fi

if [[ -z "${DIRECT_URL:-}" && -z "${DATABASE_URL:-}" ]]; then
  echo "DIRECT_URL or DATABASE_URL is required for production database initialization." >&2
  exit 1
fi

ORIGINAL_DATABASE_URL="${DATABASE_URL:-}"

try_schema_sync() {
  local url="$1"
  local label="$2"
  if [[ -z "$url" ]]; then
    return 1
  fi
  echo "Trying ${label} database connection for schema synchronization..."
  DATABASE_URL="$url" npx prisma db push --skip-generate --schema "$SCHEMA"
}

echo "Initializing Nexora production database..."
echo "Step 1/2: synchronizing Prisma-managed core schema."

ACTIVE_DATABASE_URL=""
if [[ -n "${DIRECT_URL:-}" ]] && try_schema_sync "$DIRECT_URL" "DIRECT_URL"; then
  ACTIVE_DATABASE_URL="$DIRECT_URL"
elif [[ -n "$ORIGINAL_DATABASE_URL" ]]; then
  echo "DIRECT_URL was unavailable. Falling back to DATABASE_URL (pooler/session connection)."
  if try_schema_sync "$ORIGINAL_DATABASE_URL" "DATABASE_URL"; then
    ACTIVE_DATABASE_URL="$ORIGINAL_DATABASE_URL"
  fi
fi

if [[ -z "$ACTIVE_DATABASE_URL" ]]; then
  echo "Database initialization failed: neither DIRECT_URL nor DATABASE_URL could reach PostgreSQL." >&2
  exit 1
fi

export DATABASE_URL="$ACTIVE_DATABASE_URL"

echo "Step 2/2: applying operational SQL migrations in repository order."
while IFS= read -r migration; do
  echo "Applying ${migration}"
  npx prisma db execute --schema "$SCHEMA" --file "$migration"
done < <(find "$MIGRATIONS" -mindepth 2 -maxdepth 2 -name migration.sql | sort)

echo "Nexora production database initialization completed."
echo "Security/operations action required: set INIT_PRODUCTION_DB=false (or remove it) after this successful first deployment."
