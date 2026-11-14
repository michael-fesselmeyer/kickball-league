import { eq, getTableColumns, like } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { afterAll, describe, expect, it } from "vitest";
import { can } from "@/domain/authz/permissions";
import type { UserId } from "@/domain/ids";
import type { AnswerInput } from "@/domain/survey/questions";
import { auditLog } from "../schema/audit";
import { user } from "../schema/auth";
import { league } from "../schema/league";
import { message } from "../schema/message";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { surveyAnswer, surveyResponse } from "../schema/survey";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { closePool, inRolledBackDb } from "../test/transaction";
import { deleteAccount, personalData } from "./account";
import type { Db } from "./schedule";
import { loadSubject } from "./subject";
import {
  answerSurvey,
  closeSurvey,
  openSurvey,
  surveyForSeason,
  surveyResults,
  surveyStanding,
  surveysWaitingFor,
} from "./surveys";

afterAll(closePool);

const OPENED = new Date("2026-12-01T17:00:00Z");
const LATER = new Date("2026-12-08T17:00:00Z");

/**
 * An invented league with a completed season: two teams of players, one
 * player who was removed from a roster, a free agent never placed, an
 * admin and an owner.
 */
async function world(
  db: Db,
  status: "completed" | "in_progress" = "completed",
) {
  const tag = Math.random().toString(36).slice(2, 8);
  const [lg] = await db
    .insert(league)
    .values({ name: "Survey League", slug: `survey-${tag}` })
    .returning({ id: league.id });
  if (!lg) throw new Error("no league");
  const [fall] = await db
    .insert(season)
    .values({
      leagueId: lg.id,
      name: "Fall Social",
      slug: `survey-fall-${tag}`,
      status,
      startsOn: "2026-09-01",
      endsOn: "2026-11-30",
      feeModel: "per_player",
      playerFeeCents: 4500,
      freeAgentFeeCents: 4500,
      rosterMin: 1,
      rosterMax: 20,
    })
    .returning({ id: season.id });
  if (!fall) throw new Error("no season");
  const names = [
    "Ada Admin",
    "Olive Owner",
    "Robin Quill",
    "Sky Fenn",
    "Kit Marlow",
    "Rowan Removed",
    "Fran Agent",
  ];
  const people = await db
    .insert(user)
    .values(
      names.map((name, i) => ({
        name,
        email: `survey-${i}-${tag}@example.test`,
      })),
    )
    .returning({ id: user.id });
  const [admin, owner, a, b, c, removed, agent] = people.map((p) => p.id) as [
    UserId,
    UserId,
    UserId,
    UserId,
    UserId,
    UserId,
    UserId,
  ];
  await db
    .insert(profile)
    .values([
      { userId: admin, globalRole: "admin" as const },
      { userId: owner, globalRole: "owner" as const },
      ...[a, b, c, removed, agent].map((userId) => ({ userId })),
    ]);
  const teams = await db
    .insert(team)
    .values([
      { leagueId: lg.id, name: "Sun Kickers", slug: `sun-${tag}` },
      { leagueId: lg.id, name: "Base Invaders", slug: `base-${tag}` },
    ])
    .returning({ id: team.id });
  const ts = await db
    .insert(teamSeason)
    .values(teams.map((t) => ({ teamId: t.id, seasonId: fall.id })))
    .returning({ id: teamSeason.id });
  const regs = await db
    .insert(registration)
    .values(
      [a, b, c, removed, agent].map((userId) => ({
        seasonId: fall.id,
        userId,
        kind: "team_member" as const,
        status: "active" as const,
      })),
    )
    .returning({ id: registration.id, userId: registration.userId });
  const regOf = (userId: UserId) => {
    const r = regs.find((x) => x.userId === userId);
    if (!r) throw new Error("no registration");
    return r.id;
  };
  const [sun, base] = ts.map((t) => t.id);
  if (!sun || !base) throw new Error("no teams");
  await db.insert(rosterMembership).values([
    { teamSeasonId: sun, registrationId: regOf(a), status: "active" as const },
    { teamSeasonId: sun, registrationId: regOf(b), status: "active" as const },
    { teamSeasonId: base, registrationId: regOf(c), status: "active" as const },
    {
      teamSeasonId: base,
      registrationId: regOf(removed),
      status: "removed" as const,
    },
  ]);
  return {
    seasonId: fall.id,
    admin,
    owner,
    players: [a, b, c] as const,
    removed,
    agent,
  };
}

const answer = (over: Partial<AnswerInput> = {}): AnswerInput => ({
  rating: 4,
  wouldReturn: "yes",
  bestPart: null,
  oneChange: null,
  comment: null,
  ...over,
});

async function opened(db: Db) {
  const w = await world(db);
  const result = await openSurvey(db, {
    seasonId: w.seasonId,
    actorId: w.admin,
    now: OPENED,
  });
  if (!result.ok) throw new Error(result.error);
  const survey = await surveyForSeason(db, w.seasonId);
  if (!survey) throw new Error("no survey");
  return { ...w, survey, invited: result.value.invited };
}

describe("opening a survey", () => {
  it("opens for a completed season and invites each rostered player once", () =>
    inRolledBackDb(async (db) => {
      const w = await opened(db);
      expect(w.invited).toBe(3);
      const invites = await db
        .select({ userId: message.userId, template: message.template })
        .from(message)
        .where(like(message.dedupeKey, `survey_invite/${w.survey.id}/%`));
      expect(invites.map((m) => m.userId).sort()).toEqual(
        [...w.players].sort(),
      );
      expect(new Set(invites.map((m) => m.template))).toEqual(
        new Set(["survey_invite"]),
      );
      const [audit] = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.entityId, w.survey.id));
      expect(audit?.action).toBe("survey.open");
      // A second open changes nothing and sends nothing.
      expect(
        await openSurvey(db, {
          seasonId: w.seasonId,
          actorId: w.admin,
          now: LATER,
        }),
      ).toEqual({ ok: false, error: "exists" });
    }));

  it("refuses a season still being played", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db, "in_progress");
      expect(
        await openSurvey(db, {
          seasonId: w.seasonId,
          actorId: w.admin,
          now: OPENED,
        }),
      ).toEqual({ ok: false, error: "not_completed" });
    }));
});

describe("answering", () => {
  it("takes one answer per player", () =>
    inRolledBackDb(async (db) => {
      const w = await opened(db);
      const [a] = w.players;
      const send = () =>
        answerSurvey(db, {
          surveyId: w.survey.id,
          userId: a,
          answer: answer(),
        });
      expect((await send()).ok).toBe(true);
      expect(await send()).toEqual({ ok: false, error: "already" });
      expect(await surveyStanding(db, w.survey, a)).toEqual({
        rostered: true,
        answered: true,
      });
      const answers = await db
        .select()
        .from(surveyAnswer)
        .where(eq(surveyAnswer.surveyId, w.survey.id));
      expect(answers).toHaveLength(1);
      // The database itself refuses a second response row.
      await expect(
        db.transaction((tx) =>
          tx
            .insert(surveyResponse)
            .values({ surveyId: w.survey.id, userId: a }),
        ),
      ).rejects.toThrow();
    }));

  it("is only for players on a roster that season", () =>
    inRolledBackDb(async (db) => {
      const w = await opened(db);
      for (const userId of [w.removed, w.agent, w.admin])
        expect(
          await answerSurvey(db, {
            surveyId: w.survey.id,
            userId,
            answer: answer(),
          }),
        ).toEqual({ ok: false, error: "not_rostered" });
    }));

  it("stops taking answers once closed", () =>
    inRolledBackDb(async (db) => {
      const w = await opened(db);
      expect(
        (
          await closeSurvey(db, {
            id: w.survey.id,
            actorId: w.admin,
            now: LATER,
          })
        ).ok,
      ).toBe(true);
      expect(
        await answerSurvey(db, {
          surveyId: w.survey.id,
          userId: w.players[0],
          answer: answer(),
        }),
      ).toEqual({ ok: false, error: "closed" });
      expect(await surveysWaitingFor(db, w.players[0])).toEqual([]);
    }));

  it("prompts players who haven't answered, until they do", () =>
    inRolledBackDb(async (db) => {
      const w = await opened(db);
      const [a] = w.players;
      expect(await surveysWaitingFor(db, a)).toEqual([
        expect.objectContaining({ seasonName: "Fall Social" }),
      ]);
      expect(await surveysWaitingFor(db, w.agent)).toEqual([]);
      await answerSurvey(db, {
        surveyId: w.survey.id,
        userId: a,
        answer: answer(),
      });
      expect(await surveysWaitingFor(db, a)).toEqual([]);
    }));
});

describe("results", () => {
  it("gives totals and comments, and nothing that names who said what", () =>
    inRolledBackDb(async (db) => {
      const w = await opened(db);
      const [a, b, c] = w.players;
      await answerSurvey(db, {
        surveyId: w.survey.id,
        userId: a,
        answer: answer({
          rating: 5,
          bestPart: "The bar after",
          comment: "More theme weeks",
        }),
      });
      await answerSurvey(db, {
        surveyId: w.survey.id,
        userId: b,
        answer: answer({
          rating: 2,
          wouldReturn: "maybe",
          oneChange: "Earlier games",
        }),
      });
      await answerSurvey(db, {
        surveyId: w.survey.id,
        userId: c,
        answer: answer({ rating: 4, bestPart: "Meeting people" }),
      });
      const results = await surveyResults(db, w.survey);
      expect(results).toMatchObject({
        answers: 3,
        invited: 3,
        averageRating: 3.7,
        ratingCounts: { 1: 0, 2: 1, 3: 0, 4: 1, 5: 1 },
        returnCounts: { yes: 2, maybe: 1, no: 0 },
        bestParts: ["Meeting people", "The bar after"],
        oneChanges: ["Earlier games"],
        comments: ["More theme weeks"],
      });

      // Nothing in the results points at a person.
      const ids = [a, b, c] as string[];
      const people = await db
        .select({ name: user.name, email: user.email })
        .from(user)
        .where(eq(user.id, a));
      const text = JSON.stringify(results);
      for (const id of ids) expect(text).not.toContain(id);
      for (const p of people) {
        expect(text).not.toContain(p.name);
        expect(text).not.toContain(p.email);
      }
    }));

  it("stores answers with no person and no time to tie them back", () => {
    const config = getTableConfig(surveyAnswer);
    expect(config.foreignKeys.map((fk) => fk.reference().foreignTable)).toEqual(
      [expect.anything()],
    );
    expect(
      config.foreignKeys.some((fk) => fk.reference().foreignTable === user),
    ).toBe(false);
    expect(Object.keys(getTableColumns(surveyAnswer)).sort()).toEqual([
      "bestPart",
      "comment",
      "id",
      "oneChange",
      "rating",
      "surveyId",
      "wouldReturn",
    ]);
    // The receipt says only that a person answered.
    expect(Object.keys(getTableColumns(surveyResponse)).sort()).toEqual([
      "id",
      "surveyId",
      "userId",
    ]);
  });

  it("are for owners and admins only", () =>
    inRolledBackDb(async (db) => {
      const w = await opened(db);
      const allowed = async (userId: UserId) =>
        can(await loadSubject(db, userId), "survey.results");
      expect(await allowed(w.admin)).toBe(true);
      expect(await allowed(w.owner)).toBe(true);
      expect(await allowed(w.players[0])).toBe(false);
      expect(can(await loadSubject(db, null), "survey.results")).toBe(false);
    }));
});

describe("accounts", () => {
  it("exports only that a player answered, and deleting keeps the anonymous answer", () =>
    inRolledBackDb(async (db) => {
      const w = await opened(db);
      const [a] = w.players;
      await answerSurvey(db, {
        surveyId: w.survey.id,
        userId: a,
        answer: answer({ comment: "Great season" }),
      });
      const data = await personalData(db, a, LATER);
      expect(data.seasonSurveysAnswered).toEqual([{ season: "Fall Social" }]);
      expect(JSON.stringify(data)).not.toContain("Great season");
      expect((await deleteAccount(db, a, LATER)).ok).toBe(true);
      expect((await surveyResults(db, w.survey)).comments).toEqual([
        "Great season",
      ]);
    }));
});
