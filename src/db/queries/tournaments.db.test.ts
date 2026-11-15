import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { EventId } from "@/domain/ids";
import { hashWaiverBody } from "@/domain/waiver/waiver";
import { seededRandom } from "@/domain/random";
import type { TournamentSettings } from "@/domain/tournaments/tournament";
import { auditLog } from "../schema/audit";
import { event } from "../schema/event";
import { friendLeague } from "../schema/friends";
import { guestTeam,guestWaiverSignature, tournament } from "../schema/tournament";
import { waiver } from "../schema/waiver";
import { leagueWorld } from "../test/league-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import type { Db } from "./schedule";
import {
  adminGuestTeams,
  drawBracket,
  guestTeamByToken,
  partnerTournaments,
  publicTournament,
  purgeGuestData,
  registerGuestTeam,
  removeGuestTeam,
  resetBracket,
  saveTournament,
  signGuestWaiver,
  tournamentOf,
  updateBracketGame,
} from "./tournaments";

afterAll(closePool);

const ENDS = new Date("2027-06-05T22:00:00Z");
const BEFORE = new Date("2027-05-01T12:00:00Z");

const settings: TournamentSettings = {
  guestSignupsOpen: true,
  maxGuestTeams: null,
  partnerFriendLeagueId: null,
  charity: null,
  guestDataDays: 30,
};

const guest = (n: number) => ({
  teamName: `Guest Team ${n}`,
  captainName: `Captain ${n}`,
  captainEmail: `captain${n}@example.test`,
  rosterSize: 6,
});

async function setUp(db: Db, change: Partial<TournamentSettings> = {}) {
  const w = await leagueWorld(db);
  const [e] = await db
    .insert(event)
    .values({
      leagueId: w.leagueId,
      kind: "tournament",
      title: "Test Charity Cup",
      slug: `test-charity-cup-${Math.random().toString(36).slice(2, 8)}`,
      place: "Test Park",
      startsAt: new Date("2027-06-05T14:00:00Z"),
      endsAt: ENDS,
    })
    .returning({ id: event.id });
  const eventId = e?.id as EventId;
  const saved = await saveTournament(db, {
    leagueId: w.leagueId,
    eventId,
    settings: { ...settings, ...change },
    actorId: w.admin,
  });
  if (!saved.ok) throw new Error(saved.error);
  const body = "# Test waiver\n\nPlay at your own risk.";
  await db.insert(waiver).values({
    leagueId: w.leagueId,
    version: 900,
    title: "Test waiver",
    bodyMd: body,
    bodySha256: hashWaiverBody(body),
  });
  return { w, eventId, sha: hashWaiverBody(body) };
}

const enter = async (db: Db, eventId: EventId, n: number) => {
  const r = await registerGuestTeam(db, {
    eventId,
    signup: guest(n),
    now: BEFORE,
  });
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

describe("saving a tournament", () => {
  it("makes one only for a tournament event of this league, and audits it", async () => {
    await inRolledBackDb(async (db) => {
      const { w, eventId } = await setUp(db);
      expect((await tournamentOf(db, eventId))?.guestDataDays).toBe(30);
      const [social] = await db
        .insert(event)
        .values({
          leagueId: w.leagueId,
          kind: "social",
          title: "Test Social",
          slug: `test-social-${Math.random().toString(36).slice(2, 8)}`,
          place: "Test Bar",
          startsAt: ENDS,
          endsAt: new Date(ENDS.getTime() + 3600_000),
        })
        .returning({ id: event.id });
      expect(
        await saveTournament(db, {
          leagueId: w.leagueId,
          eventId: social?.id as EventId,
          settings,
          actorId: w.admin,
        }),
      ).toEqual({ ok: false, error: "not_a_tournament" });
      const actions = (
        await db.select({ a: auditLog.action }).from(auditLog).where(eq(auditLog.entityId, eventId))
      ).map((r) => r.a);
      expect(actions).toContain("tournament.create");
    });
  });

  it("refuses a cap below the teams already in", async () => {
    await inRolledBackDb(async (db) => {
      const { w, eventId } = await setUp(db);
      await enter(db, eventId, 1);
      await enter(db, eventId, 2);
      expect(
        await saveTournament(db, {
          leagueId: w.leagueId,
          eventId,
          settings: { ...settings, maxGuestTeams: 1 },
          actorId: w.admin,
        }),
      ).toEqual({ ok: false, error: "under_cap" });
    });
  });
});

describe("guest sign-up", () => {
  it("enters teams, keeps names unique, and stops at the cap", async () => {
    await inRolledBackDb(async (db) => {
      const { eventId } = await setUp(db, { maxGuestTeams: 2 });
      await enter(db, eventId, 1);
      const again = await registerGuestTeam(db, {
        eventId,
        signup: { ...guest(2), teamName: "GUEST TEAM 1" },
        now: BEFORE,
      });
      expect(again).toEqual({ ok: false, error: "name_taken" });
      await enter(db, eventId, 2);
      const third = await registerGuestTeam(db, { eventId, signup: guest(3), now: BEFORE });
      expect(third).toEqual({ ok: false, error: "full" });
    });
  });

  it("closes when switched off, after the event, and once the bracket is drawn", async () => {
    await inRolledBackDb(async (db) => {
      const { w, eventId } = await setUp(db);
      await enter(db, eventId, 1);
      await enter(db, eventId, 2);
      const late = await registerGuestTeam(db, {
        eventId,
        signup: guest(3),
        now: new Date(ENDS.getTime() + 1000),
      });
      expect(late).toEqual({ ok: false, error: "over" });
      await drawBracket(db, {
        leagueId: w.leagueId,
        eventId,
        order: (t) => t,
        actorId: w.admin,
      });
      expect(
        await registerGuestTeam(db, { eventId, signup: guest(4), now: BEFORE }),
      ).toEqual({ ok: false, error: "closed" });
      await db.update(tournament).set({ bracket: null, guestSignupsOpen: false }).where(eq(tournament.eventId, eventId));
      expect(
        await registerGuestTeam(db, { eventId, signup: guest(5), now: BEFORE }),
      ).toEqual({ ok: false, error: "closed" });
    });
  });

  it("shows the public page team names only", async () => {
    await inRolledBackDb(async (db) => {
      const { eventId } = await setUp(db, {
        charity: { name: "Test Food Pantry", url: "https://pantry.example.test/give", goalCents: 250000 },
      });
      await enter(db, eventId, 1);
      const pub = await publicTournament(db, { id: eventId, endsAt: ENDS, cancelledAt: null }, BEFORE);
      expect(pub?.guestTeams).toEqual(["Guest Team 1"]);
      expect(pub?.charity?.goalCents).toBe(250000);
      expect(JSON.stringify(pub)).not.toContain("captain1@example.test");
      expect(pub?.signup).toBe("open");
    });
  });
});

describe("waiver by link", () => {
  it("records a signature, once per name, up to the roster size", async () => {
    await inRolledBackDb(async (db) => {
      const { eventId, sha } = await setUp(db);
      const { linkToken } = await enter(db, eventId, 1);
      const team = await guestTeamByToken(db, linkToken);
      expect(team?.waiver?.bodySha256).toBe(sha);
      const sign = (signedName: string, shownSha256 = sha) =>
        signGuestWaiver(db, { token: linkToken, signedName, shownSha256, now: BEFORE });
      expect((await sign("Pat Example")).ok).toBe(true);
      expect(await sign("pat example")).toEqual({ ok: false, error: "already_signed" });
      for (const n of ["B One", "C Two", "D Three", "E Four", "F Five"]) {
        expect((await sign(n)).ok).toBe(true);
      }
      expect(await sign("G Six")).toEqual({ ok: false, error: "roster_full" });
      expect((await guestTeamByToken(db, linkToken))?.signed).toBe(6);
    });
  });

  it("refuses a stale text, an unknown link and a finished event", async () => {
    await inRolledBackDb(async (db) => {
      const { eventId, sha } = await setUp(db);
      const { linkToken } = await enter(db, eventId, 1);
      expect(
        await signGuestWaiver(db, { token: linkToken, signedName: "Pat Example", shownSha256: "0".repeat(64), now: BEFORE }),
      ).toEqual({ ok: false, error: "changed" });
      expect(
        await signGuestWaiver(db, { token: "x".repeat(32), signedName: "Pat Example", shownSha256: sha, now: BEFORE }),
      ).toEqual({ ok: false, error: "no_team" });
      expect(
        await signGuestWaiver(db, { token: linkToken, signedName: "Pat Example", shownSha256: sha, now: ENDS }),
      ).toEqual({ ok: false, error: "over" });
    });
  });
});

describe("guest teams in the bracket", () => {
  it("draws, plays through to a champion, and keeps a team in the bracket from being removed", async () => {
    await inRolledBackDb(async (db) => {
      const { w, eventId } = await setUp(db);
      const ids = [];
      for (const n of [1, 2, 3]) ids.push((await enter(db, eventId, n)).id);
      const drawn = await drawBracket(db, {
        leagueId: w.leagueId,
        eventId,
        order: (t) => seededRandom(7).shuffle(t),
        actorId: w.admin,
      });
      if (!drawn.ok) throw new Error(drawn.error);
      expect(drawn.value.seeds).toHaveLength(3);
      expect(
        await drawBracket(db, { leagueId: w.leagueId, eventId, order: (t) => t, actorId: w.admin }),
      ).toEqual({ ok: false, error: "already_drawn" });
      expect(
        await removeGuestTeam(db, { leagueId: w.leagueId, eventId, teamId: ids[0]!, actorId: w.admin }),
      ).toEqual({ ok: false, error: "in_bracket" });
      let bracket = drawn.value;
      for (let i = 0; i < 4 && !bracket.champion; i++) {
        const game = bracket.matches.find((m) => m.teamA && m.teamB && !m.winner);
        if (!game) break;
        const r = await updateBracketGame(db, {
          leagueId: w.leagueId,
          eventId,
          code: game.code,
          change: { kind: "score", scoreA: 7, scoreB: 3 },
          actorId: w.admin,
        });
        if (!r.ok) throw new Error(r.error);
        bracket = r.value;
      }
      expect(bracket.champion).not.toBeNull();
      expect(
        await resetBracket(db, { leagueId: w.leagueId, eventId, actorId: w.admin }),
      ).toEqual({ ok: false, error: "has_results" });
      expect((await publicTournament(db, { id: eventId, endsAt: ENDS, cancelledAt: null }, BEFORE))?.bracket?.champion).toBe(bracket.champion);
    });
  });

  it("resets an unplayed bracket and then lets a team go", async () => {
    await inRolledBackDb(async (db) => {
      const { w, eventId } = await setUp(db);
      const a = await enter(db, eventId, 1);
      await enter(db, eventId, 2);
      await drawBracket(db, { leagueId: w.leagueId, eventId, order: (t) => t, actorId: w.admin });
      expect((await resetBracket(db, { leagueId: w.leagueId, eventId, actorId: w.admin })).ok).toBe(true);
      expect(
        (await removeGuestTeam(db, { leagueId: w.leagueId, eventId, teamId: a.id, actorId: w.admin })).ok,
      ).toBe(true);
      expect(await adminGuestTeams(db, eventId)).toHaveLength(1);
    });
  });

  it("needs two teams to draw", async () => {
    await inRolledBackDb(async (db) => {
      const { w, eventId } = await setUp(db);
      await enter(db, eventId, 1);
      expect(
        await drawBracket(db, { leagueId: w.leagueId, eventId, order: (t) => t, actorId: w.admin }),
      ).toEqual({ ok: false, error: "too_few" });
    });
  });
});

describe("deleting guest data", () => {
  it("deletes teams, emails and signatures the set number of days after the event, and keeps the bracket", async () => {
    await inRolledBackDb(async (db) => {
      const { w, eventId, sha } = await setUp(db, { guestDataDays: 10 });
      const { linkToken } = await enter(db, eventId, 1);
      await enter(db, eventId, 2);
      await signGuestWaiver(db, { token: linkToken, signedName: "Pat Example", shownSha256: sha, now: BEFORE });
      await drawBracket(db, { leagueId: w.leagueId, eventId, order: (t) => t, actorId: w.admin });

      const day = 86_400_000;
      expect(await purgeGuestData(db, new Date(ENDS.getTime() + 9 * day))).toBe(0);
      expect(await adminGuestTeams(db, eventId)).toHaveLength(2);

      expect(await purgeGuestData(db, new Date(ENDS.getTime() + 10 * day))).toBe(1);
      expect(await adminGuestTeams(db, eventId)).toHaveLength(0);
      expect(await db.select().from(guestTeam).where(eq(guestTeam.eventId, eventId))).toEqual([]);
      const left = await db.select().from(guestWaiverSignature);
      expect(left.filter((s) => s.signedName === "Pat Example")).toEqual([]);
      const t = await tournamentOf(db, eventId);
      expect(t?.guestDataDeletedAt).not.toBeNull();
      expect(t?.bracket?.seeds).toHaveLength(2);
      // The waiver link no longer works, and a second sweep does nothing.
      expect(await guestTeamByToken(db, linkToken)).toBeNull();
      expect(await purgeGuestData(db, new Date(ENDS.getTime() + 11 * day))).toBe(0);
    });
  });

  it("clears at once for an event an admin deleted", async () => {
    await inRolledBackDb(async (db) => {
      const { eventId } = await setUp(db);
      await enter(db, eventId, 1);
      await db.update(event).set({ deletedAt: BEFORE }).where(eq(event.id, eventId));
      expect(await purgeGuestData(db, BEFORE)).toBe(1);
      expect(await adminGuestTeams(db, eventId)).toHaveLength(0);
    });
  });
});

describe("partner cards", () => {
  it("lists upcoming public tournaments with a partner league only", async () => {
    await inRolledBackDb(async (db) => {
      const { w, eventId } = await setUp(db);
      expect(await partnerTournaments(db, w.leagueId, BEFORE)).toEqual([]);
      const [friend] = await db
        .insert(friendLeague)
        .values({
          leagueId: w.leagueId,
          name: "Test Other Kickball League",
          activity: "other",
          url: "https://other-league.example.test/",
        })
        .returning({ id: friendLeague.id });
      const saved = await saveTournament(db, {
        leagueId: w.leagueId,
        eventId,
        settings: { ...settings, partnerFriendLeagueId: friend?.id ?? null },
        actorId: w.admin,
      });
      expect(saved.ok).toBe(true);
      const cards = await partnerTournaments(db, w.leagueId, BEFORE);
      expect(cards).toHaveLength(1);
      expect(cards[0]?.friendLeagueId).toBe(friend?.id);
      expect(
        (await publicTournament(db, { id: eventId, endsAt: ENDS, cancelledAt: null }, BEFORE))?.partner?.name,
      ).toBe("Test Other Kickball League");
      // Once it is over the card goes.
      expect(await partnerTournaments(db, w.leagueId, ENDS)).toEqual([]);
      // A partner from nowhere is refused.
      const stranger = await saveTournament(db, {
        leagueId: w.leagueId,
        eventId,
        settings: { ...settings, partnerFriendLeagueId: "00000000-0000-4000-8000-000000000000" },
        actorId: w.admin,
      });
      expect(stranger).toEqual({ ok: false, error: "partner_unknown" });
    });
  });
});
