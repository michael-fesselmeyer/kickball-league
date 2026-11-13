"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { createPromoCode, disablePromoCode } from "@/db/queries/promo-codes";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { parseId, type PromoCodeId } from "@/domain/ids";
import { type PromoForm, parsePromoForm } from "@/domain/registration/promo";
import { requirePermissionToChange } from "@/lib/auth/permission";

const pageFor = (slug: string) => `/app/admin/seasons/${slug}/promo-codes`;

async function context(slug: string) {
  const page = pageFor(slug);
  const subject = await requirePermissionToChange("season.manage", {
    next: page,
  });
  const season = await seasonBySlug(db, slug);
  if (!season) notFound();
  return { page, subject, season };
}

const text = (form: FormData, key: keyof PromoForm) => {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
};

/** Adds a code for the season (season.manage). */
export async function createPromoCodeAction(
  slug: string,
  form: FormData,
): Promise<void> {
  const { page, subject, season } = await context(slug);
  const parsed = parsePromoForm(
    {
      code: text(form, "code"),
      kind: text(form, "kind"),
      value: text(form, "value"),
      maxRedemptions: text(form, "maxRedemptions"),
      validUntil: text(form, "validUntil"),
    },
    season.timeZone,
  );
  if (!parsed.ok) {
    const field = Object.keys(parsed.error)[0] ?? "code";
    redirect(`${page}?error=${field}`);
  }
  const created = await txDb.transaction((tx) =>
    createPromoCode(tx, {
      seasonId: season.id,
      promo: parsed.value,
      actorId: subject.userId,
    }),
  );
  if (!created.ok) redirect(`${page}?error=${created.error}`);
  redirect(`${page}?notice=created`);
}

/** Turns a code off at once (season.manage). */
export async function disablePromoCodeAction(
  slug: string,
  rawId: string,
): Promise<void> {
  const { page, subject, season } = await context(slug);
  const id = parseId<PromoCodeId>(rawId);
  if (!id) notFound();
  await txDb.transaction((tx) =>
    disablePromoCode(tx, {
      seasonId: season.id,
      id,
      actorId: subject.userId,
      now: new Date(),
    }),
  );
  redirect(`${page}?notice=disabled`);
}
