import { and, asc, eq, isNull, notExists, sql } from "drizzle-orm";
import type { SeasonId, SeasonSurveyId, UserId } from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import {
  type AnswerInput,
  type AnswerRefusal,
  mayAnswer,
  mayOpen,
  type SurveyResults,
  summarize,
} from "@/domain/survey/questions";
import { season } from "../schema/season";
import { seasonSurvey, surveyAnswer, surveyResponse } from "../schema/survey";
import { registration, rosterMembership } from "../schema/team";
import { recordAudit } from "./audit";
import { enqueueMessages } from "./outbox";
import type { Db } from "./schedule";

/**
 * The end-of-season survey (src/domain/survey/questions.ts). A player's
 * answer goes into survey_answer, which has no column for a person, and a
 * survey_response row records only that they answered. Results read
 * survey_answer alone, so no query here can say who wrote what.
 */

export type Survey = {
  id: SeasonSurveyId;
  seasonId: SeasonId;
  openedAt: Date;
  closedAt: Date | null;
};

const columns = {
  id: seasonSurvey.id,
  seasonId: seasonSurvey.seasonId,
  openedAt: seasonSurvey.openedAt,
  closedAt: seasonSurvey.closedAt,
};

export async function surveyForSeason(
  db: Db,
  seasonId: SeasonId,
): Promise<Survey | null> {
  const [found] = await db
    .select(columns)
    .from(seasonSurvey)
    .where(eq(seasonSurvey.seasonId, seasonId));
  return found ?? null;
}

/** Everyone on a roster that season, once each: who the survey is for. */
function rosteredPlayers(db: Db, seasonId: SeasonId) {
  return db
    .selectDistinct({ userId: registration.userId })
    .from(rosterMembership)
    .innerJoin(
      registration,
      eq(registration.id, rosterMembership.registrationId),
    )
    .where(
      and(
        eq(registration.seasonId, seasonId),
        eq(rosterMembership.status, "active"),
      ),
    );
}

async function isRostered(
  db: Db,
  seasonId: SeasonId,
  userId: UserId,
): Promise<boolean> {
  const [found] = await db
    .select({ id: rosterMembership.id })
    .from(rosterMembership)
    .innerJoin(
      registration,
      eq(registration.id, rosterMembership.registrationId),
    )
    .where(
      and(
        eq(registration.seasonId, seasonId),
        eq(registration.userId, userId),
        eq(rosterMembership.status, "active"),
      ),
    )
    .limit(1);
  return found !== undefined;
}

/**
 * An admin opens the survey for a completed season, and every rostered
 * player gets one invite. Run it inside a transaction.
 */
export async function openSurvey(
  db: Db,
  input: { seasonId: SeasonId; actorId: UserId; now: Date },
): Promise<
  Result<
    { id: SeasonSurveyId; invited: number },
    "not_found" | "not_completed" | "exists"
  >
> {
  const [s] = await db
    .select({ status: season.status, name: season.name, slug: season.slug })
    .from(season)
    .where(eq(season.id, input.seasonId))
    .for("share");
  if (!s) return err("not_found");
  const allowed = mayOpen(s.status);
  if (!allowed.ok) return allowed;
  const [created] = await db
    .insert(seasonSurvey)
    .values({
      seasonId: input.seasonId,
      openedAt: input.now,
      openedBy: input.actorId,
    })
    .onConflictDoNothing({ target: seasonSurvey.seasonId })
    .returning({ id: seasonSurvey.id });
  if (!created) return err("exists");
  const players = await rosteredPlayers(db, input.seasonId);
  await enqueueMessages(
    db,
    players.map((p) => ({
      userId: p.userId,
      template: "survey_invite" as const,
      topic: "announcement" as const,
      payload: { seasonName: s.name, seasonSlug: s.slug },
      dedupeKey: `survey_invite/${created.id}/${p.userId}`,
    })),
  );
  await recordAudit(db, {
    actorId: input.actorId,
    action: "survey.open",
    entityType: "season_survey",
    entityId: created.id,
    after: { seasonId: input.seasonId, invited: players.length },
  });
  return ok({ id: created.id, invited: players.length });
}

/** An admin closes the survey; no more answers after this. */
export async function closeSurvey(
  db: Db,
  input: { id: SeasonSurveyId; actorId: UserId; now: Date },
): Promise<Result<void, "not_found">> {
  const closed = await db
    .update(seasonSurvey)
    .set({ closedAt: input.now })
    .where(and(eq(seasonSurvey.id, input.id), isNull(seasonSurvey.closedAt)))
    .returning({ id: seasonSurvey.id });
  if (closed.length === 0) return err("not_found");
  await recordAudit(db, {
    actorId: input.actorId,
    action: "survey.close",
    entityType: "season_survey",
    entityId: input.id,
  });
  return ok(undefined);
}

export type SurveyStanding = { rostered: boolean; answered: boolean };

/** Whether a player is asked, and whether they have answered. */
export async function surveyStanding(
  db: Db,
  survey: Survey,
  userId: UserId,
): Promise<SurveyStanding> {
  const [rostered, [answered]] = await Promise.all([
    isRostered(db, survey.seasonId, userId),
    db
      .select({ id: surveyResponse.id })
      .from(surveyResponse)
      .where(
        and(
          eq(surveyResponse.surveyId, survey.id),
          eq(surveyResponse.userId, userId),
        ),
      ),
  ]);
  return { rostered, answered: answered !== undefined };
}

/**
 * A player's one answer. The survey row is read under a share lock so an
 * answer can't land after a close commits. The response row's unique key
 * decides between two answers sent at once: the second inserts nothing and
 * its answer is not written. Run it inside a transaction.
 */
export async function answerSurvey(
  db: Db,
  input: { surveyId: SeasonSurveyId; userId: UserId; answer: AnswerInput },
): Promise<Result<void, AnswerRefusal | "not_found">> {
  const [survey] = await db
    .select(columns)
    .from(seasonSurvey)
    .where(eq(seasonSurvey.id, input.surveyId))
    .for("share");
  if (!survey) return err("not_found");
  const allowed = mayAnswer({
    survey,
    rostered: await isRostered(db, survey.seasonId, input.userId),
    answered: false,
  });
  if (!allowed.ok) return allowed;
  const [first] = await db
    .insert(surveyResponse)
    .values({ surveyId: survey.id, userId: input.userId })
    .onConflictDoNothing({
      target: [surveyResponse.surveyId, surveyResponse.userId],
    })
    .returning({ id: surveyResponse.id });
  if (!first) return err("already");
  await db
    .insert(surveyAnswer)
    .values({ surveyId: survey.id, ...input.answer });
  return ok(undefined);
}

export type SurveyReport = SurveyResults & { invited: number };

/**
 * The results for owners and admins: totals and the written answers as
 * sorted, separate lists. Reads only survey_answer (no person in it) and
 * two counts.
 */
export async function surveyResults(
  db: Db,
  survey: Survey,
): Promise<SurveyReport> {
  const [answers, [invited]] = await Promise.all([
    db
      .select({
        rating: surveyAnswer.rating,
        wouldReturn: surveyAnswer.wouldReturn,
        bestPart: surveyAnswer.bestPart,
        oneChange: surveyAnswer.oneChange,
        comment: surveyAnswer.comment,
      })
      .from(surveyAnswer)
      .where(eq(surveyAnswer.surveyId, survey.id)),
    db
      .select({ n: sql<number>`count(distinct ${registration.userId})::int` })
      .from(rosterMembership)
      .innerJoin(
        registration,
        eq(registration.id, rosterMembership.registrationId),
      )
      .where(
        and(
          eq(registration.seasonId, survey.seasonId),
          eq(rosterMembership.status, "active"),
        ),
      ),
  ]);
  return { ...summarize(answers), invited: invited?.n ?? 0 };
}

export type OpenSurvey = { seasonName: string; seasonSlug: string };

/**
 * Open surveys the player hasn't answered yet, for seasons they played,
 * for the prompt on their home screen. One query.
 */
export async function surveysWaitingFor(
  db: Db,
  userId: UserId,
): Promise<OpenSurvey[]> {
  return db
    .selectDistinct({
      seasonName: season.name,
      seasonSlug: season.slug,
      openedAt: seasonSurvey.openedAt,
    })
    .from(seasonSurvey)
    .innerJoin(season, eq(season.id, seasonSurvey.seasonId))
    .innerJoin(registration, eq(registration.seasonId, seasonSurvey.seasonId))
    .innerJoin(
      rosterMembership,
      eq(rosterMembership.registrationId, registration.id),
    )
    .where(
      and(
        isNull(seasonSurvey.closedAt),
        eq(registration.userId, userId),
        eq(rosterMembership.status, "active"),
        notExists(
          db
            .select({ id: surveyResponse.id })
            .from(surveyResponse)
            .where(
              and(
                eq(surveyResponse.surveyId, seasonSurvey.id),
                eq(surveyResponse.userId, userId),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(seasonSurvey.openedAt));
}

/** The seasons whose survey a person answered, for their data export. */
export async function mySurveysAnswered(
  db: Db,
  userId: UserId,
): Promise<{ season: string }[]> {
  return db
    .select({ season: season.name })
    .from(surveyResponse)
    .innerJoin(seasonSurvey, eq(seasonSurvey.id, surveyResponse.surveyId))
    .innerJoin(season, eq(season.id, seasonSurvey.seasonId))
    .where(eq(surveyResponse.userId, userId))
    .orderBy(asc(seasonSurvey.openedAt));
}
