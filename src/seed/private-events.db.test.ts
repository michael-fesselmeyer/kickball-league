import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { acceptPrivateEvent, requestPrivateEvent } from "@/db/queries/private-events";
import { privateEvent } from "@/db/schema/private-event";
import { season } from "@/db/schema/season";
import { leagueWorld, NOW } from "@/db/test/league-world";
import { closePool, inRolledBackDb } from "@/db/test/transaction";
import { parseAcceptance, parseRequest } from "@/domain/private-events/request";
import { removeSeedPrivateEvents } from "./private-events";

afterAll(closePool);

const ok = <T>(r: { ok: true; value: T } | { ok: false; error: unknown }) => {
  if (!r.ok) throw new Error(String(r.error));
  return r.value;
};

describe("clearing private events before a reseed", () => {
  it("lets the league, its season and the organizer be deleted, twice over", () =>
    inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      const asked = ok(
        parseRequest({
          kind: "tournament",
          organization: "Example Widgets Co",
          teams: "4",
          preferredDates: "A Saturday in May",
          note: "",
        }),
      );
      const requested = ok(
        await requestPrivateEvent(db, {
          leagueId: w.leagueId,
          organizerId: w.agent,
          request: asked,
          now: NOW,
        }),
      );
      ok(
        await acceptPrivateEvent(db, {
          leagueId: w.leagueId,
          eventId: requested.id,
          actorId: w.admin,
          acceptance: ok(
            parseAcceptance({
              name: "Example Widgets Tournament",
              startsOn: "2027-05-08",
              payer: "organization",
              amount: "100",
              gamesPerTeamPerDay: "2",
            }),
          ),
          now: NOW,
        }),
      );

      // The restriction the reseed hit: the season cannot go while an event holds it.
      const [held] = await db
        .select({ seasonId: privateEvent.seasonId })
        .from(privateEvent);
      expect(held?.seasonId).toBeTruthy();
      const ids = { leagueIds: [w.leagueId], userIds: [w.agent] };
      for (let run = 0; run < 2; run++) {
        await removeSeedPrivateEvents(db, ids);
        expect(
          await db
            .select({ id: privateEvent.id })
            .from(privateEvent)
            .where(eq(privateEvent.leagueId, w.leagueId)),
        ).toEqual([]);
      }
      // With the event gone, the season can be deleted.
      await db.delete(season).where(eq(season.id, held!.seasonId!));
    }));
});
