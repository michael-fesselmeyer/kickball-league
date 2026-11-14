"use server";

import { redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { accountByEmail, mergeAccounts } from "@/db/queries/account-merge";
import { parseId, type UserId } from "@/domain/ids";
import { env } from "@/env";
import {
  requirePermissionToChange,
  sessionIsFresh,
} from "@/lib/auth/permission";
import { operatorIds } from "@/lib/platform/site";
import { leaguesOf } from "@/db/queries/leagues";
import { activeLeagueId } from "@/lib/league/active";

const PAGE = "/app/admin/accounts";

const field = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

/**
 * Finds the two accounts by email address and shows the preview. The page
 * gets account ids, never the addresses, so no email lands in a URL.
 */
export async function findAccountsAction(form: FormData): Promise<void> {
  await requirePermissionToChange("accounts.merge", { next: PAGE });
  const [kept, merged] = await Promise.all([
    accountByEmail(db, field(form, "keep")),
    accountByEmail(db, field(form, "merge")),
  ]);
  if (!kept) redirect(`${PAGE}?error=no_keep`);
  if (!merged || merged.viaAlias) redirect(`${PAGE}?error=no_merge`);
  redirect(`${PAGE}?keep=${kept.id}&merge=${merged.id}`);
}

/**
 * Merges the duplicate account into the kept one (accounts.merge). Needs a
 * sign-in from the last few minutes and the admin's tick that both accounts
 * are the same person; the merge itself re-checks every blocker under a
 * lock, so a stale preview cannot do harm.
 */
export async function mergeAccountsAction(form: FormData): Promise<void> {
  const subject = await requirePermissionToChange("accounts.merge", {
    next: PAGE,
  });
  const keptId = parseId<UserId>(form.get("keptId"));
  const mergedId = parseId<UserId>(form.get("mergedId"));
  if (!keptId || !mergedId) redirect(`${PAGE}?error=no_keep`);
  const back = `${PAGE}?keep=${keptId}&merge=${mergedId}`;
  if (!(await sessionIsFresh())) redirect(`${back}&error=stale`);
  if (form.get("same") !== "on") redirect(`${back}&error=unconfirmed`);
  // A merge moves everything both accounts hold, in every league. An admin
  // may merge only accounts that belong to no league but their own
  // (ADR 0048); the operator may merge any.
  const leagueId = await activeLeagueId();
  if (!leagueId) redirect(`${back}&error=other_league`);
  if (!subject.isOperator) {
    const theirs = (
      await Promise.all([leaguesOf(db, keptId), leaguesOf(db, mergedId)])
    ).flat();
    if (theirs.some((l) => l.id !== leagueId))
      redirect(`${back}&error=other_league`);
  }
  const actorId = subject.userId;
  const result = await txDb.transaction((tx) =>
    mergeAccounts(tx, {
      keptId,
      mergedId,
      leagueId,
      actorId,
      now: new Date(),
      secret: env.BETTER_AUTH_SECRET,
      operatorIds: operatorIds(),
    }),
  );
  if (!result.ok) redirect(`${back}&error=blocked`);
  redirect(`${PAGE}?merged=${keptId}`);
}
