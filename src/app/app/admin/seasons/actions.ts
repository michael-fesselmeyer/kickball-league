"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import {
  createSeason,
  currentLeague,
  SEASON_STATUSES,
  type SeasonStatus,
  seasonSettings,
  updateSeason,
} from "@/db/queries/seasons";
import {
  parseSeasonForm,
  SEASON_FIELDS,
  type SeasonErrors,
  type SeasonForm,
} from "@/domain/season/settings";
import { requirePermission } from "@/lib/auth/permission";

export type SeasonFormState = {
  values: SeasonForm;
  status?: string | undefined;
  errors: SeasonErrors;
  message?: string;
};

const valuesOf = (form: FormData) =>
  Object.fromEntries(
    SEASON_FIELDS.map((k) => {
      const v = form.get(k);
      return [k, typeof v === "string" ? v : ""];
    }),
  ) as SeasonForm;

const CHECK = "Check the fields marked below.";
const DUPLICATE = "Another season already has that name.";

export async function createSeasonAction(
  _previous: SeasonFormState,
  form: FormData,
): Promise<SeasonFormState> {
  const subject = await requirePermission("season.manage", {
    next: "/app/admin/seasons/new",
  });
  const league = await currentLeague(db);
  if (!league) notFound();
  const values = valuesOf(form);
  const parsed = parseSeasonForm(values, league.timeZone);
  if (!parsed.ok) return { values, errors: parsed.errors, message: CHECK };
  const created = await txDb.transaction((tx) =>
    createSeason(
      tx,
      { leagueId: league.id, settings: parsed.value },
      subject.userId,
    ),
  );
  if (!created.ok)
    return { values, errors: { name: DUPLICATE }, message: CHECK };
  redirect(`/app/admin/seasons/${created.value.slug}?created=1`);
}

export async function updateSeasonAction(
  slug: string,
  _previous: SeasonFormState,
  form: FormData,
): Promise<SeasonFormState> {
  const subject = await requirePermission("season.manage", {
    next: `/app/admin/seasons/${slug}`,
  });
  const league = await currentLeague(db);
  if (!league) notFound();
  const existing = await seasonSettings(db, league.id, slug);
  if (!existing) notFound();
  const values = valuesOf(form);
  const status = String(form.get("status") ?? "");
  const parsed = parseSeasonForm(values, league.timeZone);
  const statusOk = (SEASON_STATUSES as readonly string[]).includes(status);
  if (!parsed.ok || !statusOk)
    return {
      values,
      status,
      errors: parsed.ok ? {} : parsed.errors,
      message: statusOk ? CHECK : "Choose a status.",
    };
  const updated = await txDb.transaction((tx) =>
    updateSeason(
      tx,
      {
        leagueId: league.id,
        seasonId: existing.id,
        settings: parsed.value,
        status: status as SeasonStatus,
      },
      subject.userId,
    ),
  );
  if (!updated.ok) {
    if (updated.error === "unknown_season") notFound();
    return { values, status, errors: { name: DUPLICATE }, message: CHECK };
  }
  redirect(`/app/admin/seasons/${updated.value.slug}?saved=1`);
}
