import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { UserId } from "@/domain/ids";
import { hashWaiverBody } from "@/domain/waiver/waiver";
import { user } from "../schema/auth";
import { league } from "../schema/league";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { registration } from "../schema/team";
import { waiverSignature } from "../schema/waiver";
import { closePool, inRolledBackDb } from "../test/transaction";
import { confirmAge } from "./age";
import { acceptInvite, createTeamInvite } from "./invites";
import {
  registerFreeAgent,
  registerTeam,
  seasonForRegistration,
} from "./registration";
import type { Db } from "./schedule";
import { assignWaiver, publishWaiver, signWaiver } from "./waivers";

afterAll(closePool);

const NOW = new Date("2027-02-15T17:00:00Z");
const BODY = `# Sample\n\n${"Sample text for tests only. ".repeat(10)}`;

/**
 * An invented league with an open spring season and three people: Robin
 * (born 1994), Sam (turns 21 the day after NOW, in New York) and Alex (no
 * birth date on file).
 */
async function world(db: Db, seasonMinimum: number | null = null) {
  const tag = Math.random().toString(36).slice(2, 8);
  const people = await db
    .insert(user)
    .values(
      ["robin", "sam", "alex"].map((p) => ({
        name: p,
        email: `age-${p}-${tag}@example.test`,
      })),
    )
    .returning({ id: user.id });
  const [robin, sam, alex] = people.map((p) => p.id) as [
    UserId,
    UserId,
    UserId,
  ];
  await db.insert(profile).values([
    {
      userId: robin,
      firstName: "Robin",
      lastName: "Example",
      birthDate: "1994-05-17",
    },
    {
      userId: sam,
      firstName: "Sam",
      lastName: "Example",
      birthDate: "2006-02-16",
    },
    { userId: alex, firstName: "Alex", lastName: "Example" },
  ]);
  const [lg] = await db
    .insert(league)
    .values({ name: "Age League", slug: `age-${tag}` })
    .returning({ id: league.id });
  if (!lg) throw new Error("no league");
  await db.insert(season).values({
    leagueId: lg.id,
    name: "Spring",
    slug: "spring",
    status: "registration_open",
    startsOn: "2027-04-05",
    endsOn: "2027-06-28",
    feeModel: "per_team",
    teamFeeCents: 120_000,
    freeAgentFeeCents: 9000,
    registrationOpensAt: new Date("2027-02-01T05:00:00Z"),
    registrationClosesAt: new Date("2027-03-23T03:59:59Z"),
    rosterMin: 2,
    rosterMax: 20,
    minimumAge: seasonMinimum,
  });
  const s = await seasonForRegistration(db, lg.id, "spring");
  if (!s) throw new Error("no season");
  return { leagueId: lg.id, season: s, robin, sam, alex };
}

const team = (name: string) => ({
  teamId: null,
  name,
  colorHex: null,
  paymentMode: "split" as const,
  rosterSize: 10,
});

const stored = async (db: Db, userId: UserId) => {
  const [row] = await db
    .select({
      min: registration.ageConfirmedMin,
      at: registration.ageConfirmedAt,
    })
    .from(registration)
    .where(eq(registration.userId, userId));
  return row;
};

describe("the age check at registration", () => {
  it("uses the league's 21 unless the season sets its own", () =>
    inRolledBackDb(async (db) => {
      expect((await world(db)).season.minimumAge).toBe(21);
      expect((await world(db, 25)).season.minimumAge).toBe(25);
    }));

  it("stores only the confirmation and its time with a team registration", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const registered = await registerTeam(db, {
        leagueId: w.leagueId,
        season: w.season,
        userId: w.robin,
        team: team("Kick Bottom"),
        ageConfirmed: true,
        now: NOW,
      });
      expect(registered.ok).toBe(true);
      expect(await stored(db, w.robin)).toEqual({ min: 21, at: NOW });
    }));

  it("refuses a registration without the confirmation", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      expect(
        await registerFreeAgent(db, {
          season: w.season,
          userId: w.robin,
          ageConfirmed: false,
          now: NOW,
        }),
      ).toEqual({ ok: false, error: "age_unconfirmed" });
      expect(await stored(db, w.robin)).toBeUndefined();
    }));

  it("refuses someone the birth date on file says is too young, even if they tick the box", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      expect(
        await registerFreeAgent(db, {
          season: w.season,
          userId: w.sam,
          ageConfirmed: true,
          now: NOW,
        }),
      ).toEqual({ ok: false, error: "under_age" });
      // The next day in New York, Sam is 21.
      const later = new Date("2027-02-16T17:00:00Z");
      expect(
        (
          await registerFreeAgent(db, {
            season: w.season,
            userId: w.sam,
            ageConfirmed: true,
            now: later,
          })
        ).ok,
      ).toBe(true);
    }));

  it("takes the confirmation alone when there is no birth date on file", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db, 30);
      const result = await confirmAge(db, {
        userId: w.alex,
        seasonId: w.season.id,
        confirmed: true,
        now: NOW,
      });
      expect(result).toEqual({
        ok: true,
        value: { ageConfirmedMin: 30, ageConfirmedAt: NOW },
      });
      // Robin (32) is under a season minimum of 35.
      const strict = await world(db, 35);
      expect(
        (
          await confirmAge(db, {
            userId: strict.robin,
            seasonId: strict.season.id,
            confirmed: true,
            now: NOW,
          })
        ).ok,
      ).toBe(false);
    }));

  it("checks a player joining by a captain's invite", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const registered = await registerTeam(db, {
        leagueId: w.leagueId,
        season: w.season,
        userId: w.robin,
        team: team("Foul Play"),
        ageConfirmed: true,
        now: NOW,
      });
      if (!registered.ok) throw new Error(registered.error);
      const { token } = await createTeamInvite(db, {
        teamSeasonId: registered.value.teamSeasonId,
        actorId: w.robin,
        now: NOW,
      });
      const join = (userId: UserId, ageConfirmed: boolean) =>
        acceptInvite(db, { token, userId, ageConfirmed, now: NOW });
      expect(await join(w.sam, true)).toEqual({
        ok: false,
        error: "under_age",
      });
      expect(await join(w.alex, false)).toEqual({
        ok: false,
        error: "age_unconfirmed",
      });
      expect((await join(w.alex, true)).ok).toBe(true);
      expect(await stored(db, w.alex)).toEqual({ min: 21, at: NOW });
    }));
});

describe("the age check on the waiver", () => {
  it("stores the confirmation with the signature and refuses without it", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const published = await publishWaiver(
        db,
        { leagueId: w.leagueId, title: "Release", body: BODY },
        w.robin,
      );
      if (!published.ok) throw new Error("not published");
      await assignWaiver(
        db,
        {
          leagueId: w.leagueId,
          seasonId: w.season.id,
          waiverId: published.value.id,
        },
        w.robin,
      );
      const sign = (userId: UserId, name: string, ageConfirmed: boolean) =>
        signWaiver(db, {
          userId,
          seasonId: w.season.id,
          shownSha256: hashWaiverBody(BODY),
          agreed: true,
          ageConfirmed,
          signedName: name,
          ip: null,
          userAgent: null,
        });
      expect(await sign(w.robin, "Robin Example", false)).toEqual({
        ok: false,
        error: "age_unconfirmed",
      });
      expect(await sign(w.sam, "Sam Example", true)).toEqual({
        ok: false,
        error: "under_age",
      });
      expect((await sign(w.robin, "Robin Example", true)).ok).toBe(true);
      const [row] = await db
        .select({ min: waiverSignature.ageConfirmedMin })
        .from(waiverSignature)
        .where(eq(waiverSignature.userId, w.robin));
      expect(row?.min).toBe(21);
    }));
});

/** The constraint that refused `statement`, run in a savepoint. */
async function refusedBy(
  db: Db,
  statement: (tx: Db) => Promise<unknown>,
): Promise<string | undefined> {
  try {
    await db.transaction(async (tx) => {
      await statement(tx);
    });
  } catch (error) {
    const cause = error instanceof Error ? error.cause : undefined;
    for (const e of [error, cause])
      if (
        e instanceof Error &&
        "constraint" in e &&
        typeof e.constraint === "string"
      )
        return e.constraint;
  }
  return undefined;
}

describe("the age columns", () => {
  it("keep the age and its time together, within 18 to 99", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const insert =
        (values: Partial<typeof registration.$inferInsert>) => (tx: Db) =>
          tx.insert(registration).values({
            seasonId: w.season.id,
            userId: w.alex,
            kind: "free_agent",
            ...values,
          });
      expect(await refusedBy(db, insert({ ageConfirmedMin: 21 }))).toBe(
        "registration_age_confirmed",
      );
      expect(
        await refusedBy(
          db,
          insert({ ageConfirmedMin: 12, ageConfirmedAt: NOW }),
        ),
      ).toBe("registration_age_confirmed");
      expect(
        await refusedBy(db, (tx) =>
          tx
            .update(season)
            .set({ minimumAge: 17 })
            .where(eq(season.id, w.season.id)),
        ),
      ).toBe("season_minimum_age");
    }));
});
