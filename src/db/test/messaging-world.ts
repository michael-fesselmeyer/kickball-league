import type { RegistrationId, TeamSeasonId, UserId } from "@/domain/ids";
import { required } from "../queries/rows";
import type { Db } from "../queries/schedule";
import { user } from "../schema/auth";
import { field, game, refereeAssignment, slot, venue } from "../schema/game";
import { league } from "../schema/league";
import { season } from "../schema/season";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";

type Status = (typeof registration.$inferInsert)["status"];

export type Player = {
  userId: UserId;
  registrationId: RegistrationId;
  email: string;
};

/**
 * A small season for messaging tests: two teams, each with a captain and
 * two players, plus a free agent. Every address is on example.test.
 */
export async function messagingWorld(
  db: Db,
  options: { paymentDeadlineAt?: Date } = {},
) {
  const tag = Math.random().toString(36).slice(2, 8);
  const lg = required(
    (
      await db
        .insert(league)
        .values({ name: "Test League", slug: `msg-${tag}` })
        .returning({ id: league.id })
    )[0],
    "league",
  );
  const sn = required(
    (
      await db
        .insert(season)
        .values({
          leagueId: lg.id,
          name: "Fall 2026",
          slug: `fall-${tag}`,
          status: "registration_open",
          startsOn: "2026-09-01",
          endsOn: "2026-11-01",
          paymentDeadlineAt: options.paymentDeadlineAt ?? null,
          feeModel: "per_player",
          playerFeeCents: 8500,
          rosterMin: 1,
          rosterMax: 20,
        })
        .returning({ id: season.id, slug: season.slug, name: season.name })
    )[0],
    "season",
  );

  async function person(
    name: string,
    status: Status = "active",
  ): Promise<Player> {
    const email = `msg-${name}-${tag}@example.test`;
    const u = required(
      (
        await db.insert(user).values({ name, email }).returning({ id: user.id })
      )[0],
      "user",
    );
    const r = required(
      (
        await db
          .insert(registration)
          .values({
            seasonId: sn.id,
            userId: u.id,
            kind: "team_member",
            status,
          })
          .returning({ id: registration.id })
      )[0],
      "registration",
    );
    return { userId: u.id, registrationId: r.id, email };
  }

  async function entry(name: string): Promise<TeamSeasonId> {
    const t = required(
      (
        await db
          .insert(team)
          .values({
            leagueId: lg.id,
            name,
            slug: `${name.toLowerCase().replaceAll(" ", "-")}-${tag}`,
          })
          .returning({ id: team.id })
      )[0],
      "team",
    );
    return required(
      (
        await db
          .insert(teamSeason)
          .values({ teamId: t.id, seasonId: sn.id })
          .returning({ id: teamSeason.id })
      )[0],
      "team season",
    ).id;
  }

  async function join(
    teamSeasonId: TeamSeasonId,
    p: Player,
    role: "captain" | "player" = "player",
  ) {
    await db.insert(rosterMembership).values({
      teamSeasonId,
      registrationId: p.registrationId,
      role,
      status: "active",
    });
  }

  const aces = await entry("Aces");
  const bees = await entry("Bees");
  const acesCaptain = await person("ace-cap");
  const acesPlayers = [
    await person("ace-1"),
    await person("ace-2", "pending_payment"),
  ];
  const beesCaptain = await person("bee-cap");
  const beesPlayers = [
    await person("bee-1", "pending_payment"),
    await person("bee-2", "pending_waiver"),
  ];
  await join(aces, acesCaptain, "captain");
  for (const p of acesPlayers) await join(aces, p);
  await join(bees, beesCaptain, "captain");
  for (const p of beesPlayers) await join(bees, p);
  const freeAgent = await person("free", "pending_payment");
  const cancelled = await person("gone", "cancelled");

  const fieldId = required(
    (
      await db
        .insert(field)
        .values({
          venueId: required(
            (
              await db
                .insert(venue)
                .values({ leagueId: lg.id, name: "Park", slug: "park" })
                .returning({ id: venue.id })
            )[0],
            "venue",
          ).id,
          name: "Field 2",
        })
        .returning({ id: field.id })
    )[0],
    "field",
  ).id;

  /** Aces vs Bees in an hour-long slot ending at `endsAt`, with an optional ref. */
  async function gameEnding(endsAt: Date, refereeId?: UserId) {
    const s = required(
      (
        await db
          .insert(slot)
          .values({
            seasonId: sn.id,
            fieldId,
            startsAt: new Date(endsAt.getTime() - 3_600_000),
            endsAt,
            timeIndex: 0,
          })
          .returning({ id: slot.id })
      )[0],
      "slot",
    );
    const g = required(
      (
        await db
          .insert(game)
          .values({
            seasonId: sn.id,
            teamAId: aces,
            teamBId: bees,
            slotId: s.id,
          })
          .returning({ id: game.id })
      )[0],
      "game",
    );
    if (refereeId)
      await db
        .insert(refereeAssignment)
        .values({ gameId: g.id, userId: refereeId });
    return { gameId: g.id, slotId: s.id };
  }

  return {
    tag,
    leagueId: lg.id,
    season: { id: sn.id, slug: sn.slug, name: sn.name },
    aces: {
      id: aces,
      name: "Aces",
      captain: acesCaptain,
      players: acesPlayers,
    },
    bees: {
      id: bees,
      name: "Bees",
      captain: beesCaptain,
      players: beesPlayers,
    },
    freeAgent,
    cancelled,
    person,
    entry,
    join,
    gameEnding,
  };
}
