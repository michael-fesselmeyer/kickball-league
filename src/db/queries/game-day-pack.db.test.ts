import { afterAll, describe, expect, it } from "vitest";
import type { TeamSeasonId } from "@/domain/ids";
import { user } from "../schema/auth";
import { field, game, refereeAssignment, slot, venue } from "../schema/game";
import { league } from "../schema/league";
import { profile } from "../schema/profile";
import { permitWindow } from "../schema/schedule";
import { season } from "../schema/season";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { closePool, inRolledBackDb } from "../test/transaction";
import { packRosters, packRows } from "./game-day-pack";
import { required } from "./rows";
import type { Db } from "./schedule";

afterAll(closePool);

const one = <T>(rows: T[], what: string) => required(rows[0], what);

/** 7 pm and 8 pm in New York on Tuesday, July 14, 2026. */
const SEVEN = new Date("2026-07-14T23:00:00Z");
const EIGHT = new Date("2026-07-15T00:00:00Z");
const hourAfter = (d: Date) => new Date(d.getTime() + 3_600_000);

/**
 * A field with a confirmed permit (no document uploaded) and a field with
 * no permit; three teams, a ref with a profile, and a roster with a
 * captain, a co-captain with no profile name, a player and one who left.
 */
async function world(db: Db) {
  const tag = Math.random().toString(36).slice(2, 8);
  const people = await db
    .insert(user)
    .values(
      [
        "Jamie Whistle",
        "Robin Quill",
        "Sam de la Cruz",
        "Alex Moss",
        "Gone Away",
      ].map((name, i) => ({ name, email: `pack-${i}-${tag}@example.test` })),
    )
    .returning({ id: user.id });
  const [ref, captain, coCaptain, player, left] = people.map((p) => p.id);
  if (!ref || !captain || !coCaptain || !player || !left)
    throw new Error("no people");
  await db.insert(profile).values([
    { userId: ref, firstName: "Jamie", lastName: "Whistle" },
    { userId: captain, firstName: "Robin", lastName: "Quill" },
    { userId: player, firstName: "Alex", lastName: "Moss" },
  ]);
  const lg = one(
    await db
      .insert(league)
      .values({ name: "Test League", slug: `pack-${tag}` })
      .returning({ id: league.id }),
    "league",
  );
  const sn = one(
    await db
      .insert(season)
      .values({
        leagueId: lg.id,
        name: "Summer",
        slug: `summer-${tag}`,
        status: "in_progress",
        startsOn: "2026-06-01",
        endsOn: "2026-08-30",
        feeModel: "per_player",
        playerFeeCents: 8500,
        rosterMin: 1,
        rosterMax: 20,
      })
      .returning({ id: season.id }),
    "season",
  );
  const park = one(
    await db
      .insert(venue)
      .values({ leagueId: lg.id, name: "Example Park", slug: `park-${tag}` })
      .returning({ id: venue.id }),
    "venue",
  );
  const [f1, f2] = (
    await db
      .insert(field)
      .values(
        ["Field 1", "Field 2"].map((name) => ({ venueId: park.id, name })),
      )
      .returning({ id: field.id })
  ).map((f) => f.id);
  if (!f1 || !f2) throw new Error("no fields");
  const permit = one(
    await db
      .insert(permitWindow)
      .values({
        fieldId: f1,
        seasonId: sn.id,
        startsAt: new Date("2026-07-14T22:00:00Z"),
        endsAt: new Date("2026-07-15T02:00:00Z"),
        permitNumber: "M-0412",
        status: "confirmed",
      })
      .returning({ id: permitWindow.id }),
    "permit",
  );
  const teams = await db
    .insert(team)
    .values(
      ["Aces", "Bees", "Cats"].map((name) => ({
        leagueId: lg.id,
        name,
        slug: `${name.toLowerCase()}-${tag}`,
      })),
    )
    .returning({ id: team.id });
  const [a, b, c] = (
    await db
      .insert(teamSeason)
      .values(teams.map((t) => ({ teamId: t.id, seasonId: sn.id })))
      .returning({ id: teamSeason.id })
  ).map((t) => t.id);
  if (!a || !b || !c) throw new Error("no entries");
  const place = async (
    fieldId: typeof f1,
    startsAt: Date,
    teamAId: TeamSeasonId,
    teamBId: TeamSeasonId,
    permitted: boolean,
  ) => {
    const s = one(
      await db
        .insert(slot)
        .values({
          seasonId: sn.id,
          fieldId,
          startsAt,
          endsAt: hourAfter(startsAt),
          timeIndex: 0,
          permitWindowId: permitted ? permit.id : null,
        })
        .returning({ id: slot.id }),
      "slot",
    );
    return one(
      await db
        .insert(game)
        .values({ seasonId: sn.id, teamAId, teamBId, slotId: s.id })
        .returning({ id: game.id }),
      "game",
    ).id;
  };
  const late = await place(f1, EIGHT, b, c, true);
  const early = await place(f1, SEVEN, a, b, true);
  const other = await place(f2, SEVEN, c, a, false);
  await db.insert(refereeAssignment).values({
    gameId: early,
    userId: ref,
    status: "accepted",
  });
  const regs = await db
    .insert(registration)
    .values(
      [captain, coCaptain, player, left].map((userId) => ({
        seasonId: sn.id,
        userId,
        kind: "team_member" as const,
        status: "active" as const,
      })),
    )
    .returning({ id: registration.id });
  await db.insert(rosterMembership).values(
    regs.map((r, i) => ({
      teamSeasonId: a,
      registrationId: r.id,
      role: (["captain", "co_captain", "player", "player"] as const)[i],
      status: i === 3 ? ("removed" as const) : ("active" as const),
    })),
  );
  return { leagueId: lg.id, games: { early, late, other }, teams: { a, b, c } };
}

describe("packRows", () => {
  it("reads every game on the day with its field, ref and permit", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const rows = await packRows(db, w.leagueId, "2026-07-14");
      expect(rows.map((r) => r.id)).toEqual([
        w.games.early,
        w.games.other,
        w.games.late,
      ]);
      expect(rows[0]).toMatchObject({
        fieldName: "Field 1",
        venueName: "Example Park",
        teamA: "Aces",
        teamB: "Bees",
        referee: "Jamie W.",
        calledOff: false,
        permit: { number: "M-0412", status: "confirmed", onFile: false },
      });
      expect(rows[1]).toMatchObject({ referee: null, permit: null });
      expect(await packRows(db, w.leagueId, "2026-07-15")).toEqual([]);
    });
  });
});

describe("packRosters", () => {
  it("lists active players by first name and last initial, captains first", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const sheets = await packRosters(db, [w.teams.a, w.teams.b]);
      expect(sheets).toEqual([
        {
          teamSeasonId: w.teams.a,
          players: [
            { name: "Robin Q.", role: "captain" },
            { name: "Sam C.", role: "co_captain" },
            { name: "Alex M.", role: "player" },
          ],
        },
        { teamSeasonId: w.teams.b, players: [] },
      ]);
    });
  });
});
