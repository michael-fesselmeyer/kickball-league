"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { publishRuleChange } from "@/db/queries/rules";
import { currentLeague } from "@/db/queries/seasons";
import { localDate } from "@/domain/books/ledger-csv";
import { RULE_FORM_ERRORS, type SubmittedSection } from "@/domain/rules/rules";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { refreshRulesPage } from "@/lib/public-cache";
import { sendQueuedSoon } from "@/services/outbox";

export type RulesDraft = {
  sections: SubmittedSection[];
  summary: string;
  effectiveOn: string;
  notice: boolean;
};

export type RulesFormState = {
  draft: RulesDraft | null;
  error: string | null;
  /**
   * Someone else published first: the editor reloads the rules as they are
   * now and shows this draft beside it to copy from.
   */
  stale: boolean;
};

const PAGE = "/app/admin/rules";

const text = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value : "";

/**
 * The editor's sections, in page order. Each section's fieldset sends an
 * id (empty for the new one), a title and a body in that order, so the
 * three lists line up; a ticked remove box sends the section's id.
 */
function readDraft(form: FormData): RulesDraft {
  const ids = form.getAll("id").map(text);
  const titles = form.getAll("title").map(text);
  const bodies = form.getAll("body").map(text);
  const removed = new Set(form.getAll("remove").map(text));
  return {
    sections: ids.map((id, i) => ({
      id: id || null,
      title: titles[i] ?? "",
      body: bodies[i] ?? "",
      remove: id !== "" && removed.has(id),
    })),
    summary: text(form.get("summary")),
    effectiveOn: text(form.get("effectiveOn")),
    notice: form.get("notice") === "1",
  };
}

/**
 * An admin publishes a change to the rules (ADR 0056). On a refusal the
 * editor comes back with everything typed, so nothing is lost.
 */
export async function publishRulesAction(
  _previous: RulesFormState,
  form: FormData,
): Promise<RulesFormState> {
  const subject = await requirePermissionToChange("rules.manage", {
    next: PAGE,
  });
  const league = await currentLeague(db);
  if (!league) notFound();
  const draft = readDraft(form);
  const result = await txDb.transaction((tx) =>
    publishRuleChange(tx, {
      leagueId: league.id,
      actorId: subject.userId,
      sections: draft.sections,
      version: text(form.get("version")),
      summary: draft.summary,
      effectiveOn: draft.effectiveOn,
      notice: draft.notice,
      today: localDate(new Date(), league.timeZone),
    }),
  );
  if (!result.ok) {
    const stale = result.error === "stale";
    // The page comes back with the newest rules and version.
    if (stale) revalidatePath(PAGE);
    return { draft, error: RULE_FORM_ERRORS[result.error], stale };
  }
  refreshRulesPage();
  // The notices go now, within quiet hours and the email quota.
  if (result.value.recipients > 0) sendQueuedSoon();
  redirect(`${PAGE}?published=1&told=${result.value.recipients}`);
}
