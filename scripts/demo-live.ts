/**
 * The last step of `npm run demo:reset`: makes the freshly seeded demo league
 * look like a game night in progress (src/seed/demo-live.ts): a live game,
 * a rain watch on the next game day, and the reminders the league's jobs
 * would have sent, waiting in the outbox.
 *
 * Refuses (exit code 1, before connecting to anything) unless demo mode is
 * fully on, like the reset itself (src/lib/demo/guard.ts).
 */
import { existsSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/db/schema";
import { canResetDemo } from "../src/lib/demo/guard";
import { defaultLeague } from "../src/db/queries/leagues";
import { liveDemo } from "../src/seed/demo-live";

if (!process.env.DATABASE_URL && existsSync(".env.local"))
  process.loadEnvFile(".env.local");

const allowed = canResetDemo(process.env);
if (!allowed.on) {
  console.error(allowed.reason);
  process.exit(1);
}

async function main(): Promise<void> {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
  });
  const db = drizzle({ client: pool, schema, casing: "snake_case" });
  try {
    // The demo league is the default one, at the site's own URLs.
    const league = await defaultLeague(db);
    if (!league) {
      console.info("No league to start a game night in.");
      return;
    }
    const done = await db.transaction((tx) =>
      liveDemo(tx, league.id, new Date()),
    );
    console.info(
      [
        done.liveGameId
          ? "A game is in progress for live scoring."
          : "No round left to play, so no live game.",
        done.rainWatchFrom
          ? `Rain watch on the game day starting ${done.rainWatchFrom.toISOString()}.`
          : "No later game day, so no rain watch.",
        `${done.queued} reminders and alerts are waiting in the demo's mail.`,
      ].join(" "),
    );
  } catch (error) {
    console.error("Could not set up the live demo:", error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
