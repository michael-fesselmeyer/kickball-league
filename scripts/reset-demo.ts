/**
 * npm run demo:reset: puts the demo deployment's database back to fresh seed
 * data and the four view-as personas. Meant to run nightly.
 *
 * Refuses (exit code 1, before connecting to anything) unless demo mode is
 * fully on for this environment: DEMO_MODE=true and a database whose name
 * contains "demo" (src/lib/demo/guard.ts). Safe to repeat: the seed replaces
 * only seed-owned rows, in one transaction, so a failed or overlapping run
 * leaves the previous data in place.
 *
 * Its last step moves the seeded league forward by whole weeks so the
 * in-progress season's next game day is the coming one
 * (src/seed/shift-weeks.ts); `npm run seed` keeps the fixed calendar.
 */
import { existsSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/db/schema";
import { canResetDemo } from "../src/lib/demo/guard";
import { catchUpDemoLeague } from "../src/seed/shift-weeks";

if (!process.env.DATABASE_URL && existsSync(".env.local"))
  process.loadEnvFile(".env.local");

const allowed = canResetDemo(process.env);
if (!allowed.on) {
  console.error(allowed.reason);
  process.exit(1);
}

console.info("Demo mode is on. Resetting the demo league.");

async function reset(): Promise<void> {
  const ranFrom = new Date();
  // The seed script runs on import and sets the exit code itself.
  const { seeding } = await import("./seed");
  await seeding;
  if (process.exitCode) return;
  // The seed's calendar is fixed; move the league so its season is current.
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const db = drizzle({ client: pool, schema, casing: "snake_case" });
    const weeks = await db.transaction((tx) =>
      catchUpDemoLeague(tx, { now: new Date(), ranFrom }),
    );
    console.info(
      weeks === 0
        ? "The demo season is already current."
        : `Moved the demo league ${weeks} weeks forward, so its next game day is the coming one.`,
    );
  } finally {
    await pool.end();
  }
}

void reset();
