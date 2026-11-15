"use server";

import { redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { createLeague, leagueById } from "@/db/queries/leagues";
import {
  setFeature,
  setLeagueRoleByEmail,
  setSiteStatus,
  siteSettings,
} from "@/db/queries/platform";
import { parseId, type LeagueId } from "@/domain/ids";
import { parseNewLeague } from "@/domain/league/new-league";
import {
  isFeature,
  isGrantableRole,
  isSiteStatus,
} from "@/domain/platform/operator";
import { formStrings } from "@/lib/form";
import { refreshLeaguePages } from "@/lib/league/refresh";
import { requireFreshOperator } from "@/lib/platform/require-operator";
import { forgetSite } from "@/lib/platform/site";
import { refreshSiteNotice } from "@/lib/public-cache";

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
  refreshSiteNotice();
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

/** Makes a person a player, an admin or an owner of one league (ADR 0048). */
export async function setRoleAction(form: FormData): Promise<void> {
  const operator = await requireFreshOperator();
  const {
    email,
    role,
    league: leagueField,
  } = formStrings(form, ["email", "role", "league"] as const);
  if (!isGrantableRole(role)) back("error=bad_role");
  const leagueId = parseId<LeagueId>(leagueField);
  const found = leagueId ? await leagueById(db, leagueId) : null;
  if (!found) back("error=no_league");
  const result = await txDb.transaction((tx) =>
    setLeagueRoleByEmail(tx, {
      leagueId: found.id,
      email,
      role,
      actorId: operator.userId,
    }),
  );
  back(result.ok ? "saved=role" : `error=${result.error}`);
}

/** Starts a league: its name, sport, address, colors, zone, age and rule set. */
export async function createLeagueAction(form: FormData): Promise<void> {
  const operator = await requireFreshOperator();
  const parsed = parseNewLeague(
    formStrings(form, [
      "name",
      "slug",
      "sport",
      "timeZone",
      "minimumAge",
      "primaryColor",
      "secondaryColor",
      "ruleSetName",
      "innings",
      "bestOf",
      "timeLimitMinutes",
    ] as const),
  );
  if (!parsed.ok) {
    const [field] = Object.keys(parsed.errors);
    back(`error=bad_league&field=${field ?? "name"}`);
  }
  const result = await txDb.transaction((tx) =>
    createLeague(tx, { ...parsed.value, actorId: operator.userId }),
  );
  if (!result.ok) back(`error=${result.error}`);
  refreshLeaguePages();
  back(`saved=league&league=${parsed.value.slug}`);
}
