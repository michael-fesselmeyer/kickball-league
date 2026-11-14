#!/usr/bin/env bash
# Backup and restore drill for the league's Postgres database.
#
# 1. Dumps the source database with pg_dump (custom format) to a file outside
#    the repository.
# 2. Restores that file into an empty scratch database with pg_restore.
# 3. Counts the rows of every table in both and fails on any difference.
#
# Steps, safety rules and what to do with the result:
# docs/launch/backup-and-restore.md
#
# Inputs (environment variables, never arguments, so no password shows up in
# the process list or shell history):
#   SOURCE_DATABASE_URL   database to back up. Defaults to DATABASE_URL.
#                         For Neon, use the direct (not "-pooler") address.
#   SCRATCH_DATABASE_URL  empty database to restore into. Its name must
#                         contain "scratch", "restore" or "drill", and it
#                         must not be the source.
#   BACKUP_DIR            where the dump is written. Default:
#                         $HOME/kickball-league-backups (outside the repo).
#   PG_TOOLS_CONTAINER    optional: run pg_dump, pg_restore and psql inside
#                         this Docker container (for example kb-local-pg),
#                         when the machine's own client is older than the
#                         server. Host names in the URLs are then resolved
#                         inside the container.
#   KEEP_DUMP             "false" deletes the dump after a passing drill.
#                         Default: keep it, as the backup.
#
# The connection strings are written to a pg_service file readable only by
# you, which is deleted when the script exits. Nothing prints a password,
# a user name or a full connection string.

set -euo pipefail
umask 077

die() {
  echo "backup-drill: $*" >&2
  exit 1
}

SOURCE_URL="${SOURCE_DATABASE_URL:-${DATABASE_URL:-}}"
SCRATCH_URL="${SCRATCH_DATABASE_URL:-}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/kickball-league-backups}"
CONTAINER="${PG_TOOLS_CONTAINER:-}"
KEEP_DUMP="${KEEP_DUMP:-true}"

[[ -n "$SOURCE_URL" ]] || die "set SOURCE_DATABASE_URL (or DATABASE_URL) to the database to back up."
[[ -n "$SCRATCH_URL" ]] || die "set SCRATCH_DATABASE_URL to an empty database to restore into."
command -v node >/dev/null || die "node is required (it reads the connection strings without printing them)."

work="$(mktemp -d)"
container_service=""
cleanup() {
  rm -rf "$work"
  if [[ -n "$CONTAINER" && -n "$container_service" ]]; then
    docker exec "$CONTAINER" rm -f "$container_service" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# Parse both URLs once, in node, into a pg_service file and a safe summary.
# The summary has host, port and database name only.
SOURCE_URL="$SOURCE_URL" SCRATCH_URL="$SCRATCH_URL" node - "$work" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const dir = process.argv[2];
function parse(name, raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    console.error(`backup-drill: ${name} is not a valid URL.`);
    process.exit(1);
  }
  if (!/^postgres(ql)?:$/.test(url.protocol)) {
    console.error(`backup-drill: ${name} must start with postgres:// or postgresql://.`);
    process.exit(1);
  }
  const db = decodeURIComponent(url.pathname.slice(1));
  if (!db) {
    console.error(`backup-drill: ${name} does not name a database.`);
    process.exit(1);
  }
  const params = Object.fromEntries(url.searchParams);
  return {
    host: url.hostname,
    port: url.port || "5432",
    dbname: db,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    sslmode: params.sslmode,
  };
}
const source = parse("SOURCE_DATABASE_URL", process.env.SOURCE_URL);
const scratch = parse("SCRATCH_DATABASE_URL", process.env.SCRATCH_URL);
const service = (name, c) =>
  [
    `[${name}]`,
    `host=${c.host}`,
    `port=${c.port}`,
    `dbname=${c.dbname}`,
    c.user && `user=${c.user}`,
    c.password && `password=${c.password}`,
    c.sslmode && `sslmode=${c.sslmode}`,
  ]
    .filter(Boolean)
    .join("\n");
fs.writeFileSync(
  path.join(dir, "pg_service.conf"),
  `${service("drill_source", source)}\n\n${service("drill_scratch", scratch)}\n`,
  { mode: 0o600 },
);
const summary = [
  `SOURCE_LABEL=${source.host}:${source.port}/${source.dbname}`,
  `SCRATCH_LABEL=${scratch.host}:${scratch.port}/${scratch.dbname}`,
  `SCRATCH_DB=${scratch.dbname}`,
  `SAME_DB=${source.host === scratch.host && source.port === scratch.port && source.dbname === scratch.dbname}`,
];
fs.writeFileSync(path.join(dir, "summary.env"), summary.join("\n") + "\n");
NODE

# shellcheck source=/dev/null
source "$work/summary.env"

[[ "$SAME_DB" == "false" ]] || die "the scratch database is the source database. Refusing."
[[ "$SCRATCH_DB" =~ (scratch|restore|drill) ]] ||
  die "the scratch database's name ($SCRATCH_DB) must contain \"scratch\", \"restore\" or \"drill\", so the drill can never restore over a real database."

service_file="$work/pg_service.conf"
if [[ -n "$CONTAINER" ]]; then
  command -v docker >/dev/null || die "PG_TOOLS_CONTAINER is set but docker is not installed."
  container_service="/tmp/backup-drill-$$-$RANDOM.conf"
  docker cp -q "$service_file" "$CONTAINER:$container_service"
  docker exec "$CONTAINER" chmod 600 "$container_service"
  pg() { docker exec -i -e PGSERVICEFILE="$container_service" "$CONTAINER" "$@"; }
else
  for tool in pg_dump pg_restore psql; do
    command -v "$tool" >/dev/null || die "$tool is not installed (see docs/launch/backup-and-restore.md)."
  done
  pg() { PGSERVICEFILE="$service_file" "$@"; }
fi

q() { pg psql "service=$1" -X -q -A -t -v ON_ERROR_STOP=1 -c "$2"; }

echo "Source:  $SOURCE_LABEL"
echo "Scratch: $SCRATCH_LABEL"

# pg_dump must be at least the server's major version.
server_major="$(q drill_source "show server_version_num")"
server_major="$((server_major / 10000))"
client_major="$(pg pg_dump --version | sed -E 's/[^0-9]*([0-9]+).*/\1/')"
if ((client_major < server_major)); then
  die "pg_dump is version $client_major but the server runs $server_major. Install a newer client or set PG_TOOLS_CONTAINER (see docs/launch/backup-and-restore.md)."
fi

scratch_tables="$(q drill_scratch "select count(*) from pg_tables where schemaname not in ('pg_catalog', 'information_schema')")"
[[ "$scratch_tables" == "0" ]] ||
  die "the scratch database already has $scratch_tables tables. Restore into an empty database (drop and recreate it)."

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dump="$BACKUP_DIR/kickball-league-$stamp.dump"

# Row counts of every table, as "schema.table|count", sorted.
count_sql="
select string_agg(format('select %L || ''|'' || count(*) from %I.%I', schemaname || '.' || tablename, schemaname, tablename), ' union all ' order by schemaname, tablename)
from pg_tables where schemaname not in ('pg_catalog', 'information_schema')"
row_counts() {
  local statement
  statement="$(q "$1" "$count_sql")"
  [[ -n "$statement" ]] || return 0
  q "$1" "$statement" | sort
}

started=$SECONDS
echo "Counting rows in the source..."
row_counts drill_source >"$work/source.txt"

echo "Dumping to $dump ..."
pg pg_dump "service=drill_source" --format=custom --no-owner --no-privileges --no-comments >"$dump"
dumped=$SECONDS

echo "Restoring into the scratch database..."
pg pg_restore --dbname="service=drill_scratch" --no-owner --no-privileges --exit-on-error <"$dump"
restored=$SECONDS

echo "Counting rows in the restored copy..."
row_counts drill_scratch >"$work/scratch.txt"

tables="$(wc -l <"$work/source.txt" | tr -d ' ')"
rows="$(awk -F'|' '{ s += $2 } END { print s + 0 }' "$work/source.txt")"
size="$(du -h "$dump" | cut -f1 | tr -d ' ')"
sha="$(shasum -a 256 "$dump" | cut -d' ' -f1)"

if ! diff -u "$work/source.txt" "$work/scratch.txt" >"$work/diff.txt"; then
  echo
  echo "FAILED: the restored copy differs from the source (- source, + restored):" >&2
  grep -E '^[-+][^-+]' "$work/diff.txt" >&2 || true
  echo "If the league was busy during the drill, run it again at a quiet time. The dump is kept at $dump." >&2
  exit 1
fi

echo
echo "PASSED: $tables tables and $rows rows restored and matched."
echo "  Dump:     $dump ($size, sha256 $sha)"
echo "  Dump took $((dumped - started))s, restore took $((restored - dumped))s, $((SECONDS - started))s in all."
if [[ "$KEEP_DUMP" == "false" ]]; then
  rm -f "$dump"
  echo "  The dump was deleted (KEEP_DUMP=false)."
else
  echo "  The dump holds players' personal data: keep it private, and never put it in the repository."
fi
echo "  Drop the scratch database when you are done with it."
