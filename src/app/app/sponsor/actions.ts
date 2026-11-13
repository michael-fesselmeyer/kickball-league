"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { currentLeague } from "@/db/queries/seasons";
import {
  addSponsorMember,
  confirmDeals,
  createSponsor,
  removeSponsor,
  removeSponsorMember,
  saveDeal,
  setDealActive,
  sponsorBySlug,
  updateSponsor,
} from "@/db/queries/sponsors";
import { can } from "@/domain/authz/permissions";
import { type DealId, parseId, type UserId } from "@/domain/ids";
import { parseDealForm } from "@/domain/sponsors/deals";
import { parseSponsorForm } from "@/domain/sponsors/sponsor-form";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { formStrings } from "@/lib/form";
import { refreshSponsorPages } from "@/lib/public-cache";

const ADMIN_PAGE = "/app/sponsor";
const portal = (slug: string) => `/app/sponsor/${slug}`;

function sponsorFields(form: FormData) {
  return {
    ...formStrings(form, [
      "name",
      "slug",
      "kind",
      "blurb",
      "address",
      "url",
    ] as const),
    homeBar: form.get("homeBar") === "on",
  };
}

/** The sponsor, and the signed-in person if they may edit it. */
async function editable(slug: string, next: string) {
  const sponsor = await sponsorBySlug(db, slug);
  if (!sponsor) notFound();
  const subject = await requirePermissionToChange("sponsor.edit", {
    next,
    sponsorId: sponsor.id,
  });
  return { sponsor, subject };
}

/** An admin adds a sponsor. */
export async function createSponsorAction(form: FormData): Promise<void> {
  const subject = await requirePermissionToChange("sponsor.edit", {
    next: ADMIN_PAGE,
  });
  const league = await currentLeague(db);
  if (!league) redirect(`${ADMIN_PAGE}?error=no_league`);
  const parsed = parseSponsorForm(sponsorFields(form));
  if (!parsed.ok) redirect(`${ADMIN_PAGE}?error=${parsed.error}`);
  const result = await txDb.transaction((tx) =>
    createSponsor(tx, {
      ...parsed.value,
      leagueId: league.id,
      actorId: subject.userId,
    }),
  );
  if (!result.ok) redirect(`${ADMIN_PAGE}?error=${result.error}`);
  refreshSponsorPages();
  redirect(`${portal(parsed.value.slug)}?notice=created`);
}

/**
 * Saves the sponsor's details. The sponsor's own people change what
 * players read; only an admin changes the page address, kind or home bar.
 */
export async function updateSponsorAction(
  slug: string,
  form: FormData,
): Promise<void> {
  const page = portal(slug);
  const { sponsor, subject } = await editable(slug, page);
  const parsed = parseSponsorForm({
    ...sponsorFields(form),
    // Fields a sponsor's own people do not see keep their values.
    slug: form.has("slug") ? sponsorFields(form).slug : sponsor.slug,
    kind: form.has("kind") ? sponsorFields(form).kind : sponsor.kind,
    homeBar: form.has("homeBarShown")
      ? form.get("homeBar") === "on"
      : sponsor.isHomeBar,
  });
  if (!parsed.ok) redirect(`${page}?error=${parsed.error}#details`);
  const result = await txDb.transaction((tx) =>
    updateSponsor(tx, {
      sponsorId: sponsor.id,
      details: parsed.value,
      asAdmin: can(subject, "sponsor.edit", {}),
      actorId: subject.userId,
    }),
  );
  if (!result.ok) redirect(`${page}?error=${result.error}#details`);
  refreshSponsorPages();
  redirect(`${portal(parsed.value.slug)}?notice=saved#details`);
}

/** An admin takes a sponsor off the site. Its numbers stay. */
export async function removeSponsorAction(slug: string): Promise<void> {
  const sponsor = await sponsorBySlug(db, slug);
  if (!sponsor) notFound();
  const subject = await requirePermissionToChange("sponsor.edit", {
    next: portal(slug),
  });
  await txDb.transaction((tx) =>
    removeSponsor(tx, {
      sponsorId: sponsor.id,
      actorId: subject.userId,
      now: new Date(),
    }),
  );
  refreshSponsorPages();
  redirect(`${ADMIN_PAGE}?notice=removed`);
}

/** An admin gives a person the sponsor's portal, by their account email. */
export async function addMemberAction(
  slug: string,
  form: FormData,
): Promise<void> {
  const page = portal(slug);
  const sponsor = await sponsorBySlug(db, slug);
  if (!sponsor) notFound();
  const subject = await requirePermissionToChange("sponsor.edit", {
    next: page,
  });
  const { email } = formStrings(form, ["email"] as const);
  const result = await txDb.transaction((tx) =>
    addSponsorMember(tx, {
      sponsorId: sponsor.id,
      email,
      actorId: subject.userId,
    }),
  );
  if (!result.ok) redirect(`${page}?error=${result.error}#people`);
  redirect(`${page}?notice=member_added#people`);
}

export async function removeMemberAction(
  slug: string,
  rawUserId: string,
): Promise<void> {
  const page = portal(slug);
  const sponsor = await sponsorBySlug(db, slug);
  const userId = parseId<UserId>(rawUserId);
  if (!sponsor || !userId) notFound();
  const subject = await requirePermissionToChange("sponsor.edit", {
    next: page,
  });
  await txDb.transaction((tx) =>
    removeSponsorMember(tx, {
      sponsorId: sponsor.id,
      userId,
      actorId: subject.userId,
    }),
  );
  redirect(`${page}?notice=member_removed#people`);
}

/** Adds a deal (no id) or changes one. Saving confirms it is current. */
export async function saveDealAction(
  slug: string,
  rawDealId: string | null,
  form: FormData,
): Promise<void> {
  const page = portal(slug);
  const { sponsor, subject } = await editable(slug, page);
  const dealId = rawDealId === null ? null : parseId<DealId>(rawDealId);
  if (rawDealId !== null && dealId === null) notFound();
  const parsed = parseDealForm({
    ...formStrings(form, ["title", "terms", "from", "to"] as const),
    days: form.getAll("day").filter((d): d is string => typeof d === "string"),
  });
  const anchor = dealId ? `#deal-${dealId}` : "#new-deal";
  if (!parsed.ok) redirect(`${page}?error=${parsed.error}${anchor}`);
  const result = await txDb.transaction((tx) =>
    saveDeal(tx, {
      sponsorId: sponsor.id,
      dealId,
      terms: parsed.value,
      actorId: subject.userId,
      now: new Date(),
    }),
  );
  if (!result.ok) notFound();
  refreshSponsorPages();
  redirect(`${page}?notice=deal_saved#deal-${result.value}`);
}

export async function setDealActiveAction(
  slug: string,
  rawDealId: string,
  active: boolean,
): Promise<void> {
  const page = portal(slug);
  const { sponsor, subject } = await editable(slug, page);
  const dealId = parseId<DealId>(rawDealId);
  if (!dealId) notFound();
  const result = await txDb.transaction((tx) =>
    setDealActive(tx, {
      sponsorId: sponsor.id,
      dealId,
      active,
      actorId: subject.userId,
      now: new Date(),
    }),
  );
  if (!result.ok) notFound();
  refreshSponsorPages();
  redirect(`${page}?notice=${active ? "deal_on" : "deal_off"}#deal-${dealId}`);
}

/** "Still current": the public page shows today's date on every deal. */
export async function confirmDealsAction(slug: string): Promise<void> {
  const page = portal(slug);
  const { sponsor, subject } = await editable(slug, page);
  await txDb.transaction((tx) =>
    confirmDeals(tx, {
      sponsorId: sponsor.id,
      actorId: subject.userId,
      now: new Date(),
    }),
  );
  refreshSponsorPages();
  redirect(`${page}?notice=confirmed#deals`);
}
