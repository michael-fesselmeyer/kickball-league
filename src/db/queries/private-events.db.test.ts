import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_MVP_WEIGHTS } from "@/domain/awards/stat-awards";
import { can } from "@/domain/authz/permissions";
import { parseAcceptance, parseRequest } from "@/domain/private-events/request";
import { message } from "../schema/message";
import { purchase, purchaseItem } from "../schema/money";
import { privateEvent } from "../schema/private-event";
import { season } from "../schema/season";
import { statAwardSet } from "../schema/stat-awards";
import { teamSeason } from "../schema/team";
import { leagueWorld, NOW } from "../test/league-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import { leagueHistory } from "./history";
import { settlePurchase } from "./payments";
import {
  acceptPrivateEvent,
  declinePrivateEvent,
  inviteMatches,
  myPrivateEvents,
  organizerPurchase,
  privateEventBySeason,
  privateEventQueue,
  privateEventTeams,
  requestPrivateEvent,
  seasonForInvite,
} from "./private-events";
import {
  openSeasons,
  registerTeam,
  seasonForRegistration,
} from "./registration";
import type { Db } from "./schedule";
import { publicSeasons, publicTeams } from "./sitemap";
import { awardsBoard, publishedAwardSeasons } from "./stat-awards";
import { widgetSeasons } from "./widget";
import { loadSubject } from "./subject";

afterAll(closePool);

const ok = <T>(r: { ok: true; value: T } | { ok: false; error: unknown }) => {
  if (!r.ok) throw new Error(String(r.error));
  return r.value;
};

const asked = ok(
  parseRequest({
    kind: "tournament",
    organization: "Example Widgets Co",
    teams: "4",
    preferredDates: "A Saturday in May",
    note: "",
  }),
);

const terms = (payer: "organization" | "players", amount: string) =>
  ok(
    parseAcceptance({
      name: "Example Widgets Tournament",
      startsOn: "2027-05-08",
      payer,
      amount,
      gamesPerTeamPerDay: "2",
    }),
  );

/** The organizer is the world's free agent; the admin accepts. */
async function requested(db: Db) {
  const w = await leagueWorld(db);
  const event = ok(
    await requestPrivateEvent(db, {
      leagueId: w.leagueId,
      organizerId: w.agent,
      request: asked,
      now: NOW,
    }),
  );
  return { ...w, eventId: event.id };
}

describe("booking a private league or tournament", () => {
  it("queues the request for admins and confirms it to the organizer", () =>
    inRolledBackDb(async (db) => {
      const w = await requested(db);
      const queue = await privateEventQueue(db, w.leagueId);
      expect(queue.map((r) => [r.organization, r.status])).toEqual([
        ["Example Widgets Co", "requested"],
      ]);
      expect(queue[0]?.organizerEmail).toMatch(/@example\.test$/);
      const sent = await db
        .select({ template: message.template, payload: message.payload })
        .from(message)
        .where(eq(message.userId, w.agent));
      expect(sent).toEqual([
        {
          template: "private_event",
          payload: {
            step: "received",
            organization: "Example Widgets Co",
            kind: "tournament",
          },
        },
      ]);
      expect(
        (await myPrivateEvents(db, w.leagueId, w.agent)).map((e) => e.status),
      ).toEqual(["requested"]);
      expect(await myPrivateEvents(db, w.leagueId, w.captain)).toEqual([]);
    }));

  it("takes three requests a day from one person", () =>
    inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      const ask = () =>
        requestPrivateEvent(db, {
          leagueId: w.leagueId,
          organizerId: w.captain,
          request: asked,
          now: NOW,
        });
      for (let i = 0; i < 3; i += 1) expect((await ask()).ok).toBe(true);
      expect(await ask()).toEqual({ ok: false, error: "too_many" });
    }));

  it("declines once, with the reason for the organizer", () =>
    inRolledBackDb(async (db) => {
      const w = await requested(db);
      const decline = () =>
        declinePrivateEvent(db, {
          leagueId: w.leagueId,
          eventId: w.eventId,
          actorId: w.admin,
          reason: "No fields that weekend.",
          now: NOW,
        });
      expect((await decline()).ok).toBe(true);
      expect(await decline()).toEqual({ ok: false, error: "not_open" });
      const [notice] = await db
        .select({ payload: message.payload })
        .from(message)
        .where(eq(message.dedupeKey, `private-event:${w.eventId}:declined`));
      expect(notice?.payload).toMatchObject({
        step: "declined",
        reason: "No fields that weekend.",
      });
    }));

  it("keeps an accepted request whole: a season, a payer and an invite", () =>
    inRolledBackDb(async (db) => {
      const w = await requested(db);
      // The last statement: a rejected one ends the rolled-back transaction.
      const error = await db
        .update(privateEvent)
        .set({ status: "accepted" })
        .where(eq(privateEvent.id, w.eventId))
        .then(
          () => null,
          (e: unknown) => e,
        );
      expect(
        JSON.stringify(error, Object.getOwnPropertyNames(error ?? {})),
      ).toContain("private_event_accepted_has_season");
    }));
});

describe("a private season", () => {
  it("opens by invite only, and teams join free when the organization pays", () =>
    inRolledBackDb(async (db) => {
      const w = await requested(db);
      const accepted = ok(
        await acceptPrivateEvent(db, {
          leagueId: w.leagueId,
          eventId: w.eventId,
          actorId: w.admin,
          acceptance: terms("organization", "600"),
          now: NOW,
        }),
      );
      expect(accepted.seasonSlug).toBe("private-example-widgets-co-2027-05-08");
      const [created] = await db
        .select()
        .from(season)
        .where(eq(season.id, accepted.seasonId));
      expect(created).toMatchObject({
        visibility: "private",
        status: "registration_open",
        feeModel: "per_team",
        teamFeeCents: 0,
        maxTeams: 4,
        gamesPerTeamPerDay: 2,
      });

      const event = await privateEventBySeason(
        db,
        w.leagueId,
        accepted.seasonSlug,
      );
      const token = event?.inviteToken ?? "";
      expect(token).toMatch(/^[A-Za-z0-9_-]{24}$/);
      expect((await seasonForInvite(db, token))?.slug).toBe(
        accepted.seasonSlug,
      );
      expect(await seasonForInvite(db, "not-a-real-invite-token")).toBeNull();
      expect(await inviteMatches(db, accepted.seasonId, token)).toBe(true);
      expect(await inviteMatches(db, w.season.id, token)).toBe(false);
      expect(await inviteMatches(db, accepted.seasonId, null)).toBe(false);

      // A captain enters a team through the invite: no fee to pay.
      const s = await seasonForRegistration(
        db,
        w.leagueId,
        accepted.seasonSlug,
      );
      if (!s) throw new Error("no season");
      const entered = ok(
        await registerTeam(db, {
          leagueId: w.leagueId,
          season: s,
          userId: w.admin,
          ageConfirmed: true,
          team: {
            teamId: null,
            name: "Widget Kickers",
            colorHex: null,
            paymentMode: "full",
            rosterSize: 10,
          },
          now: NOW,
        }),
      );
      expect(entered.shareCents).toBeNull();
      const teams = await privateEventTeams(db, accepted.seasonId);
      expect(teams.map((t) => [t.name, t.players])).toEqual([
        ["Widget Kickers", 1],
      ]);

      // The organization pays once; the webhook's settlement marks it paid.
      const bill = await organizerPurchase(db, {
        eventId: w.eventId,
        userId: w.agent,
      });
      expect(bill?.totalCents).toBe(60_000);
      const [line] = await db
        .select({ kind: purchaseItem.kind, amount: purchaseItem.amountCents })
        .from(purchaseItem)
        .where(eq(purchaseItem.purchaseId, bill!.purchaseId));
      expect(line).toEqual({ kind: "private_event", amount: 60_000 });
      await settlePurchase(db, bill!.purchaseId, null, NOW);
      const [paid] = await db
        .select({ paidAt: privateEvent.paidAt })
        .from(privateEvent)
        .where(eq(privateEvent.id, w.eventId));
      expect(paid?.paidAt).toEqual(NOW);
      const [p] = await db
        .select({ status: purchase.status })
        .from(purchase)
        .where(eq(purchase.id, bill!.purchaseId));
      expect(p?.status).toBe("paid");
      // Nothing more to pay.
      expect(
        await organizerPurchase(db, { eventId: w.eventId, userId: w.agent }),
      ).toBeNull();
    }));

  it("charges each player when players pay, and the organization nothing", () =>
    inRolledBackDb(async (db) => {
      const w = await requested(db);
      const accepted = ok(
        await acceptPrivateEvent(db, {
          leagueId: w.leagueId,
          eventId: w.eventId,
          actorId: w.admin,
          acceptance: terms("players", "40"),
          now: NOW,
        }),
      );
      const [created] = await db
        .select({ fee: season.playerFeeCents, model: season.feeModel })
        .from(season)
        .where(eq(season.id, accepted.seasonId));
      expect(created).toEqual({ fee: 4000, model: "per_player" });
      expect(
        await organizerPurchase(db, { eventId: w.eventId, userId: w.agent }),
      ).toBeNull();
    }));

  it("never appears in public season lists, the sitemap, history or sign-up", () =>
    inRolledBackDb(async (db) => {
      const w = await requested(db);
      const accepted = ok(
        await acceptPrivateEvent(db, {
          leagueId: w.leagueId,
          eventId: w.eventId,
          actorId: w.admin,
          acceptance: terms("organization", "0"),
          now: NOW,
        }),
      );
      // Move it along as if it had been played.
      await db
        .update(season)
        .set({ status: "completed" })
        .where(eq(season.id, accepted.seasonId));
      await db
        .update(teamSeason)
        .set({ seasonId: accepted.seasonId })
        .where(eq(teamSeason.id, w.teamSeasonId));

      const slugs = (await publicSeasons(db, w.leagueId)).map((s) => s.slug);
      expect(slugs).not.toContain(accepted.seasonSlug);
      const history = await leagueHistory(db, w.leagueId);
      expect(history.seasonIds ?? []).not.toContain(accepted.seasonId);
      expect(history.pastSeasons.map((s) => s.slug)).not.toContain(
        accepted.seasonSlug,
      );
      const teams = (await publicTeams(db, w.leagueId)).map((t) => t.slug);
      const [moved] = await db
        .select({ teamId: teamSeason.teamId })
        .from(teamSeason)
        .where(
          and(
            eq(teamSeason.id, w.teamSeasonId),
            eq(teamSeason.seasonId, accepted.seasonId),
          ),
        );
      expect(moved).toBeDefined();
      expect(teams.some((t) => t.startsWith("private-"))).toBe(false);

      // Back to taking teams: still not in the league's sign-up list.
      await db
        .update(season)
        .set({ status: "registration_open" })
        .where(eq(season.id, accepted.seasonId));
      const open = await openSeasons(db, w.leagueId, NOW);
      expect(open.map((s) => s.slug)).not.toContain(accepted.seasonSlug);
    }));

  it("stays off the schedule widget and the awards pages", () =>
    inRolledBackDb(async (db) => {
      const w = await requested(db);
      const accepted = ok(
        await acceptPrivateEvent(db, {
          leagueId: w.leagueId,
          eventId: w.eventId,
          actorId: w.admin,
          acceptance: terms("organization", "0"),
          now: NOW,
        }),
      );
      await db
        .update(season)
        .set({ status: "in_progress" })
        .where(eq(season.id, accepted.seasonId));
      await db.insert(statAwardSet).values({
        seasonId: accepted.seasonId,
        weights: DEFAULT_MVP_WEIGHTS,
        computedAt: NOW,
        publishedAt: NOW,
      });

      expect(
        (await widgetSeasons(db, w.leagueId)).map((s) => s.id),
      ).not.toContain(accepted.seasonId);
      expect(
        (await publishedAwardSeasons(db, w.leagueId)).map((s) => s.slug),
      ).not.toContain(accepted.seasonSlug);
      expect(
        await awardsBoard(
          db,
          { leagueId: w.leagueId, seasonSlug: accepted.seasonSlug },
          { publishedOnly: true },
        ),
      ).toEqual({ found: false });
      // Its admins still see its awards.
      expect(
        (
          await awardsBoard(
            db,
            { seasonId: accepted.seasonId },
            { publishedOnly: false },
          )
        ).found,
      ).toBe(true);
    }));

  it("is shown to its organizer and admins, nobody else", () =>
    inRolledBackDb(async (db) => {
      const w = await requested(db);
      const [organizer, admin, captain] = await Promise.all([
        loadSubject(db, w.agent, w.leagueId),
        loadSubject(db, w.admin, w.leagueId),
        loadSubject(db, w.captain, w.leagueId),
      ]);
      const context = { targetUserId: w.agent };
      expect(can(organizer, "private_event.organize", context)).toBe(true);
      expect(can(admin, "private_event.organize", context)).toBe(true);
      expect(can(captain, "private_event.organize", context)).toBe(false);
      expect(can(organizer, "private_event.manage", {})).toBe(false);
      expect(can(admin, "private_event.manage", {})).toBe(true);
      expect(
        can(
          await loadSubject(db, null, w.leagueId),
          "private_event.request",
          {},
        ),
      ).toBe(false);
    }));
});
