import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  type Audience,
  canSee,
  isTold,
  PUBLIC,
  type Reach,
} from "@/domain/events/audience";
import type { EventInput } from "@/domain/events/event";
import type { SeasonId, TeamId, TeamSeasonId, UserId } from "@/domain/ids";
import { user } from "../schema/auth";
import { eventAudienceTeam } from "../schema/event";
import { league } from "../schema/league";
import { message } from "../schema/message";
import { season } from "../schema/season";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { closePool, inRolledBackDb } from "../test/transaction";
import { deleteAccount } from "./account";
import {
  announceEvent,
  audienceChoices,
  audienceNames,
  eventRecipients,
  eventsFor,
  feedVersion,
  resetFeed,
  viewerOf,
  visibleEvent,
} from "./event-audience";
import {
  createEvent,
  eventBySlug,
  joinEvent,
  leagueEvents,
  publicEventSlugs,
  themeWeeks,
  updateEvent,
} from "./events";
import type { Db } from "./schedule";

afterAll(closePool);

const NY = "America/New_York";
const NOW = new Date("2026-10-01T17:00:00Z");

const party = (title: string): EventInput => ({
  kind: "party",
  title,
  place: "The Example Hall, 1 Example St",
  description: "Dancing.",
  startsAt: new Date("2026-11-20T00:00:00Z"),
  endsAt: new Date("2026-11-20T03:00:00Z"),
  capacity: null,
});

/**
 * An invented league: Fall 2026 is being played and Summer 2026 is over.
 * Kickers and Fouls play this fall; Fouls and Ducks played in the summer.
 */
async function world(db: Db) {
  const tag = Math.random().toString(36).slice(2, 8);
  const [lg] = await db
    .insert(league)
    .values({ name: "Audience League", slug: `audience-${tag}`, timezone: NY })
    .returning({ id: league.id });
  if (!lg) throw new Error("no league");
  const plans = [
    { name: "Fall 2026", status: "in_progress", startsOn: "2026-09-01" },
    { name: "Summer 2026", status: "completed", startsOn: "2026-06-01" },
    { name: "Spring 2027", status: "draft", startsOn: "2027-04-01" },
  ] as const;
  const seasons = await db
    .insert(season)
    .values(
      plans.map((p) => ({
        leagueId: lg.id,
        name: p.name,
        slug: p.name.toLowerCase().replace(" ", "-"),
        status: p.status,
        startsOn: p.startsOn,
        endsOn: `${p.startsOn.slice(0, 8)}28`,
        feeModel: "per_player" as const,
        playerFeeCents: 4500,
        freeAgentFeeCents: 4500,
        rosterMin: 1,
        rosterMax: 20,
      })),
    )
    .returning({ id: season.id });
  const [fall, summer] = seasons.map((s) => s.id) as [SeasonId, SeasonId];
  const teams = await db
    .insert(team)
    .values(
      ["Kickers", "Fouls", "Ducks"].map((name) => ({
        leagueId: lg.id,
        name: `${name} ${tag}`,
        slug: `${name.toLowerCase()}-${tag}`,
      })),
    )
    .returning({ id: team.id });
  const [kickers, fouls, ducks] = teams.map((t) => t.id) as [
    TeamId,
    TeamId,
    TeamId,
  ];
  const entries = await db
    .insert(teamSeason)
    .values([
      { teamId: kickers, seasonId: fall, status: "confirmed" as const },
      { teamId: fouls, seasonId: fall, status: "confirmed" as const },
      { teamId: fouls, seasonId: summer, status: "confirmed" as const },
      { teamId: ducks, seasonId: summer, status: "confirmed" as const },
    ])
    .returning({ id: teamSeason.id });
  const [kickersFall, foulsFall, foulsSummer, ducksSummer] = entries.map(
    (e) => e.id,
  );

  const names = [
    "Kim Kicker",
    "Fay Foul",
    "Pam PastFoul",
    "Dot Duck",
    "Lee Lapsed",
    "Rae Removed",
    "Sam SignedUp",
    "Ada Admin",
  ];
  const people = await db
    .insert(user)
    .values(
      names.map((name, i) => ({
        name,
        email: `audience-${i}-${tag}@example.test`,
      })),
    )
    .returning({ id: user.id });
  const [kim, fay, pam, dot, lee, rae, sam, ada] = people.map((p) => p.id) as [
    UserId,
    UserId,
    UserId,
    UserId,
    UserId,
    UserId,
    UserId,
    UserId,
  ];
  const spot = async (
    userId: UserId,
    seasonId: SeasonId,
    teamSeasonId: TeamSeasonId | undefined,
    {
      status = "active",
      roster = "active",
    }: {
      status?: "active" | "cancelled";
      roster?: "active" | "removed";
    } = {},
  ) => {
    const [r] = await db
      .insert(registration)
      .values({ seasonId, userId, kind: "team_member", status })
      .returning({ id: registration.id });
    if (!r) throw new Error("no registration");
    if (teamSeasonId)
      await db.insert(rosterMembership).values({
        teamSeasonId,
        registrationId: r.id,
        status: roster,
      });
  };
  await spot(kim, fall, kickersFall);
  await spot(fay, fall, foulsFall);
  await spot(pam, summer, foulsSummer);
  await spot(dot, summer, ducksSummer);
  await spot(lee, fall, undefined, { status: "cancelled" });
  await spot(rae, fall, kickersFall, { roster: "removed" });

  const reach = (audience: Audience, extra: Partial<Reach> = {}): Reach => ({
    audience,
    inviteUrl: null,
    inAppRsvp: true,
    ...extra,
  });
  const create = (title: string, audience: Audience, extra?: Partial<Reach>) =>
    createEvent(db, {
      leagueId: lg.id,
      timeZone: NY,
      event: party(`${title} ${tag}`),
      reach: reach(audience, extra),
      actorId: ada,
    });
  const viewer = (userId: UserId) =>
    viewerOf(db, lg.id, userId, userId === ada);
  return {
    tag,
    leagueId: lg.id,
    fall,
    summer,
    kickers,
    fouls,
    ducks,
    people: { kim, fay, pam, dot, lee, rae, sam, ada },
    create,
    reach,
    viewer,
  };
}

describe("viewerOf", () => {
  it("knows who is a member and the teams they've played on", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const { kim, pam, lee, rae, sam, ada } = w.people;
      expect(await w.viewer(kim)).toEqual({
        staff: false,
        member: true,
        teams: [{ teamId: w.kickers, seasonId: w.fall }],
      });
      expect(await w.viewer(pam)).toEqual({
        staff: false,
        member: true,
        teams: [{ teamId: w.fouls, seasonId: w.summer }],
      });
      // A cancelled registration isn't membership; a removed spot isn't a team.
      expect(await w.viewer(lee)).toEqual({
        staff: false,
        member: false,
        teams: [],
      });
      expect(await w.viewer(rae)).toEqual({
        staff: false,
        member: true,
        teams: [],
      });
      expect(await w.viewer(sam)).toEqual({
        staff: false,
        member: false,
        teams: [],
      });
      expect((await w.viewer(ada)).staff).toBe(true);
    });
  });
});

describe("who sees what", () => {
  it("lists each person's events in one query, and keeps private ones off public lists", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const open = await w.create("Open", PUBLIC);
      const members = await w.create("Members", { kind: "members" });
      const fallTeams = await w.create("Fall teams", {
        kind: "teams",
        seasonId: w.fall,
        teamIds: [w.kickers, w.fouls],
      });
      const anySeason = await w.create("Any season", {
        kind: "teams",
        seasonId: null,
        teamIds: [w.fouls],
      });

      // Same time, so in title order; compared as sorted lists.
      const seen = async (userId: UserId) =>
        (await eventsFor(db, w.leagueId, userId, userId === w.people.ada))
          .map((e) => e.slug)
          .sort();
      const { kim, fay, pam, dot, lee, sam, ada } = w.people;
      expect(await seen(kim)).toEqual(
        [open.slug, members.slug, fallTeams.slug].sort(),
      );
      expect(await seen(fay)).toEqual(
        [open.slug, members.slug, fallTeams.slug, anySeason.slug].sort(),
      );
      // Played for Fouls last summer: not this fall's team event.
      expect(await seen(pam)).toEqual(
        [open.slug, members.slug, anySeason.slug].sort(),
      );
      expect(await seen(dot)).toEqual([open.slug, members.slug].sort());
      expect(await seen(lee)).toEqual([open.slug]);
      expect(await seen(sam)).toEqual([open.slug]);
      expect(await seen(ada)).toHaveLength(4);

      // Public pages, the public feed and the sitemap get the public one only.
      expect(
        (await leagueEvents(db, w.leagueId, "public")).map((e) => e.slug),
      ).toEqual([open.slug]);
      expect(await eventBySlug(db, members.slug, "public")).toBeNull();
      expect(await eventBySlug(db, members.slug, "all")).toMatchObject({
        audience: { kind: "members" },
      });
      const slugs = (await publicEventSlugs(db)).map((e) => e.slug);
      expect(slugs).toContain(open.slug);
      expect(slugs).not.toContain(members.slug);
      expect(slugs).not.toContain(fallTeams.slug);

      // A signed-in page can't be reached by guessing a team event's slug.
      expect(await visibleEvent(db, fallTeams.slug, pam, false)).toBeNull();
      expect(await visibleEvent(db, fallTeams.slug, kim, false)).toMatchObject({
        audience: {
          kind: "teams",
          seasonId: w.fall,
          teamIds: [w.kickers, w.fouls].sort(),
        },
      });
      expect(await visibleEvent(db, fallTeams.slug, ada, true)).not.toBeNull();
    });
  });

  it("reads the list in one statement however many events there are", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      for (let i = 0; i < 6; i += 1)
        await w.create(`Team night ${i}`, {
          kind: "teams",
          seasonId: w.fall,
          teamIds: [w.kickers],
        });
      const selects = vi.spyOn(db, "select");
      const events = await eventsFor(db, w.leagueId, w.people.kim, false);
      expect(events).toHaveLength(6);
      // One for the events with their audiences, one for the person.
      expect(selects).toHaveBeenCalledTimes(2);
      selects.mockRestore();
    });
  });

  it("keeps theme weeks public", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      // In a savepoint, so the failed insert doesn't end the test's transaction.
      await expect(
        db.transaction((tx) =>
          tx.execute(sql`
          insert into event (league_id, kind, title, slug, starts_at, ends_at, audience)
          values (${w.leagueId}, 'theme_week', 'Secret week', ${`secret-week-${w.tag}`},
            now(), now() + interval '1 day', 'members')`),
        ),
      ).rejects.toMatchObject({
        cause: { constraint: "event_theme_week_public" },
      });
      expect(await themeWeeks(db, w.leagueId, NY)).toEqual([]);
    });
  });
});

describe("eventRecipients", () => {
  it("tells exactly the people the domain's rule says to tell", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const audiences: Audience[] = [
        PUBLIC,
        { kind: "members" },
        { kind: "teams", seasonId: w.fall, teamIds: [w.kickers, w.fouls] },
        { kind: "teams", seasonId: w.summer, teamIds: [w.fouls] },
        { kind: "teams", seasonId: null, teamIds: [w.fouls, w.ducks] },
      ];
      const everyone = Object.values(w.people);
      const viewers = await Promise.all(
        everyone.map(async (id) => [id, await w.viewer(id)] as const),
      );
      for (const [i, audience] of audiences.entries()) {
        const created = await w.create(`Notice ${i}`, audience);
        const e = await eventBySlug(db, created.slug, "all");
        if (!e) throw new Error("no event");
        const expected = viewers
          .filter(([, v]) => isTold(audience, v))
          .map(([id]) => id)
          .sort();
        expect(await eventRecipients(db, e), JSON.stringify(audience)).toEqual(
          expected,
        );
        // And everyone told can see it.
        for (const [id, v] of viewers)
          if (expected.includes(id)) expect(canSee(audience, v)).toBe(true);
      }
    });
  });
});

describe("announceEvent", () => {
  it("queues one events-topic email per person, once for a new event and once per change", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const created = await w.create(
        "Mixer",
        { kind: "teams", seasonId: w.fall, teamIds: [w.kickers, w.fouls] },
        {
          inviteUrl: "https://partiful.example.test/e/mixer",
          inAppRsvp: false,
        },
      );
      const announce = (kind: "announced" | "updated", now = NOW) =>
        announceEvent(db, { eventId: created.id, kind, now });
      expect(await announce("announced")).toBe(2);
      // Announcing a new event twice tells no one twice.
      expect(await announce("announced")).toBe(0);
      expect(await announce("updated")).toBe(2);

      const rows = await db
        .select({
          userId: message.userId,
          topic: message.topic,
          payload: message.payload,
        })
        .from(message)
        .where(sql`${message.dedupeKey} like ${`event_%/${created.id}/%`}`);
      expect(new Set(rows.map((r) => r.userId))).toEqual(
        new Set([w.people.kim, w.people.fay]),
      );
      expect(new Set(rows.map((r) => r.topic))).toEqual(new Set(["events"]));
      expect(rows[0]?.payload).toMatchObject({
        title: `Mixer ${w.tag}`,
        inviteUrl: "https://partiful.example.test/e/mixer",
        publicPage: false,
      });

      // Nothing to announce once the event is over.
      expect(await announce("updated", party("x").endsAt)).toBe(0);
    });
  });
});

describe("updateEvent", () => {
  it("replaces the teams, and keeps RSVPs in the app while people have one", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const created = await w.create("Picnic", {
        kind: "teams",
        seasonId: w.fall,
        teamIds: [w.kickers],
      });
      const update = (reach: Reach) =>
        updateEvent(db, {
          id: created.id,
          event: party(`Picnic ${w.tag}`),
          reach,
          actorId: w.people.ada,
        });
      expect(
        await update(
          w.reach({ kind: "teams", seasonId: null, teamIds: [w.ducks] }),
        ),
      ).toEqual({ ok: true, value: { promoted: [] } });
      const teams = await db
        .select({ teamId: eventAudienceTeam.teamId })
        .from(eventAudienceTeam)
        .where(eq(eventAudienceTeam.eventId, created.id));
      expect(teams).toEqual([{ teamId: w.ducks }]);

      expect(await update(w.reach({ kind: "members" }))).toMatchObject({
        ok: true,
      });
      expect(
        await db
          .select()
          .from(eventAudienceTeam)
          .where(eq(eventAudienceTeam.eventId, created.id)),
      ).toEqual([]);

      await joinEvent(db, {
        eventId: created.id,
        userId: w.people.kim,
        now: NOW,
      });
      expect(
        await update(w.reach({ kind: "members" }, { inAppRsvp: false })),
      ).toEqual({ ok: false, error: "rsvps_in_app" });
      // Turning RSVPs off happens only once no one has one.
      expect(
        await joinEvent(db, {
          eventId: (await w.create("Invite only", PUBLIC, { inAppRsvp: false }))
            .id,
          userId: w.people.kim,
          now: NOW,
        }),
      ).toEqual({ ok: false, error: "invite_only" });
    });
  });
});

describe("audienceChoices", () => {
  it("offers seasons past draft with their teams, every team, and starts on the one being played", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const choices = await audienceChoices(db, w.leagueId);
      expect(choices.activeSeasonId).toBe(w.fall);
      expect(choices.seasons.map((s) => s.name)).toEqual([
        "Fall 2026",
        "Summer 2026",
      ]);
      expect(choices.seasons[0]?.teams.map((t) => t.id).sort()).toEqual(
        [w.kickers, w.fouls].sort(),
      );
      expect(choices.teams).toHaveLength(3);
      expect(
        await audienceNames(db, {
          kind: "teams",
          seasonId: w.summer,
          teamIds: [w.fouls, w.ducks],
        }),
      ).toEqual({
        teams: [`Ducks ${w.tag}`, `Fouls ${w.tag}`],
        season: "Summer 2026",
      });
    });
  });
});

describe("calendar feed", () => {
  it("starts at version 1, moves on with each reset and on account deletion", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const { kim } = w.people;
      expect(await feedVersion(db, kim)).toBe(1);
      expect(await resetFeed(db, kim)).toBe(2);
      expect(await resetFeed(db, kim)).toBe(3);
      expect(await feedVersion(db, kim)).toBe(3);

      const { sam } = w.people;
      expect((await deleteAccount(db, sam, NOW)).ok).toBe(true);
      expect(await feedVersion(db, sam)).toBe(2);
    });
  });
});
