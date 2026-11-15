"use server";

import { notFound, redirect } from "next/navigation";
import { txDb } from "@/db/client";
import { publishConductCode } from "@/db/queries/conduct";
import type { ConductDraftErrors } from "@/domain/conduct/conduct";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { activeLeague } from "@/lib/league/active";
import { refreshRulesPage } from "@/lib/public-cache";

const PAGE = "/app/admin/conduct";

export type ConductDraftState = {
  title: string;
  body: string;
  errors: ConductDraftErrors;
};

const text = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
};

/**
 * Publishes a new version of the code. Earlier versions and acceptances
 * stay; players accept the new one at their next registration. The public
 * rules page shows it at once.
 */
export async function publishConductAction(
  _previous: ConductDraftState,
  form: FormData,
): Promise<ConductDraftState> {
  const subject = await requirePermissionToChange("season.manage", {
    next: PAGE,
  });
  const league = await activeLeague();
  if (!league) notFound();
  const title = text(form, "title");
  const body = text(form, "body");
  const result = await txDb.transaction((tx) =>
    publishConductCode(
      tx,
      { leagueId: league.id, title, body },
      subject.userId,
    ),
  );
  if (!result.ok) return { title, body, errors: result.error };
  refreshRulesPage(league);
  redirect(`${PAGE}?published=${result.value.version}`);
}
