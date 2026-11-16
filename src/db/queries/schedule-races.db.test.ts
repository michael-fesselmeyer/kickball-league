import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { generate } from "@/domain/scheduler/generate";
import type { LeagueId, SeasonId, UserId } from "@/domain/ids";
import * as schema from "../schema";
import { user } from "../schema/auth";
import { field, slot, venue } from "../schema/game";
import { league } from "../schema/league";
import { scheduleVersion } from "../schema/schedule";
import { season } from "../schema/season";
import { team, teamSeason } from "../schema/team";
import { permitEverySlot } from "../test/permits";
import {
  loadSchedulerInput,
  publishVersion,
  saveVersion,
  type Db,
} from "./schedule";

/**
 * Two admins publishing at the same moment, on separate connections, so
 * the transactions really overlap (a rolled-back test transaction can't).
 * Each test commits its own league and deletes it afterwards.
 */

const clients: Client[] = [];
const connect = async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  clients.push(client);
  return drizzle({ client, schema, casing: "snake_case" });
};
afterAll(() => Promise.all(clients.map((c) => c.end())));

const options = { rounds: 7, reservePerDay: 2, seed: 7 };

async function world(db: Db) {
  const tag = Math.random().toString(36).slice(2, 8);
  const admins = await db
    .insert(user)
    .values(
      ["a", "b"].map((p) => ({
        name: `Admin ${p}`,
        email: `schedule-race-${p}-${tag}@example.test`,
      })),
    )
    .returning({ id: user.id });
  const [lg] = await db
    .insert(league)
    .values({ name: "Race League", slug: `schedule-race-${tag}` })
    .returning({ id: league.id });
  const [sn] = await db
    .insert(season)
    .values({
      leagueId: lg!.id,
      name: "Spring",
      slug: "spring",
      startsOn: "2027-04-04",
      endsOn: "2027-05-16",
      feeModel: "per_team",
      teamFeeCents: 120000,
      rosterMin: 12,
      rosterMax: 20,
    })
    .returning({ id: season.id });
  const [vn] = await db
    .insert(venue)
    .values({ leagueId: lg!.id, name: "Race Park", slug: `race-park-${tag}` })
    .returning({ id: venue.id });
  const fields = await db
    .insert(field)
    .values([1, 2].map((n) => ({ venueId: vn!.id, name: `Field ${n}` })))
    .returning({ id: field.id });
  const sundays = ["04-04", "04-11", "04-18", "04-25", "05-02", "05-09"];
  await db.insert(slot).values(
    sundays.flatMap((d) =>
      ["14:00", "15:30", "17:00"].flatMap((time, timeIndex) =>
        fields.map((f) => {
          const startsAt = new Date(`2027-${d}T${time}:00Z`);
          return {
            seasonId: sn!.id,
            fieldId: f.id,
            startsAt,
            endsAt: new Date(startsAt.getTime() + 90 * 60_000),
            timeIndex,
          };
        }),
      ),
    ),
  );
  await permitEverySlot(db, sn!.id);
  const teams = await db
    .insert(team)
    .values(
      "ABCDEF".split("").map((l) => ({
        leagueId: lg!.id,
        name: `Race ${l}`,
        slug: `race-${l.toLowerCase()}-${tag}`,
      })),
    )
    .returning({ id: team.id });
  await db
    .insert(teamSeason)
    .values(teams.map((t) => ({ teamId: t.id, seasonId: sn!.id })));
  return {
    leagueId: lg!.id as LeagueId,
    seasonId: sn!.id as SeasonId,
    admins: admins.map((a) => a.id as UserId) as [UserId, UserId],
  };
}

type World = Awaited<ReturnType<typeof world>>;

/** Deletes everything `world` and the publishes made, children first. */
async function removeWorld(db: Db, w: World) {
  const s = w.seasonId;
  await db.execute(sql`
    delete from game_placement where schedule_version_id in
      (select id from schedule_version where season_id = ${s})`);
  await db.execute(sql`delete from game where season_id = ${s}`);
  await db.execute(sql`delete from schedule_version where season_id = ${s}`);
  await db.execute(sql`delete from permit_window where season_id = ${s}`);
  await db.execute(sql`delete from slot where season_id = ${s}`);
  await db.execute(sql`delete from books_file where league_id = ${w.leagueId}`);
  await db.execute(sql`delete from team_season where season_id = ${s}`);
  await db.delete(team).where(eq(team.leagueId, w.leagueId));
  await db.execute(sql`
    delete from field where venue_id in
      (select id from venue where league_id = ${w.leagueId})`);
  await db.delete(venue).where(eq(venue.leagueId, w.leagueId));
  await db.delete(season).where(eq(season.id, s));
  await db.delete(league).where(eq(league.id, w.leagueId));
  await db.execute(
    sql`delete from audit_log where actor_id in (${sql.join(
      w.admins.map((a) => sql`${a}`),
      sql`, `,
    )})`,
  );
  await db.delete(user).where(inArray(user.id, w.admins));
}

describe("two admins publishing at the same moment", () => {
  it("publishes one draft after the other, never two at once and never an error", async () => {
    const setup = await connect();
    const w = await world(setup);
    try {
      const loaded = await loadSchedulerInput(setup, w.seasonId, options);
      if (!loaded.ok) throw new Error(loaded.error);
      const draft = (seed: number) =>
        saveVersion(setup, {
          seasonId: w.seasonId,
          input: loaded.value,
          schedule: generate({ ...loaded.value, seed }),
          origin: "generated",
        });
      // A published schedule, then two new drafts, one per admin.
      const first = await draft(1);
      expect((await publishVersion(setup, first, w.admins[0])).ok).toBe(true);
      const mine = await draft(2);
      const theirs = await draft(3);

      const [one, two] = [await connect(), await connect()];
      const results = await Promise.allSettled([
        publishVersion(one, mine, w.admins[0]),
        publishVersion(two, theirs, w.admins[1]),
      ]);
      // Neither admin sees a crash: each publish finishes on its own terms.
      expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
      const published = await setup
        .select({ id: scheduleVersion.id })
        .from(scheduleVersion)
        .where(
          and(
            eq(scheduleVersion.seasonId, w.seasonId),
            eq(scheduleVersion.status, "published"),
          ),
        );
      expect(published).toHaveLength(1);
    } finally {
      await removeWorld(setup, w);
    }
  });
});
