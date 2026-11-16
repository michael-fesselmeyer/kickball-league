import { eq, inArray, sql } from "drizzle-orm";
import type { UserId } from "@/domain/ids";
import { user } from "../schema/auth";
import { field, slot, venue } from "../schema/game";
import { league } from "../schema/league";
import { season } from "../schema/season";
import { team, teamSeason } from "../schema/team";
import type { Db } from "../queries/schedule";
import { permitEverySlot } from "./permits";

/**
 * A committed league for race tests, whose transactions run on separate
 * connections and so can't share a rolled-back one: six teams, two fields
 * and three times on six Sundays, every slot under a permit. Remove it with
 * removeScheduleWorld.
 */
export async function scheduleWorld(db: Db) {
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
    leagueId: lg!.id,
    seasonId: sn!.id,
    admins: admins.map((a) => a.id) as [UserId, UserId],
  };
}

export type ScheduleWorld = Awaited<ReturnType<typeof scheduleWorld>>;

/** Deletes everything `world` and the publishes made, children first. */
export async function removeScheduleWorld(db: Db, w: ScheduleWorld) {
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
