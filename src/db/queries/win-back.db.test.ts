import { and, eq, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { SeasonId, TeamSeasonId, UserId } from "@/domain/ids";
import { auditLog } from "../schema/audit";
import { user } from "../schema/auth";
import { league } from "../schema/league";
import { message, notificationPreference } from "../schema/message";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { closePool, inRolledBackDb } from "../test/transaction";
import { required } from "./rows";
import type { Db } from "./schedule";
import {
  saveWinBackTemplate,
  sendWinBack,
  winBackCandidates,
  winBackResults,
  winBackSeason,
  type WinBackSeason,
} from "./win-back";

afterAll(closePool);

const NOW = new Date("2027-03-01T15:00:00Z");

/**
 * Five seasons, oldest first (2025 is four back, outside the look-back),
 * then the open one, plus a draft. Ana played three seasons and captained
 * the Aces last fall; Ben played for the Bees; Cy was a free agent; Dee has
 * signed up already; Eve signed up and cancelled; Fay played last spring
 * only; Old played only in 2025; Opt turned league news off; Gone deleted
 * their account.
 */
async function world(db: Db) {
  const tag = Math.random().toString(36).slice(2, 8);
  const names = [
    "Ana",
    "Ben",
    "Cy",
    "Dee",
    "Eve",
    "Fay",
    "Old",
    "Opt",
    "Gone",
    "Kai",
    "Lee",
  ];
  const people = await db
    .insert(user)
    .values(
      names.map((n, i) => ({
        name: `${n} Example`,
        email:
          n === "Gone"
            ? `deleted-${tag}@deleted.invalid`
            : `wb-${i}-${tag}@example.test`,
      })),
    )
    .returning({ id: user.id });
  const id = Object.fromEntries(
    names.map((n, i) => [n, required(people[i], n).id]),
  ) as Record<string, UserId>;
  await db.insert(profile).values(
    names
      .filter((n) => n !== "Gone")
      .map((n) => ({
        userId: required(id[n], n),
        firstName: n,
        lastName: "Example",
        globalRole: "player" as const,
      })),
  );
  const lg = required(
    (
      await db
        .insert(league)
        .values({ name: "Test League", slug: `wb-${tag}` })
        .returning({ id: league.id })
    )[0],
    "league",
  );
  const seasonRows = [
    ["fall-2025", "Fall 2025", "2025-09-01", "completed"],
    ["winter-2026", "Winter 2026", "2026-01-10", "completed"],
    ["spring-2026", "Spring 2026", "2026-04-01", "completed"],
    // A second night that started the same day.
    ["spring-2026-b", "Spring 2026 Tuesdays", "2026-04-01", "completed"],
    ["fall-2026", "Fall 2026", "2026-09-01", "completed"],
    ["spring-2027", "Spring 2027", "2027-04-01", "registration_open"],
    ["summer-2027", "Summer 2027", "2027-06-01", "draft"],
  ] as const;
  const made = await db
    .insert(season)
    .values(
      seasonRows.map(([slug, name, startsOn, status]) => ({
        leagueId: lg.id,
        slug: `${slug}-${tag}`,
        name,
        startsOn,
        endsOn: startsOn,
        status,
        feeModel: "per_player" as const,
        playerFeeCents: 8500,
        rosterMin: 1,
        rosterMax: 20,
      })),
    )
    .returning({ id: season.id, slug: season.slug });
  const s = (slug: string): SeasonId =>
    required(
      made.find((m) => m.slug === `${slug}-${tag}`),
      slug,
    ).id;
  const teams = await db
    .insert(team)
    .values(
      ["Aces", "Bees"].map((n) => ({
        leagueId: lg.id,
        name: n,
        slug: `${n.toLowerCase()}-${tag}`,
      })),
    )
    .returning({ id: team.id, name: team.name });
  const entry = async (teamName: string, seasonId: SeasonId) =>
    required(
      (
        await db
          .insert(teamSeason)
          .values({
            teamId: required(
              teams.find((t) => t.name === teamName),
              teamName,
            ).id,
            seasonId,
          })
          .returning({ id: teamSeason.id })
      )[0],
      "entry",
    ).id;
  const acesFall = await entry("Aces", s("fall-2026"));
  const beesFall = await entry("Bees", s("fall-2026"));
  const acesSpring = await entry("Aces", s("spring-2026"));

  const register = async (
    who: string,
    slug: string,
    opts: {
      team?: TeamSeasonId;
      role?: "captain" | "co_captain" | "player";
      status?: "active" | "cancelled";
      kind?: "team_member" | "free_agent";
    } = {},
  ) => {
    const reg = required(
      (
        await db
          .insert(registration)
          .values({
            seasonId: s(slug),
            userId: required(id[who], who),
            kind: opts.kind ?? "team_member",
            status: opts.status ?? "active",
          })
          .returning({ id: registration.id })
      )[0],
      "registration",
    );
    if (opts.team)
      await db.insert(rosterMembership).values({
        teamSeasonId: opts.team,
        registrationId: reg.id,
        role: opts.role ?? "player",
        status: "active",
      });
  };
  await register("Ana", "winter-2026");
  await register("Ana", "spring-2026", { team: acesSpring });
  await register("Ana", "fall-2026", { team: acesFall, role: "captain" });
  await register("Ben", "fall-2026", { team: beesFall });
  await register("Cy", "fall-2026", { kind: "free_agent" });
  await register("Dee", "fall-2026", { team: beesFall });
  await register("Dee", "spring-2027");
  await register("Eve", "fall-2026", { team: beesFall });
  await register("Eve", "spring-2027", { status: "cancelled" });
  await register("Fay", "spring-2026", { team: acesSpring });
  await register("Old", "fall-2025");
  await register("Opt", "fall-2026", { team: acesFall });
  await register("Gone", "fall-2026", { team: acesFall });
  await register("Kai", "fall-2026", { team: beesFall, role: "co_captain" });
  await register("Lee", "spring-2026");
  await register("Lee", "spring-2026-b");
  // A draft season's sign-up neither counts nor takes anyone off the list.
  await register("Ben", "summer-2027");
  await db.insert(notificationPreference).values({
    userId: required(id.Opt, "Opt"),
    topic: "announcement",
    channel: "email",
    enabled: false,
  });

  const open = required(await winBackSeason(db, `spring-2027-${tag}`), "open");
  return { id, open, leagueId: lg.id, admin: required(id.Ana, "Ana") };
}

const messagesOf = (db: Db, open: WinBackSeason) =>
  db
    .select({
      userId: message.userId,
      template: message.template,
      topic: message.topic,
      payload: message.payload,
    })
    .from(message)
    .where(like(message.dedupeKey, `win_back/${open.id}/%`));

describe("the win-back list", () => {
  it("lists recent players who haven't signed up, most loyal first", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const list = await winBackCandidates(db, w.open);
      expect(list.map((c) => c.firstName)).toEqual([
        "Ana",
        "Lee",
        "Ben",
        "Cy",
        "Eve",
        "Kai",
        "Opt",
        "Fay",
      ]);
      const by = new Map(list.map((c) => [c.firstName, c]));
      expect(by.get("Ana")).toMatchObject({
        seasonsPlayed: 3,
        lastSeasonName: "Fall 2026",
        lastTeam: "Aces",
        lastRole: "captain",
      });
      expect(by.get("Cy")).toMatchObject({
        lastTeam: null,
        lastRole: "free_agent",
      });
      expect(by.get("Fay")).toMatchObject({
        lastSeasonName: "Spring 2026",
        lastTeam: "Aces",
        lastRole: "player",
      });
      expect(by.get("Opt")?.optedOut).toBe(true);
      // A co-captain isn't asked to register the team: the captain is.
      expect(by.get("Kai")).toMatchObject({
        lastTeam: "Bees",
        lastRole: "player",
      });
      // Two seasons that started the same day are two seasons.
      expect(by.get("Lee")?.seasonsPlayed).toBe(2);
    });
  });

  it("emails each player once a season, skipping opt-outs, through the outbox", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await saveWinBackTemplate(
        db,
        {
          leagueId: w.leagueId,
          subject: "Come back for {season}, {first_name}",
          body: "Your old team {team} misses you.",
        },
        w.admin,
      );
      // One click for Ana first.
      expect(
        await sendWinBack(db, {
          season: w.open,
          userIds: [required(w.id.Ana, "Ana")],
          actorId: w.admin,
          now: NOW,
        }),
      ).toEqual({ ok: true, value: 1 });
      // Then everyone else not emailed yet: not Ana again, not Opt.
      expect(
        await sendWinBack(db, {
          season: w.open,
          userIds: "all",
          actorId: w.admin,
          now: NOW,
        }),
      ).toEqual({ ok: true, value: 6 });
      expect(
        await sendWinBack(db, {
          season: w.open,
          userIds: "all",
          actorId: w.admin,
          now: NOW,
        }),
      ).toEqual({ ok: true, value: 0 });

      const sent = await messagesOf(db, w.open);
      expect(sent).toHaveLength(7);
      expect(sent.every((m) => m.template === "win_back")).toBe(true);
      expect(sent.every((m) => m.topic === "announcement")).toBe(true);
      expect(sent.map((m) => m.userId)).not.toContain(w.id.Opt);
      const ana = sent.find((m) => m.userId === w.id.Ana);
      expect(ana?.payload).toMatchObject({
        subject: "Come back for Spring 2027, Ana",
        paragraphs: ["Your old team Aces misses you."],
        actionPath: expect.stringMatching(/\/register$/),
      });
      const cy = sent.find((m) => m.userId === w.id.Cy);
      expect(cy?.payload).toMatchObject({ actionPath: "/free-agents" });

      const list = await winBackCandidates(db, w.open);
      expect(list.find((c) => c.firstName === "Ben")?.emailedAt).toEqual(NOW);
      const audits = await db
        .select({ after: auditLog.after })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.entityId, w.open.id),
            eq(auditLog.action, "win_back.send"),
          ),
        );
      // A send with nobody left to email changes nothing and isn't logged.
      expect(audits.map((a) => a.after)).toEqual([
        { emailed: 1 },
        { emailed: 6 },
      ]);
    });
  });

  it("counts who came back after their email", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await sendWinBack(db, {
        season: w.open,
        userIds: "all",
        actorId: w.admin,
        now: NOW,
      });
      expect(await winBackResults(db, w.open.id)).toEqual({
        emailed: 7,
        cameBack: 0,
      });
      await db.insert(registration).values({
        seasonId: w.open.id,
        userId: required(w.id.Ben, "Ben"),
        kind: "team_member",
        status: "pending_payment",
        createdAt: new Date("2027-03-02T12:00:00Z"),
      });
      expect(await winBackResults(db, w.open.id)).toEqual({
        emailed: 7,
        cameBack: 1,
      });
      // Signed up now, so off the list.
      const list = await winBackCandidates(db, w.open);
      expect(list.map((c) => c.firstName)).not.toContain("Ben");
    });
  });

  it("sends nothing once registration has closed", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      expect(
        await sendWinBack(db, {
          season: { ...w.open, status: "registration_closed" },
          userIds: "all",
          actorId: w.admin,
          now: NOW,
        }),
      ).toEqual({ ok: false, error: "not_open" });
      expect(await messagesOf(db, w.open)).toHaveLength(0);
    });
  });
});
