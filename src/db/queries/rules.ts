import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { league } from "../schema/league";
import {
  parseVisibility,
  type RulebookVisibility,
  tsQueryOf,
} from "@/domain/rules/rulebook";
import type {
  LeagueId,
  RuleChangeId,
  RuleSectionId,
  SeasonId,
  UserId,
} from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import {
  checkPublish,
  planChange,
  type RuleFormError,
  type SectionChange,
  type SubmittedSection,
} from "@/domain/rules/rules";
import { ruleChange, ruleSection } from "../schema/rules";
import { season } from "../schema/season";
import { audienceOf } from "./announcements";
import { recordAudit } from "./audit";
import { seasonDivisions } from "./divisions";
import { enqueueMessages } from "./outbox";
import type { Db } from "./schedule";

/**
 * The league's rules and their change log (ADR 0062,
 * src/domain/rules/rules.ts): what the public rules page reads, and the one
 * way to change them, publishing a dated change.
 */

export type SectionRow = {
  id: RuleSectionId;
  slug: string;
  title: string;
  body: string;
  position: number;
};

/** The rules as they stand, in order. */
export async function currentRules(
  db: Db,
  leagueId: LeagueId,
): Promise<SectionRow[]> {
  return db
    .select({
      id: ruleSection.id,
      slug: ruleSection.slug,
      title: ruleSection.title,
      body: ruleSection.body,
      position: ruleSection.position,
    })
    .from(ruleSection)
    .where(eq(ruleSection.leagueId, leagueId))
    .orderBy(asc(ruleSection.position), asc(ruleSection.title));
}

export type ChangeRow = {
  id: RuleChangeId;
  summary: string;
  changes: SectionChange[];
  effectiveOn: string;
  notice: boolean;
  noticeRecipients: number | null;
  createdAt: Date;
};

/** Published changes, newest first. */
export async function ruleChanges(
  db: Db,
  leagueId: LeagueId,
  limit = 50,
): Promise<ChangeRow[]> {
  return db
    .select({
      id: ruleChange.id,
      summary: ruleChange.summary,
      changes: ruleChange.changes,
      effectiveOn: ruleChange.effectiveOn,
      notice: ruleChange.notice,
      noticeRecipients: ruleChange.noticeRecipients,
      createdAt: ruleChange.createdAt,
    })
    .from(ruleChange)
    .where(eq(ruleChange.leagueId, leagueId))
    .orderBy(desc(ruleChange.createdAt), desc(ruleChange.id))
    .limit(limit);
}

export type LogEntry = {
  id: RuleChangeId;
  summary: string;
  sections: Pick<SectionChange, "slug" | "kind" | "title">[];
  effectiveOn: string;
  createdAt: Date;
};

/**
 * The public change log, newest first: each change's sections by slug,
 * kind and title only. The text before and after stays in the database,
 * so the page doesn't read every old version of the rules.
 */
export async function changeLog(
  db: Db,
  leagueId: LeagueId,
  limit = 20,
): Promise<LogEntry[]> {
  return db
    .select({
      id: ruleChange.id,
      summary: ruleChange.summary,
      sections: sql<LogEntry["sections"]>`(
        select jsonb_agg(jsonb_build_object(
          'slug', e->>'slug', 'kind', e->>'kind', 'title', e->>'title'
        ) order by n)
        from jsonb_array_elements(${ruleChange.changes}) with ordinality as x(e, n)
      )`,
      effectiveOn: ruleChange.effectiveOn,
      createdAt: ruleChange.createdAt,
    })
    .from(ruleChange)
    .where(eq(ruleChange.leagueId, leagueId))
    .orderBy(desc(ruleChange.createdAt), desc(ruleChange.id))
    .limit(limit);
}

/**
 * The newest change's id, or "" before the first: the version an editor
 * was opened at, so a publish over someone else's newer change is caught.
 */
export async function rulesVersion(
  db: Db,
  leagueId: LeagueId,
): Promise<string> {
  const [latest] = await ruleChanges(db, leagueId, 1);
  return latest?.id ?? "";
}

/** Seasons whose players hear about a rule change: open or under way. */
const ACTIVE_STATUSES = [
  "registration_open",
  "registration_closed",
  "in_progress",
  "playoffs",
] as const;

export type GameSettings = {
  seasonName: string;
  divisions: {
    name: string;
    ruleSet: {
      name: string;
      innings: number | null;
      timeLimitMinutes: number | null;
      options: { bunting?: boolean; stealing?: boolean };
    } | null;
  }[];
};

/**
 * The divisions' rule-set settings for the season under way, or the next
 * one: the latest season that is open or playing, else the latest that
 * isn't a draft. Null when the league has none, or the season has no
 * divisions with a rule set.
 */
export async function gameSettings(
  db: Db,
  leagueId: LeagueId,
): Promise<(GameSettings & { seasonId: SeasonId }) | null> {
  const [found] = await db
    .select({ id: season.id, name: season.name })
    .from(season)
    .where(and(eq(season.leagueId, leagueId), ne(season.status, "draft")))
    .orderBy(
      sql`(${season.status} in ('registration_open', 'registration_closed', 'in_progress', 'playoffs')) desc`,
      desc(season.startsOn),
    )
    .limit(1);
  if (!found) return null;
  const divisions = await seasonDivisions(db, found.id);
  if (!divisions.some((d) => d.ruleSet)) return null;
  return {
    seasonId: found.id,
    seasonName: found.name,
    divisions: divisions.map((d) => ({
      name: d.name,
      ruleSet: d.ruleSet
        ? {
            name: d.ruleSet.name,
            innings: d.ruleSet.innings,
            timeLimitMinutes: d.ruleSet.timeLimitMinutes,
            options: d.ruleSet.options,
          }
        : null,
    })),
  };
}

/** Everyone registered in a season that is open or under way, once each. */
async function activePlayers(db: Db, leagueId: LeagueId): Promise<UserId[]> {
  const seasons = await db
    .select({ id: season.id })
    .from(season)
    .where(
      and(
        eq(season.leagueId, leagueId),
        inArray(season.status, [...ACTIVE_STATUSES]),
      ),
    );
  const people = new Set<UserId>();
  for (const s of seasons)
    for (const userId of await audienceOf(db, s.id, null)) people.add(userId);
  return [...people];
}

const longDate = (on: string) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${on}T12:00:00Z`));

/**
 * Publishes a change: saves the sections as submitted and records the
 * change with its date, summary and each section's text before and after.
 * Publishes for a league queue up on a lock, and one made from an editor
 * opened before the newest change is refused as stale, so two admins never
 * overwrite each other. With a notice, every player in the active seasons
 * gets a non-urgent message, through the outbox, saying when it starts.
 */
export async function publishRuleChange(
  db: Db,
  input: {
    leagueId: LeagueId;
    actorId: UserId;
    sections: SubmittedSection[];
    /** rulesVersion when the editor was opened. */
    version: string;
    summary: string;
    effectiveOn: string;
    notice: boolean;
    /** Today in the league's time zone. */
    today: string;
    /** The league's public rules page, for the notice's link. */
    rulesPath: string;
  },
): Promise<Result<{ id: RuleChangeId; recipients: number }, RuleFormError>> {
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`rules:${input.leagueId}`}))`,
  );
  if ((await rulesVersion(db, input.leagueId)) !== input.version)
    return err("stale");
  const current = await currentRules(db, input.leagueId);
  const plan = planChange(current, input.sections);
  if (!plan.ok) return plan;
  const publish = checkPublish(input, input.today);
  if (!publish.ok) return publish;

  if (plan.value.removeIds.length > 0)
    await db.delete(ruleSection).where(
      and(
        eq(ruleSection.leagueId, input.leagueId),
        inArray(
          ruleSection.id,
          plan.value.removeIds.map((id) => id as RuleSectionId),
        ),
      ),
    );
  for (const s of plan.value.sections) {
    if (s.id === null)
      await db.insert(ruleSection).values({
        leagueId: input.leagueId,
        slug: s.slug,
        title: s.title,
        body: s.body,
        position: s.position,
      });
    else
      await db
        .update(ruleSection)
        .set({ title: s.title, body: s.body, position: s.position })
        .where(
          and(
            eq(ruleSection.id, s.id as RuleSectionId),
            eq(ruleSection.leagueId, input.leagueId),
          ),
        );
  }
  const [change] = await db
    .insert(ruleChange)
    .values({
      leagueId: input.leagueId,
      summary: publish.value.summary,
      changes: plan.value.changes,
      effectiveOn: publish.value.effectiveOn,
      notice: publish.value.notice,
      createdBy: input.actorId,
    })
    .returning({ id: ruleChange.id });
  if (!change) throw new Error("Insert returned no rule change");

  let recipients = 0;
  if (publish.value.notice) {
    const players = await activePlayers(db, input.leagueId);
    recipients = players.length;
    if (players.length > 0)
      await enqueueMessages(
        db,
        players.map((userId) => ({
          userId,
          template: "rule_change" as const,
          topic: "announcement" as const,
          payload: {
            summary: publish.value.summary,
            sections: plan.value.changes.map((c) => c.title),
            effectiveOn: longDate(publish.value.effectiveOn),
            rulesPath: input.rulesPath,
            anchor:
              plan.value.changes.find((c) => c.kind !== "removed")?.slug ??
              null,
          },
          dedupeKey: `rule_change/${change.id}/${userId}`,
        })),
      );
    await db
      .update(ruleChange)
      .set({ noticeRecipients: recipients })
      .where(eq(ruleChange.id, change.id));
  }
  await recordAudit(db, {
    actorId: input.actorId,
    action: "rules.publish",
    entityType: "rule_change",
    leagueId: input.leagueId,
    entityId: change.id,
    after: {
      summary: publish.value.summary,
      effectiveOn: publish.value.effectiveOn,
      notice: publish.value.notice,
      sections: plan.value.changes.map((c) => ({ slug: c.slug, kind: c.kind })),
    },
  });
  return ok({ id: change.id, recipients });
}

/** Who may read the league's rulebook; owners only until the league decides. */
export async function rulebookVisibility(
  db: Db,
  leagueId: LeagueId,
): Promise<RulebookVisibility> {
  const [row] = await db
    .select({ visibility: league.rulebookVisibility })
    .from(league)
    .where(eq(league.id, leagueId));
  return parseVisibility(row?.visibility) ?? "owners";
}

/** Changes who may read the rulebook, with an audit entry when it differs. */
export async function setRulebookVisibility(
  db: Db,
  input: {
    leagueId: LeagueId;
    actorId: UserId;
    visibility: RulebookVisibility;
  },
): Promise<{ changed: boolean }> {
  const before = await rulebookVisibility(db, input.leagueId);
  if (before === input.visibility) return { changed: false };
  await db
    .update(league)
    .set({ rulebookVisibility: input.visibility })
    .where(eq(league.id, input.leagueId));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "rules.visibility",
    entityType: "league",
    entityId: input.leagueId,
    before: { visibility: before },
    after: { visibility: input.visibility },
  });
  return { changed: true };
}

export type SearchRow = {
  slug: string;
  title: string;
  body: string;
  rank: number;
};

/**
 * The sections that contain every word, best first: the title counts for
 * more than the text. Each word matches as a prefix, so results appear
 * while the person types. `terms` come from `searchTerms`, letters and
 * digits only.
 */
export async function searchSections(
  db: Db,
  leagueId: LeagueId,
  terms: readonly string[],
  limit = 8,
): Promise<SearchRow[]> {
  const query = tsQueryOf(terms);
  if (!query) return [];
  const tsquery = sql`to_tsquery('english', ${query})`;
  return db
    .select({
      slug: ruleSection.slug,
      title: ruleSection.title,
      body: ruleSection.body,
      rank: sql<number>`ts_rank_cd(${ruleSection.search}, ${tsquery})::float8`,
    })
    .from(ruleSection)
    .where(
      and(
        eq(ruleSection.leagueId, leagueId),
        sql`${ruleSection.search} @@ ${tsquery}`,
      ),
    )
    .orderBy(
      sql`ts_rank_cd(${ruleSection.search}, ${tsquery}) desc`,
      asc(ruleSection.position),
    )
    .limit(limit);
}
