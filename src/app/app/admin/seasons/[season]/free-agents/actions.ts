"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import {
  buildTeamFromPool,
  matcherInput,
  placeTogether,
} from "@/db/queries/free-agents";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { parseId, type RegistrationId, type TeamSeasonId } from "@/domain/ids";
import { suggestPlacements } from "@/domain/matcher/matcher";
import { requirePermission } from "@/lib/auth/permission";
import { refreshSeasonPages } from "@/lib/public-cache";

const pageFor = (slug: string) => `/app/admin/seasons/${slug}/free-agents`;

async function context(slug: string) {
  const page = pageFor(slug);
  const subject = await requirePermission("free_agents.place", { next: page });
  const season = await seasonBySlug(db, slug);
  if (!season) notFound();
  return { page, subject, season };
}

const ids = (raw: readonly unknown[]) =>
  raw.flatMap((v) => {
    const id = parseId<RegistrationId>(v);
    return id ? [id] : [];
  });

/** Applies one suggestion: everyone in it joins the team, or nobody does. */
export async function applySuggestionAction(
  slug: string,
  rawTeamSeasonId: string,
  rawRegistrationIds: readonly string[],
): Promise<void> {
  const { page, subject, season } = await context(slug);
  const teamSeasonId = parseId<TeamSeasonId>(rawTeamSeasonId);
  const registrationIds = ids(rawRegistrationIds);
  if (!teamSeasonId || registrationIds.length !== rawRegistrationIds.length)
    redirect(`${page}?error=unknown_team`);
  const result = await txDb.transaction((tx) =>
    placeTogether(tx, {
      seasonId: season.id,
      registrationIds,
      teamSeasonId,
      actorId: subject.userId,
      now: new Date(),
    }),
  );
  if (!result.ok) redirect(`${page}?error=${result.error}`);
  refreshSeasonPages(season.id);
  redirect(`${page}?notice=applied`);
}

/**
 * Applies every current suggestion in one transaction. The suggestions are
 * worked out again from the latest data, so they match the page unless
 * someone changed the pool in the meantime.
 */
export async function applyAllAction(slug: string): Promise<void> {
  const { page, subject, season } = await context(slug);
  const input = await matcherInput(db, season.id);
  if (!input) notFound();
  const { suggestions } = suggestPlacements(input.pool, input.teams);
  if (suggestions.length === 0) redirect(`${page}?error=nothing_to_apply`);
  const now = new Date();
  const failed = await txDb
    .transaction(async (tx) => {
      for (const s of suggestions) {
        const result = await placeTogether(tx, {
          seasonId: season.id,
          registrationIds: s.registrationIds as RegistrationId[],
          teamSeasonId: s.teamSeasonId as TeamSeasonId,
          actorId: subject.userId,
          now,
        });
        // Nothing is written for a failed suggestion; stop and roll back all.
        if (!result.ok) throw new SuggestionFailed(result.error);
      }
      return null;
    })
    .catch((e: unknown) => {
      if (e instanceof SuggestionFailed) return e.code;
      throw e;
    });
  if (failed) redirect(`${page}?error=${failed}`);
  refreshSeasonPages(season.id);
  redirect(`${page}?notice=applied_all&count=${suggestions.length}`);
}

class SuggestionFailed extends Error {
  constructor(readonly code: string) {
    super(`A suggestion could not be applied: ${code}`);
  }
}

/** Builds a new team from the players the admin picked. */
export async function buildTeamAction(slug: string, form: FormData) {
  const { page, subject, season } = await context(slug);
  const picked = form.getAll("registrationId");
  const registrationIds = ids(picked);
  const captainId = parseId<RegistrationId>(form.get("captainId"));
  if (registrationIds.length === 0) redirect(`${page}?error=nobody_picked`);
  if (!captainId) redirect(`${page}?error=no_captain`);
  const name = form.get("name");
  const color = form.get("colorHex");
  const result = await txDb.transaction((tx) =>
    buildTeamFromPool(tx, {
      leagueId: season.leagueId,
      seasonId: season.id,
      name: typeof name === "string" ? name : "",
      colorHex: typeof color === "string" && color ? color : null,
      captainId,
      registrationIds,
      actorId: subject.userId,
      now: new Date(),
    }),
  );
  if (!result.ok) redirect(`${page}?error=${result.error}#new-team`);
  refreshSeasonPages(season.id);
  redirect(`${page}?notice=team_built`);
}
