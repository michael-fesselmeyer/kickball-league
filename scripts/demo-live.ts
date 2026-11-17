/**
 * The last step of `npm run demo:reset`: makes the freshly seeded demo league
 * look like a game night in progress (src/seed/demo-live.ts): a live game,
 * a rain watch on the next game day, and the reminders the league's jobs
 * would have sent, waiting in the outbox. Then the demo-only data for the
 * newer features (src/seed/demo-showcase.ts).
 *
 * Refuses (exit code 1, before connecting to anything) unless demo mode is
 * fully on, like the reset itself (src/lib/demo/guard.ts).
 */
import { existsSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { gte, sql } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "../src/db/schema";
import { message } from "../src/db/schema/message";
import { canResetDemo } from "../src/lib/demo/guard";
import { defaultLeague } from "../src/db/queries/leagues";
import { gameNight } from "../src/seed/demo-evening";
import { liveDemo } from "../src/seed/demo-live";
import { addDemoLanguages, addDemoShowcase } from "../src/seed/demo-showcase";

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
    // Tonight's game is always an evening one: a demo built overnight or
    // in the day plays it at 8 pm today, and this step reads that evening's
    // clock as "now" for the live game, the reminders and the demo data.
    const now = gameNight(new Date(), league.timeZone).clock;
    // The database's own clock, which stamps the mail queued below.
    const { rows } = await pool.query<{ at: Date }>(
      "select clock_timestamp() as at",
    );
    const queuedFrom = rows[0]?.at ?? new Date();
    // Languages first, so tonight's reminders go out in each person's own.
    const languages = await db.transaction((tx) =>
      addDemoLanguages(tx, league.id),
    );
    const done = await db.transaction((tx) => liveDemo(tx, league.id, now));
    const shown = await db.transaction((tx) =>
      addDemoShowcase(tx, league.id, now),
    );
    // The mail this step queued is dated by the evening's clock too, so
    // Demo mail doesn't show it written at the hour the demo was built.
    await db
      .update(message)
      .set({
        createdAt: sql`least(${message.sendAfter}, ${now.toISOString()}::timestamptz)`,
      })
      .where(gte(message.createdAt, queuedFrom));
    console.info(
      [
        done.liveGameId
          ? "A game is in progress for live scoring."
          : "No round left to play, so no live game.",
        done.rainWatchFrom
          ? `Rain watch on the game day starting ${done.rainWatchFrom.toISOString()}.`
          : "No later game day, so no rain watch.",
        `${done.queued} reminders and alerts are waiting in the demo's mail.`,
        `${languages} players read the league in another language.`,
        shown.length
          ? `Demo data for: ${shown.join(", ")}.`
          : "No demo data for the newer features.",
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
