"use server";

import { notFound, redirect } from "next/navigation";
import { txDb } from "@/db/client";
import {
  addOption,
  closeInterestForm,
  goAhead,
  openInterestForm,
  removeAnswer,
  removeOption,
  reopenInterestForm,
  updateTarget,
} from "@/db/queries/interest";
import {
  type InterestFormId,
  type InterestOptionId,
  parseId,
} from "@/domain/ids";
import {
  isBlankOption,
  MAX_OPTIONS,
  normalizeEmail,
  type OptionInput,
  parseForm,
  parseNote,
  parseOption,
} from "@/domain/interest/interest";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { formStrings } from "@/lib/form";
import { activeLeague } from "@/lib/league/active";
import { requireInLeague } from "@/lib/league/guard";
import { refreshInterestPage } from "@/lib/public-cache";
import { sendQueuedSoon } from "@/services/outbox";
import { openLeagueFromOption } from "@/db/queries/interest-league";
import { SPORTS, type Sport } from "@/domain/league/new-league";
import { refreshLeaguePages } from "@/lib/league/refresh";
import { requireFreshOperator } from "@/lib/platform/require-operator";
import { type ErrorKey } from "./words";

const PAGE = "/app/admin/interest";
const go = (notice: string): never => redirect(`${PAGE}?notice=${notice}`);
const fail = (error: ErrorKey): never => redirect(`${PAGE}?error=${error}`);

async function guard() {
  const subject = await requirePermissionToChange("interest.manage", {
    next: PAGE,
  });
  const league = await activeLeague();
  if (!league) notFound();
  return { subject, league };
}

async function guardForm(rawId: string) {
  const g = await guard();
  const formId = parseId<InterestFormId>(rawId);
  if (!formId) notFound();
  await requireInLeague(g.subject, { interest_form: formId });
  return { ...g, formId };
}

/** The option rows of the opening form: `park-0`, `night-0`, `format-0`, ... */
function readOptions(form: FormData): OptionInput[] | ErrorKey {
  const options: OptionInput[] = [];
  for (let i = 0; i < MAX_OPTIONS; i++) {
    const raw = formStrings(form, [`park${i}`, `night${i}`, `format${i}`]);
    const row = {
      park: raw[`park${i}`] ?? "",
      night: raw[`night${i}`] ?? "",
      format: raw[`format${i}`] ?? "",
    };
    if (isBlankOption(row)) continue;
    const parsed = parseOption(row);
    if (!parsed.ok) return `option_${parsed.error}`;
    options.push(parsed.value);
  }
  return options;
}

export async function openFormAction(form: FormData): Promise<void> {
  const { subject, league } = await guard();
  const parsed = parseForm(
    formStrings(form, ["title", "intro", "teamsNeeded", "playersPerTeam"]),
  );
  if (!parsed.ok) return fail(`form_${parsed.error}`);
  const options = readOptions(form);
  if (typeof options === "string") return fail(options);
  const opened = await openInterestForm(txDb, {
    leagueId: league.id,
    actorId: subject.userId,
    form: parsed.value,
    options,
  });
  if (!opened.ok) return fail(opened.error);
  refreshInterestPage(league);
  return go("opened");
}

export async function targetAction(
  rawId: string,
  form: FormData,
): Promise<void> {
  const { subject, league, formId } = await guardForm(rawId);
  const current = formStrings(form, ["teamsNeeded", "playersPerTeam"]);
  const parsed = parseForm({ title: "x", intro: "", ...current });
  if (!parsed.ok) return fail(`form_${parsed.error}`);
  const saved = await updateTarget(txDb, {
    formId,
    leagueId: league.id,
    actorId: subject.userId,
    form: parsed.value,
  });
  if (!saved.ok) notFound();
  return go("target");
}

export async function closeAction(rawId: string): Promise<void> {
  const { subject, league, formId } = await guardForm(rawId);
  const closed = await closeInterestForm(txDb, {
    formId,
    leagueId: league.id,
    actorId: subject.userId,
    now: new Date(),
  });
  if (!closed.ok) return closed.error === "closed" ? go("closed") : notFound();
  refreshInterestPage(league);
  return go("closed");
}

export async function reopenAction(rawId: string): Promise<void> {
  const { subject, league, formId } = await guardForm(rawId);
  const reopened = await reopenInterestForm(txDb, {
    formId,
    leagueId: league.id,
    actorId: subject.userId,
  });
  if (!reopened.ok) {
    if (reopened.error === "not_found") notFound();
    return fail("already_open");
  }
  refreshInterestPage(league);
  return go("reopened");
}

export async function addOptionAction(
  rawId: string,
  form: FormData,
): Promise<void> {
  const { subject, league, formId } = await guardForm(rawId);
  const raw = formStrings(form, ["park", "night", "format"]);
  const parsed = parseOption(raw);
  if (!parsed.ok) return fail(`option_${parsed.error}`);
  const added = await addOption(txDb, {
    formId,
    leagueId: league.id,
    actorId: subject.userId,
    option: parsed.value,
  });
  if (!added.ok) {
    if (added.error === "not_found") notFound();
    return fail(`add_${added.error}`);
  }
  refreshInterestPage(league);
  return go("added");
}

export async function removeOptionAction(rawId: string): Promise<void> {
  const { subject, league } = await guard();
  const optionId = parseId<InterestOptionId>(rawId);
  if (!optionId) notFound();
  await requireInLeague(subject, { interest_option: optionId });
  const removed = await removeOption(txDb, {
    optionId,
    leagueId: league.id,
    actorId: subject.userId,
  });
  if (!removed.ok) {
    if (removed.error === "not_found") notFound();
    return fail(removed.error);
  }
  refreshInterestPage(league);
  return go("removed");
}

/** Decides an option goes ahead; everyone who picked it is emailed once. */
export async function goAheadAction(
  rawId: string,
  form: FormData,
): Promise<void> {
  const { subject, league } = await guard();
  const optionId = parseId<InterestOptionId>(rawId);
  if (!optionId) notFound();
  await requireInLeague(subject, { interest_option: optionId });
  if (form.get("confirm") !== "yes") return fail("confirm");
  const note = parseNote(formStrings(form, ["note"]).note);
  if (!note.ok) return fail("note");
  const went = await goAhead(txDb, {
    optionId,
    leagueId: league.id,
    actorId: subject.userId,
    note: note.value,
    now: new Date(),
  });
  if (!went.ok) {
    if (went.error === "not_found") notFound();
    return fail(went.error === "already" ? "already_went" : "went_closed");
  }
  refreshInterestPage(league);
  sendQueuedSoon();
  return go(`ahead-${went.value.told}`);
}

/** Deletes one address's answer, when its owner asks the league to. */
export async function removeAnswerAction(
  rawId: string,
  form: FormData,
): Promise<void> {
  const { subject, league, formId } = await guardForm(rawId);
  const email = normalizeEmail(formStrings(form, ["email"]).email);
  if (email === "") return fail("email");
  const removed = await removeAnswer(txDb, {
    formId,
    leagueId: league.id,
    actorId: subject.userId,
    email,
  });
  return removed ? go("answer-removed") : fail("no_answer");
}

/**
 * Opens a new league with a draft season from an option (ADR 0087). Only
 * the operator starts leagues (ADR 0048); anyone else gets a 404.
 */
export async function openLeagueAction(
  rawId: string,
  form: FormData,
): Promise<void> {
  const operator = await requireFreshOperator();
  const optionId = parseId<InterestOptionId>(rawId);
  if (!optionId) notFound();
  const league = await activeLeague();
  if (!league) notFound();
  const sport = formStrings(form, ["sport"]).sport;
  if (!SPORTS.some((s) => s.value === sport)) return fail("sport");
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: league.timeZone,
  }).format(new Date());
  const opened = await txDb.transaction((tx) =>
    openLeagueFromOption(tx, {
      optionId,
      sport: sport as Sport,
      actorId: operator.userId,
      today,
    }),
  );
  if (!opened.ok) {
    if (opened.error === "not_found") notFound();
    return fail(opened.error);
  }
  refreshLeaguePages();
  return go("league-opened");
}
