import { eq } from "drizzle-orm";
import { seasonChecklist } from "@/db/queries/game-day-checklist";
import type { Db } from "@/db/queries/schedule";
import {
  concern,
  concernMessage,
  gameAttendance,
  gameChecklistTick,
  seasonShirts,
  user,
} from "@/db/schema";
import type { UserId } from "@/domain/ids";
import { PERSONAS } from "@/lib/demo/personas";
import { PLAYED_ROUNDS, type SeedData } from "./generate";

/**
 * What the newest features have to show in the demo: the season's shirt
 * order, private concerns waiting in the admins' queue, the game-day
 * checklist ticked by captains, and field check-ins with games played.
 * Each is its own function so a feature's demo data can change alone. They
 * only add rows under the demo season, its games and its league, which the
 * seed's cleanup already deletes with them.
 */

const HOUR = 3_600_000;

/** The season's shirts: sizes offered, and an order placed with the vendor. */
export async function addDemoShirtOrder(
  db: Db,
  data: SeedData,
  now: Date,
): Promise<void> {
  const placedAt = new Date(now.getTime() - 48 * HOUR);
  await db.insert(seasonShirts).values({
    seasonId: data.season.id,
    status: "placed",
    placedAt,
    vendor: "Fieldhouse Prints (example)",
    costCents: 96_000,
  });
}

/** Two concerns in the admins' queue: one from a player, one from the public form. */
export async function addDemoConcerns(
  db: Db,
  data: SeedData,
  now: Date,
): Promise<void> {
  const [admin] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, PERSONAS.admin.email));
  const [player] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, PERSONAS.player.email));
  const firstGame = data.games.find((g) => g.roundNo === PLAYED_ROUNDS);
  const [fromPlayer] = await db
    .insert(concern)
    .values({
      leagueId: data.league.id,
      source: "player",
      category: "treatment",
      body: "The other team's pitcher kept arguing every call in the fourth inning. It got heated and a few of us would like the league to know before it happens again.",
      gameId: firstGame?.id,
      senderId: player?.id,
      createdAt: new Date(now.getTime() - 20 * HOUR),
    })
    .returning({ id: concern.id });
  await db.insert(concern).values({
    leagueId: data.league.id,
    source: "public",
    category: "park_rules",
    parkRule: "amplified_sound",
    body: "A group on the lawn beside the kickball fields had a speaker going loudly during the evening games, and it was hard to hear the ref.",
    place: "Lawn next to the fields",
    replyEmail: "neighbor@example.test",
    createdAt: new Date(now.getTime() - 5 * HOUR),
  });
  if (fromPlayer && admin) {
    await db.insert(concernMessage).values({
      concernId: fromPlayer.id,
      authorId: admin.id,
      kind: "note",
      body: "Talked to the ref. Checking whether a ruling is needed before replying.",
      createdAt: new Date(now.getTime() - 10 * HOUR),
    });
  }
}

/**
 * The first played round: its captains ticked the "before play" items, and
 * every rostered player of its teams was checked in, a few by scan.
 */
export async function addDemoGameDay(db: Db, data: SeedData): Promise<void> {
  const { items } = await seasonChecklist(db, data.season.id);
  const before = items.before;
  const roundGames = data.games.filter((g) => g.roundNo === 1);
  const seats = new Map<string, UserId[]>();
  for (const m of data.rosterMemberships) {
    const reg = data.registrations.find((r) => r.id === m.registrationId);
    if (!reg) continue;
    seats.set(m.teamSeasonId, [
      ...(seats.get(m.teamSeasonId) ?? []),
      reg.userId,
    ]);
  }
  const ticks = roundGames.flatMap((g) =>
    [g.teamAId, g.teamBId].flatMap((teamSeasonId) =>
      before.map((item) => ({
        gameId: g.id,
        teamSeasonId,
        itemId: item.id,
        tickedAt: new Date(g.finalizedAt ?? Date.now()),
      })),
    ),
  );
  if (ticks.length > 0)
    await db.insert(gameChecklistTick).values(ticks).onConflictDoNothing();
  const attendance = data.games
    .filter((g) => g.status === "final")
    .flatMap((g) =>
      [g.teamAId, g.teamBId].flatMap((teamSeasonId) =>
        (seats.get(teamSeasonId) ?? [])
          .slice(0, 10)
          .map((userId, i) => ({
            gameId: g.id,
            userId,
            teamSeasonId,
            method: i % 3 === 0 ? ("scan" as const) : ("marked" as const),
            recordedAt: g.finalizedAt ?? undefined,
          })),
      ),
    );
  for (let i = 0; i < attendance.length; i += 500)
    await db
      .insert(gameAttendance)
      .values(attendance.slice(i, i + 500))
      .onConflictDoNothing();
}
