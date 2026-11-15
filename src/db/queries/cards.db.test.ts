import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { can } from "@/domain/authz/permissions";
import {
  cardChoice,
  parseCardForm,
  UNDO_WINDOW_MS,
} from "@/domain/discipline/cards";
import type { GameCardId, UserId } from "@/domain/ids";
import { err, ok } from "@/domain/result";
import { auditLog } from "../schema/audit";
import { gameCard, suspension } from "../schema/discipline";
import { game } from "../schema/game";
import { profile } from "../schema/profile";
import { messagingWorld } from "../test/messaging-world";
import { grantRole, subjectIn } from "../test/leagues";
import { closePool, inRolledBackDb } from "../test/transaction";
import { deleteAccount, personalData } from "./account";
import {
  cardedPlayers,
  cardsForPlayers,
  gameCards,
  giveCard,
  myCards,
  undoCard,
} from "./cards";
import type { Db } from "./schedule";

afterAll(closePool);

const NOW = new Date("2026-09-15T16:00:00Z");
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000);
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

/** Aces vs Bees that started an hour ago, reffed by the ref. */
async function world(db: Db) {
  const w = await messagingWorld(db);
  const ref = await w.person("ref");
  const admin = await w.person("admin");
  await db.insert(profile).values(
    [...w.aces.players, ...w.bees.players, ref, admin].map((p, i) => ({
      userId: p.userId,
      firstName: `Pat${i}`,
      lastName: "Example",
    })),
  );
  await grantRole(db, admin.userId, "admin");
  const played = await w.gameEnding(hours(0), ref.userId);
  const card = (
    who: UserId,
    teamSeasonId: string,
    color: "yellow" | "red" = "yellow",
    now = NOW,
    gameId = played.gameId,
    givenBy: UserId = ref.userId,
  ) => {
    const parsed = parseCardForm(
      {
        color,
        note: "Arguing the call",
        person: cardChoice(teamSeasonId, who),
      },
      new Set([cardChoice(teamSeasonId, who)]),
    );
    if (!parsed.ok) throw new Error("bad card");
    return giveCard(db, { gameId, givenBy, card: parsed.value, now });
  };
  return { ...w, ref, admin, played, card };
}

const given = (r: { ok: true; value: GameCardId } | { ok: false }) => {
  if (!r.ok) throw new Error("Expected the card to be given");
  return r.value;
};

describe("who may give a card", () => {
  it("is the game's ref and admins, not captains or players", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const other = await w.gameEnding(hours(-30));
      const ctx = (gameId: typeof w.played.gameId) => ({
        game: { id: gameId, teamSeasonIds: [w.aces.id, w.bees.id] as const },
      });
      for (const [who, ok_] of [
        [w.ref, true],
        [w.admin, true],
        [w.aces.captain, false],
        [w.aces.players[0]!, false],
      ] as const) {
        expect(
          can(
            await subjectIn(db, who.userId),
            "card.give",
            ctx(w.played.gameId),
          ),
        ).toBe(ok_);
      }
      // The ref is assigned to one game only.
      expect(
        can(await subjectIn(db, w.ref.userId), "card.give", ctx(other.gameId)),
      ).toBe(false);
    });
  });
});

describe("giving cards", () => {
  it("records a card, is audited, and never creates a suspension", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const p = w.aces.players[0]!;
      const id = given(await w.card(p.userId, w.aces.id, "red"));
      const list = await gameCards(db, w.played.gameId);
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        id,
        userId: p.userId,
        color: "red",
        note: "Arguing the call",
        teamName: "Aces",
      });
      const [audit] = await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.entityId, id));
      expect(audit).toMatchObject({
        action: "card.give",
        actorId: w.ref.userId,
      });
      expect(await db.select().from(suspension)).toHaveLength(0);
    });
  });

  it("gives many cards without any suspension, and shows a pattern only across games", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const p = w.bees.players[0]!;
      for (let i = 0; i < 4; i++)
        given(await w.card(p.userId, w.bees.id, "yellow"));
      expect(await db.select().from(suspension)).toHaveLength(0);
      const cards = (await cardsForPlayers(db, [p.userId])).get(p.userId)!;
      expect(cards).toHaveLength(4);
      expect(new Set(cards.map((c) => c.gameId)).size).toBe(1);
    });
  });

  it("refuses a player who is not on either roster, or on the other team", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      expect(await w.card(w.freeAgent.userId, w.aces.id)).toEqual(
        err("not_in_game"),
      );
      // A real player named under the team they are not on.
      expect(await w.card(w.aces.players[0]!.userId, w.bees.id)).toEqual(
        err("not_in_game"),
      );
      expect(await db.select().from(gameCard)).toHaveLength(0);
    });
  });

  it("records the team of a player who is rostered elsewhere in the season too", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      // Aces vs Bees is the game; the player's card names the Aces team.
      const p = w.aces.players[0]!;
      const id = given(await w.card(p.userId, w.aces.id));
      const [row] = await db.select().from(gameCard).where(eq(gameCard.id, id));
      expect(row?.teamSeasonId).toBe(w.aces.id);
    });
  });

  it("opens at kickoff, stays open after the game ends, and closes for a called-off game", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const p = w.aces.players[0]!;
      const later = await w.gameEnding(hours(5), w.ref.userId);
      expect(
        await w.card(p.userId, w.aces.id, "yellow", NOW, later.gameId),
      ).toEqual(err("not_started"));
      await db
        .update(game)
        .set({ status: "final", scoreA: 5, scoreB: 3, finalizedAt: hours(0) })
        .where(eq(game.id, w.played.gameId));
      given(await w.card(p.userId, w.aces.id, "yellow", hours(1)));
      expect(await w.card(p.userId, w.aces.id, "yellow", hours(60))).toEqual(
        err("too_late"),
      );
      await db
        .update(game)
        .set({ status: "cancelled" })
        .where(eq(game.id, w.played.gameId));
      expect(await w.card(p.userId, w.aces.id, "yellow", hours(1))).toEqual(
        err("called_off"),
      );
    });
  });
});

describe("undoing a card", () => {
  it("lets the giver take it back within minutes, and an admin later", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const p = w.aces.players[0]!;
      const first = given(await w.card(p.userId, w.aces.id));
      const undo = (id: GameCardId, by: UserId, isAdmin: boolean, at: Date) =>
        undoCard(db, {
          cardId: id,
          gameId: w.played.gameId,
          by,
          isAdmin,
          now: at,
        });
      expect(await undo(first, w.ref.userId, false, minutes(2))).toEqual(
        ok(undefined),
      );
      expect(await gameCards(db, w.played.gameId)).toHaveLength(0);
      const [audit] = await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.entityId, first));
      expect(audit).toBeDefined();

      const second = given(await w.card(p.userId, w.aces.id));
      const lateMs = UNDO_WINDOW_MS / 60_000 + 1;
      expect(await undo(second, w.ref.userId, false, minutes(lateMs))).toEqual(
        err("too_late"),
      );
      expect(
        await undo(second, w.aces.captain.userId, false, minutes(1)),
      ).toEqual(err("too_late"));
      expect(await undo(second, w.admin.userId, true, minutes(lateMs))).toEqual(
        ok(undefined),
      );
      expect(await undo(second, w.admin.userId, true, minutes(lateMs))).toEqual(
        err("not_found"),
      );
    });
  });

  it("will not undo a card through another game's page", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const other = await w.gameEnding(hours(-30), w.ref.userId);
      const id = given(await w.card(w.aces.players[0]!.userId, w.aces.id));
      expect(
        await undoCard(db, {
          cardId: id,
          gameId: other.gameId,
          by: w.ref.userId,
          isAdmin: false,
          now: minutes(1),
        }),
      ).toEqual(err("not_found"));
    });
  });
});

describe("reading cards", () => {
  it("lists carded players for admins and a player's own cards, in their export, and keeps cards when the account closes", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const p = w.aces.players[0]!;
      given(await w.card(p.userId, w.aces.id, "yellow"));
      given(await w.card(w.bees.players[0]!.userId, w.bees.id, "red"));
      const players = await cardedPlayers(db);
      expect(players.map((x) => x.userId).sort()).toEqual(
        [p.userId, w.bees.players[0]!.userId].sort(),
      );
      expect((await myCards(db, p.userId)).map((c) => c.color)).toEqual([
        "yellow",
      ]);
      const data = await personalData(db, p.userId, NOW);
      expect(JSON.stringify(data)).toContain("cardsYouReceived");
      await deleteAccount(db, p.userId, NOW);
      expect(await gameCards(db, w.played.gameId)).toHaveLength(2);
    });
  });
});
