"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { txDb } from "@/db/client";
import {
  currentRules,
  publishRuleChange,
  setRulebookVisibility,
} from "@/db/queries/rules";
import { localDate } from "@/domain/books/ledger-csv";
import { leagueHref } from "@/domain/league/paths";
import { parseVisibility } from "@/domain/rules/rulebook";
import { planImport } from "@/domain/rules/rulebook-import";
import { RULE_FORM_ERRORS } from "@/domain/rules/rules";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { activeLeague } from "@/lib/league/active";
import { refreshRulesPage } from "@/lib/public-cache";

const PAGE = "/app/admin/rules/rulebook";

const text = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value : "";

/** The owner chooses who may read the rulebook. */
export async function setVisibilityAction(form: FormData): Promise<void> {
  const subject = await requirePermissionToChange("rulebook.manage", {
    next: PAGE,
  });
  const league = await activeLeague();
  if (!league) notFound();
  const visibility = parseVisibility(text(form.get("visibility")));
  if (!visibility) redirect(`${PAGE}?error=visibility`);
  await txDb.transaction((tx) =>
    setRulebookVisibility(tx, {
      leagueId: league.id,
      actorId: subject.userId,
      visibility,
    }),
  );
  // The public page shows or hides the rulebook at once.
  refreshRulesPage(league);
  redirect(`${PAGE}?saved=visibility`);
}

export type ImportState = { error: string | null };

/**
 * The owner saves the reviewed sections as the league's rules. A section
 * with the title of a current one edits it, a new title adds one and a
 * current section left out is removed; the change log records each (ADR
 * 0062). Refused with the text kept when someone published first.
 */
export async function importRulebookAction(
  _previous: ImportState,
  form: FormData,
): Promise<ImportState> {
  const subject = await requirePermissionToChange("rulebook.manage", {
    next: PAGE,
  });
  const league = await activeLeague();
  if (!league) notFound();
  const titles = form.getAll("title").map(text);
  const bodies = form.getAll("body").map(text);
  const left = new Set(form.getAll("skip").map(text));
  const imported = titles
    .map((title, i) => ({ title, body: bodies[i] ?? "", index: String(i) }))
    .filter((s) => !left.has(s.index));
  const result = await txDb.transaction(async (tx) => {
    const current = await currentRules(tx, league.id);
    return publishRuleChange(tx, {
      leagueId: league.id,
      actorId: subject.userId,
      sections: planImport(current, imported),
      version: text(form.get("version")),
      summary: text(form.get("summary")) || "Imported the rulebook",
      effectiveOn: text(form.get("effectiveOn")),
      notice: false,
      today: localDate(new Date(), league.timeZone),
      rulesPath: leagueHref(league, "/rules"),
    });
  });
  if (!result.ok) {
    if (result.error === "stale") revalidatePath(PAGE);
    return { error: RULE_FORM_ERRORS[result.error] };
  }
  refreshRulesPage(league);
  redirect(`${PAGE}?saved=import`);
}
