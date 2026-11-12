/**
 * npm run seed: replaces the demo league with fresh, deterministic seed data.
 *
 * Only seed-owned rows are ever deleted: the league with the demo slug and
 * users on the reserved seed email domain. Real accounts on the same
 * database are never touched. Everything runs in one transaction.
 */
import { existsSync } from "node:fs";
import { eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/db/schema";
import {
  generateSeed,
  SEED_EMAIL_DOMAIN,
  SEED_LEAGUE_SLUG,
} from "../src/seed/generate";
import { canSeed } from "../src/seed/guard";

if (!process.env.DATABASE_URL && existsSync(".env.local"))
  process.loadEnvFile(".env.local");

async function main(): Promise<void> {
  const allowed = canSeed(process.env);
  if (!allowed.ok) {
    console.error(allowed.error);
    process.exitCode = 1;
    return;
  }

  const seedArg = process.argv.find((a) => a.startsWith("--seed="));
  const data = generateSeed(
    seedArg ? Number(seedArg.slice("--seed=".length)) : undefined,
  );
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const db = drizzle({ client: pool, schema, casing: "snake_case" });

  const {
    league,
    season,
    venue,
    field,
    slot,
    game,
    scoreReport,
    team,
    teamSeason,
    registration,
    rosterMembership,
    user,
    profile,
  } = schema;

  try {
    await db.transaction(async (tx) => {
      // Remove the previous demo league, children first.
      const old = await tx
        .select({ id: league.id })
        .from(league)
        .where(eq(league.slug, SEED_LEAGUE_SLUG));
      for (const { id: leagueId } of old) {
        const seasonIds = (
          await tx
            .select({ id: season.id })
            .from(season)
            .where(eq(season.leagueId, leagueId))
        ).map((r) => r.id);
        if (seasonIds.length) {
          const gameIds = (
            await tx
              .select({ id: game.id })
              .from(game)
              .where(inArray(game.seasonId, seasonIds))
          ).map((r) => r.id);
          if (gameIds.length)
            await tx
              .delete(scoreReport)
              .where(inArray(scoreReport.gameId, gameIds));
          await tx.delete(game).where(inArray(game.seasonId, seasonIds));
          await tx.delete(slot).where(inArray(slot.seasonId, seasonIds));
          const entryIds = (
            await tx
              .select({ id: teamSeason.id })
              .from(teamSeason)
              .where(inArray(teamSeason.seasonId, seasonIds))
          ).map((r) => r.id);
          if (entryIds.length)
            await tx
              .delete(rosterMembership)
              .where(inArray(rosterMembership.teamSeasonId, entryIds));
          await tx
            .delete(registration)
            .where(inArray(registration.seasonId, seasonIds));
          await tx
            .delete(teamSeason)
            .where(inArray(teamSeason.seasonId, seasonIds));
          await tx.delete(season).where(inArray(season.id, seasonIds));
        }
        await tx.delete(team).where(eq(team.leagueId, leagueId));
        const venueIds = (
          await tx
            .select({ id: venue.id })
            .from(venue)
            .where(eq(venue.leagueId, leagueId))
        ).map((r) => r.id);
        if (venueIds.length)
          await tx.delete(field).where(inArray(field.venueId, venueIds));
        await tx.delete(venue).where(eq(venue.leagueId, leagueId));
        await tx.delete(league).where(eq(league.id, leagueId));
      }
      // Seed users only (profiles, sessions and accounts cascade).
      await tx.delete(user).where(like(user.email, `%@${SEED_EMAIL_DOMAIN}`));

      await tx.insert(league).values(data.league);
      await tx.insert(user).values(data.users);
      await tx.insert(profile).values(data.profiles);
      await tx.insert(season).values(data.season);
      await tx.insert(venue).values(data.venue);
      await tx.insert(field).values(data.fields);
      await tx.insert(team).values(data.teams);
      await tx.insert(teamSeason).values(data.teamSeasons);
      await tx.insert(registration).values(data.registrations);
      await tx.insert(rosterMembership).values(data.rosterMemberships);
      await tx.insert(slot).values(data.slots);
      await tx.insert(game).values(data.games);
    });
    const played = data.games.filter((g) => g.status === "final").length;
    console.info(
      `Seeded "${data.league.name}": ${data.teams.length} teams, ${data.users.length} people, ${data.slots.length} slots, ${data.games.length} games (${played} played).`,
    );
  } finally {
    await pool.end();
  }
}

void main();
