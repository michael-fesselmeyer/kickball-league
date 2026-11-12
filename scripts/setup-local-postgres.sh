#!/usr/bin/env bash
# Creates a throwaway local database that matches CI's Migrations job, then
# applies every migration. Safe to run again: existing roles and databases are
# reused, and drizzle-kit only applies migrations that are still pending.
#
#   scripts/setup-local-postgres.sh
#   export DATABASE_URL=postgresql://ci:ci@localhost:5432/ci
#   npm run test:db
#
# Override any of these to use other names (the defaults match CI):
#   PGUSER_NAME, PGPASSWORD_VALUE, PGDATABASE_NAME, PGHOST_NAME, PGPORT_NUMBER
# By default the script connects as the `postgres` superuser through the local
# socket (with sudo when not root). Set PG_SUPERUSER_URL to connect another way,
# for example postgresql://postgres:postgres@localhost:5432/postgres for Docker.
set -euo pipefail

role="${PGUSER_NAME:-ci}"
password="${PGPASSWORD_VALUE:-ci}"
database="${PGDATABASE_NAME:-ci}"
host="${PGHOST_NAME:-localhost}"
port="${PGPORT_NUMBER:-5432}"
url="postgresql://${role}:${password}@${host}:${port}/${database}"

cd "$(dirname "$0")/.."

# psql as a superuser, whichever way this machine allows.
admin_psql() {
  if [[ -n "${PG_SUPERUSER_URL:-}" ]]; then
    psql "$PG_SUPERUSER_URL" "$@"
  elif [[ "$(id -u)" -eq 0 ]] && id postgres >/dev/null 2>&1; then
    runuser -u postgres -- psql -p "$port" "$@"
  elif id postgres >/dev/null 2>&1 && command -v sudo >/dev/null 2>&1; then
    sudo -u postgres psql -p "$port" "$@"
  else
    # Homebrew and Postgres.app make the current user a superuser.
    psql -p "$port" -d postgres "$@"
  fi
}

if ! command -v psql >/dev/null 2>&1; then
  echo "psql not found. Install PostgreSQL (e.g. apt-get install postgresql) and run this again." >&2
  exit 1
fi

# Start a stopped local server where the system has a service for it.
if ! pg_isready -q -h "$host" -p "$port"; then
  if command -v service >/dev/null 2>&1 && [[ "$(id -u)" -eq 0 ]]; then
    service postgresql start
  elif command -v service >/dev/null 2>&1 && command -v sudo >/dev/null 2>&1; then
    sudo service postgresql start
  fi
  for _ in $(seq 1 20); do
    pg_isready -q -h "$host" -p "$port" && break
    sleep 0.5
  done
  if ! pg_isready -q -h "$host" -p "$port"; then
    echo "Postgres is not accepting connections on ${host}:${port}. Start it and run this again." >&2
    exit 1
  fi
fi

echo "Creating role '${role}' and database '${database}' if they are missing"
admin_psql -v ON_ERROR_STOP=1 -q \
  -v role="$role" -v password="$password" -v database="$database" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN', :'role')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'role') \gexec
SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', :'role', :'password') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'database', :'role')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'database') \gexec
SQL

echo "Applying migrations"
DATABASE_URL="$url" npm run --silent db:migrate

cat <<EOF

Ready. Point the database tests at it with:

  export DATABASE_URL=${url}
  npm run test:db
EOF
