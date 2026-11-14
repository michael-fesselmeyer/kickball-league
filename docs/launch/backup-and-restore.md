# Backup and restore drill

A backup counts only once it has been restored. [`scripts/backup-drill.sh`](../../scripts/backup-drill.sh) takes a backup of the league's Postgres database with `pg_dump`, restores it into an empty scratch database with `pg_restore`, and compares the row count of every table in both. It passes only when they all match.

## What Neon already gives us, and what it doesn't

- Neon Free can restore the database to any moment in the **last 6 hours**, and keeps one manual snapshot. It has no scheduled backups ([Neon plans](https://neon.com/docs/introduction/plans), [Neon backups](https://neon.com/docs/manage/backups)).
- Six hours covers "an admin deleted the wrong thing this afternoon". It doesn't cover a mistake noticed the next day, the project being lost, or leaving Neon. A `pg_dump` file covers all three.

## The rules

- **A dump holds every player's personal data**: names, email addresses, birth dates and sealed emergency contacts. Keep it on your own encrypted disk or in your password manager's file storage. Never put it in the repository, an issue, a chat or a shared drive. The script writes to `~/kickball-league-backups` by default, outside the repository, readable only by you.
- **A dump is useless without `BETTER_AUTH_SECRET`.** Emergency contacts and the Instagram token are encrypted with a key derived from it. Keep the secret in your password manager, never stored next to the dump.
- **The drill never touches the source**, apart from reading it. It refuses to restore into a database whose name lacks `scratch`, `restore` or `drill`, into the source itself, or into a database that already has tables.
- Connection strings go in environment variables, not arguments, so they never show in the process list or your shell history. The script prints host and database names only.

## Run it against production

**Once, set up**

1. Install a Postgres 18 client, which is free: `brew install libpq`, and put its `bin` folder first on your `PATH`. The script refuses a `pg_dump` older than the server.
2. In the Neon console, create an empty database for the drill on a branch **other than** `production`, so the restore can't fill up the production branch's 1 GB. The `dev` branch works: Databases → New database → `kb_restore_drill`. Copy that branch's **direct** connection string for the new database into your password manager.

**Each drill** (monthly in season, and before any risky migration)

```bash
read -rs SOURCE_DATABASE_URL && export SOURCE_DATABASE_URL     # production, direct (not -pooler)
read -rs SCRATCH_DATABASE_URL && export SCRATCH_DATABASE_URL   # dev branch, kb_restore_drill
scripts/backup-drill.sh
```

Run it when the league is quiet, such as a weekday morning. Rows written during the drill make the counts differ and fail it, so run it again.

**When it passes**

```text
PASSED: 102 tables and 2067 rows restored and matched.
  Dump:     ~/kickball-league-backups/kickball-league-20261114T152845Z.dump (512K, sha256 …)
```

1. Write the date, the table and row counts, and the SHA-256 in the launch log.
2. Keep the dump as the backup. Keep the last three, and delete older ones.
3. In Neon, drop `kb_restore_drill` and create it again, empty, for next time. The dev branch's storage counts toward the project's 1 GB.

**When it fails**, it prints each table whose count differs (`-` source, `+` restored) and keeps the dump. Run it again at a quiet time. If the same tables still differ, or `pg_restore` stops with an error, the backup isn't trustworthy: open an issue (no data in it) and keep relying on Neon's 6-hour restore until it's fixed.

## Restoring for real

Only after the owners agree, with the site made **read-only** from the operator console first, so nothing is written meanwhile ([ADR 0009](../adr/0009-platform-operator.md)):

1. **Within 6 hours of the mistake:** use Neon's own restore (Branches → `production` → Restore, to a time before the mistake). It's the quickest, and needs no dump.
2. **Otherwise:** restore the newest good dump into a **new, empty** database (for example a new branch's database), check it as the drill does, and point `DATABASE_URL` in the host at it. Then redeploy. Keep the old database until the owners have checked the site.

   ```bash
   pg_restore --dbname="$NEW_DATABASE_URL" --no-owner --no-privileges --exit-on-error <dump file>
   ```

3. Anything after the dump (registrations, payments) is missing from the restored copy. Stripe still has every payment: the owners compare Stripe's payments since the dump's time with the registrations screen, and record what's missing by hand.
4. Make the site active again from the operator console.

## Tested

On 2026-11-14 against a local Postgres 18 (Docker), seeded with `npm run seed` (8 teams, 113 people, 28 games), with `PG_TOOLS_CONTAINER` set because the machine's own client was version 14:

- **Pass:** 102 tables and 2,067 rows restored and matched; a 512 KB dump; 28 seconds in all.
- **Refusals:** a client older than the server; a scratch database without `scratch`, `restore` or `drill` in its name; the source as the scratch; a scratch database that already had tables.

To repeat the local test:

```bash
PGDATABASE_NAME=kb_launch_drill scripts/setup-local-postgres.sh
DATABASE_URL=postgresql://ci:ci@localhost:5432/kb_launch_drill npm run seed
psql postgresql://postgres:postgres@localhost:5432/postgres -c "create database kb_launch_drill_scratch owner ci"
SOURCE_DATABASE_URL=postgresql://ci:ci@localhost:5432/kb_launch_drill \
SCRATCH_DATABASE_URL=postgresql://ci:ci@localhost:5432/kb_launch_drill_scratch \
PG_TOOLS_CONTAINER=kb-local-pg scripts/backup-drill.sh
```

`PG_TOOLS_CONTAINER` runs the client tools inside the named Docker container, so `localhost` in the URLs is that container's own Postgres. Leave it unset with a Postgres 18 client installed. These local passwords are the throwaway test database's, not secrets.
