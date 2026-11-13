"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import {
  addDivision,
  addRuleSet,
  assignTeams,
  divisionsScreen,
  editDivision,
  removeDivision,
  saveDivisionSettings,
} from "@/db/queries/divisions";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { type DivisionId, parseId, type RuleSetId } from "@/domain/ids";
import { parseCrossoverGames, parseRuleSet } from "@/domain/season/divisions";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { refreshSeasonPages } from "@/lib/public-cache";

const pageFor = (slug: string) => `/app/admin/seasons/${slug}/divisions`;

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
};

/** Checks the admin may manage the season, and finds it. */
async function context(slug: string) {
  const page = pageFor(slug);
  const subject = await requirePermissionToChange("season.manage", {
    next: page,
  });
  const season = await seasonBySlug(db, slug);
  if (!season) notFound();
  return { page, actor: subject.userId, season };
}

/** Back to the screen with an error code or a notice, at a section. */
function back(
  page: string,
  section: string,
  query: Record<string, string>,
): never {
  redirect(`${page}?${new URLSearchParams(query).toString()}#${section}`);
}

/** The rule set picked in a form, or null for none. */
function ruleSetFrom(form: FormData): RuleSetId | null {
  return parseId<RuleSetId>(form.get("ruleSetId"));
}

export async function createDivisionAction(slug: string, form: FormData) {
  const { page, actor, season } = await context(slug);
  const result = await txDb.transaction((tx) =>
    addDivision(
      tx,
      {
        seasonId: season.id,
        name: text(form, "name"),
        ruleSetId: ruleSetFrom(form),
      },
      actor,
    ),
  );
  if (!result.ok) back(page, "divisions", { error: result.error });
  refreshSeasonPages(season.id);
  back(page, "divisions", { notice: "division_added" });
}

export async function updateDivisionAction(
  slug: string,
  divisionId: DivisionId,
  form: FormData,
) {
  const { page, actor, season } = await context(slug);
  const result = await txDb.transaction((tx) =>
    editDivision(
      tx,
      {
        seasonId: season.id,
        divisionId,
        name: text(form, "name"),
        ruleSetId: ruleSetFrom(form),
      },
      actor,
    ),
  );
  if (!result.ok) back(page, "divisions", { error: result.error });
  refreshSeasonPages(season.id);
  back(page, "divisions", { notice: "division_saved" });
}

export async function deleteDivisionAction(
  slug: string,
  divisionId: DivisionId,
) {
  const { page, actor, season } = await context(slug);
  const result = await txDb.transaction((tx) =>
    removeDivision(tx, { seasonId: season.id, divisionId }, actor),
  );
  if (!result.ok) back(page, "divisions", { error: result.error });
  refreshSeasonPages(season.id);
  back(page, "divisions", { notice: "division_removed" });
}

/** Saves every team's division from one form: a select per team. */
export async function assignTeamsAction(slug: string, form: FormData) {
  const { page, actor, season } = await context(slug);
  const screen = await divisionsScreen(db, season.leagueId, season.id);
  const assignments = screen.teams.map((t) => ({
    teamSeasonId: t.id,
    divisionId: parseId<DivisionId>(form.get(`team-${t.id}`)),
  }));
  const result = await txDb.transaction((tx) =>
    assignTeams(tx, { seasonId: season.id, assignments }, actor),
  );
  if (!result.ok) back(page, "teams", { error: result.error });
  refreshSeasonPages(season.id);
  back(page, "teams", {
    notice: "teams_saved",
    count: String(result.value),
  });
}

export async function saveSettingsAction(slug: string, form: FormData) {
  const { page, actor, season } = await context(slug);
  const crossovers = parseCrossoverGames(text(form, "crossoverGames"));
  if (!crossovers.ok) back(page, "settings", { error: crossovers.error });
  const result = await txDb.transaction((tx) =>
    saveDivisionSettings(
      tx,
      {
        seasonId: season.id,
        crossoverGames: crossovers.value,
        crossoversCount: form.get("crossoversCount") === "on",
        combinedFinal: form.get("combinedFinal") === "on",
      },
      actor,
    ),
  );
  if (!result.ok) back(page, "settings", { error: result.error });
  refreshSeasonPages(season.id);
  back(page, "settings", { notice: "settings_saved" });
}

export async function createRuleSetAction(slug: string, form: FormData) {
  const { page, actor, season } = await context(slug);
  const parsed = parseRuleSet({
    name: text(form, "name"),
    innings: text(form, "innings"),
    timeLimitMinutes: text(form, "timeLimitMinutes"),
    bunting: form.get("bunting") === "on",
    stealing: form.get("stealing") === "on",
  });
  if (!parsed.ok) back(page, "rule-sets", { error: `rule_${parsed.error}` });
  const result = await txDb.transaction((tx) =>
    addRuleSet(tx, { leagueId: season.leagueId, ...parsed.value }, actor),
  );
  if (!result.ok) back(page, "rule-sets", { error: "rule_duplicate" });
  refreshSeasonPages(season.id);
  back(page, "rule-sets", { notice: "rule_set_added" });
}
