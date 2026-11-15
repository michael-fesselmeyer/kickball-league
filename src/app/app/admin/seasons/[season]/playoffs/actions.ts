"use server";

import { notFound, redirect } from "next/navigation";
import { refreshSeasonPages } from "@/lib/public-cache";
import { db, txDb } from "@/db/client";
import {
  createBracket,
  publishBracket,
  type TierPlan,
} from "@/db/queries/playoffs";
import { MAX_TIERS } from "@/domain/playoffs/playoffs";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { activeLeagueId } from "@/lib/league/active";

const pageFor = (slug: string) => `/app/admin/seasons/${slug}/playoffs`;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** An optional whole number from the form; NaN when it is not one. */
function optionalNumber(form: FormData, name: string): number | null {
  const raw = form.get(name);
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : Number.NaN;
}

/**
 * Reads each tier's settings: `teams-1`, `format-1`, `third-1`, `early-1`,
 * `final-1` and `date-1` for the first tier, and so on. A later tier with
 * no teams is left out.
 */
function tiersFrom(form: FormData): TierPlan[] | null {
  const tiers: TierPlan[] = [];
  for (let i = 1; i <= MAX_TIERS; i++) {
    const teams = optionalNumber(form, `teams-${i}`);
    if (teams === null || (i > 1 && teams === 0)) {
      if (i === 1) return null;
      continue;
    }
    const fromDate = form.get(`date-${i}`);
    const format = form.get(`format-${i}`) ?? "single_elimination";
    const earlyInnings = optionalNumber(form, `early-${i}`);
    const finalInnings = optionalNumber(form, `final-${i}`);
    if (
      Number.isNaN(teams) ||
      typeof fromDate !== "string" ||
      !DATE.test(fromDate) ||
      (format !== "single_elimination" && format !== "double_elimination") ||
      Number.isNaN(earlyInnings) ||
      Number.isNaN(finalInnings)
    )
      return null;
    tiers.push({
      teams,
      fromDate,
      format,
      thirdPlace:
        format === "single_elimination" && form.get(`third-${i}`) === "on",
      earlyInnings,
      finalInnings,
    });
  }
  return tiers;
}

/** Seeds the brackets from the standings and saves them as a draft. */
export async function makeBracket(slug: string, form: FormData) {
  const page = pageFor(slug);
  const subject = await requirePermissionToChange("schedule.manage", {
    next: page,
  });
  const season = await seasonBySlug(db, await activeLeagueId(), slug);
  if (!season) notFound();
  const tiers = tiersFrom(form);
  const [first] = tiers ?? [];
  if (!tiers || !first) redirect(`${page}?error=bad_input`);
  const result = await createBracket(txDb, {
    seasonId: season.id,
    ...first,
    tiers,
    actorId: subject.userId,
  });
  if (!result.ok) redirect(`${page}?error=${result.error}`);
  redirect(`${page}?drafted=1`);
}

/** Publishes the draft bracket and starts the playoffs. */
export async function publishDraftBracket(slug: string) {
  const page = pageFor(slug);
  const subject = await requirePermissionToChange("schedule.manage", {
    next: page,
  });
  const season = await seasonBySlug(db, await activeLeagueId(), slug);
  if (!season) notFound();
  const result = await publishBracket(txDb, season.id, subject.userId);
  if (!result.ok) redirect(`${page}?error=${result.error}`);
  // The public bracket is cached; show the published one at once.
  refreshSeasonPages(season.id);
  redirect(`${page}?published=1`);
}
