"use server";

import { redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { setAiBudget } from "@/db/queries/ai";
import {
  setFeature,
  setGlobalRole,
  setSiteStatus,
  siteSettings,
} from "@/db/queries/platform";
import { parseBudgetDollars } from "@/domain/ai/budget";
import {
  isFeature,
  isGrantableRole,
  isSiteStatus,
} from "@/domain/platform/operator";
import { formStrings } from "@/lib/form";
import { requireFreshOperator } from "@/lib/platform/require-operator";
import { forgetSite } from "@/lib/platform/site";

function back(query: string): never {
  redirect(`/operator?${query}`);
}

async function league() {
  const site = await siteSettings(db);
  if (!site) back("error=no_league");
  return site;
}

/** Opens, freezes or pauses the whole site. */
export async function setSiteStatusAction(form: FormData): Promise<void> {
  const operator = await requireFreshOperator();
  const { status } = formStrings(form, ["status"] as const);
  if (!isSiteStatus(status)) back("error=bad_status");
  const site = await league();
  await txDb.transaction((tx) =>
    setSiteStatus(tx, {
      leagueId: site.leagueId,
      status,
      actorId: operator.userId,
    }),
  );
  forgetSite();
  back("saved=status");
}

/** Switches one feature on or off for the league. */
export async function setFeatureAction(form: FormData): Promise<void> {
  const operator = await requireFreshOperator();
  const { feature, on } = formStrings(form, ["feature", "on"] as const);
  if (!isFeature(feature)) back("error=bad_feature");
  const site = await league();
  await txDb.transaction((tx) =>
    setFeature(tx, {
      leagueId: site.leagueId,
      feature,
      on: on === "true",
      actorId: operator.userId,
    }),
  );
  forgetSite();
  back("saved=feature");
}

/** Sets what the AI features may spend in a month. */
export async function setAiBudgetAction(form: FormData): Promise<void> {
  const operator = await requireFreshOperator();
  const { dollars } = formStrings(form, ["dollars"] as const);
  const cents = parseBudgetDollars(dollars);
  if (cents === null) back("error=bad_budget");
  const site = await league();
  await txDb.transaction((tx) =>
    setAiBudget(tx, {
      leagueId: site.leagueId,
      budgetCents: cents,
      actorId: operator.userId,
    }),
  );
  back("saved=ai_budget");
}

/** Makes a person a player, an admin or an owner. */
export async function setRoleAction(form: FormData): Promise<void> {
  const operator = await requireFreshOperator();
  const { email, role } = formStrings(form, ["email", "role"] as const);
  if (!isGrantableRole(role)) back("error=bad_role");
  const result = await txDb.transaction((tx) =>
    setGlobalRole(tx, {
      email,
      role,
      actorId: operator.userId,
    }),
  );
  back(result.ok ? "saved=role" : `error=${result.error}`);
}
