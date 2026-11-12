"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { placeFreeAgent } from "@/db/queries/registrations-admin";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { parseId, type RegistrationId, type TeamSeasonId } from "@/domain/ids";
import { requirePermission } from "@/lib/auth/permission";
import { recordPaymentFor } from "@/app/app/seasons/[season]/record-payment";

const pageFor = (slug: string) => `/app/admin/seasons/${slug}/registrations`;

export async function recordPaymentAction(
  slug: string,
  registrationId: string,
  form: FormData,
): Promise<void> {
  const page = pageFor(slug);
  const subject = await requirePermission("season.manage", { next: page });
  const result = await recordPaymentFor(subject, slug, registrationId, form);
  if (!result.ok) redirect(`${page}?error=${result.error}`);
  redirect(`${page}?notice=payment_recorded`);
}

export async function placeFreeAgentAction(
  slug: string,
  rawRegistrationId: string,
  form: FormData,
): Promise<void> {
  const page = pageFor(slug);
  const subject = await requirePermission("free_agents.place", { next: page });
  const season = await seasonBySlug(db, slug);
  if (!season) notFound();
  const registrationId = parseId<RegistrationId>(rawRegistrationId);
  const teamSeasonId = parseId<TeamSeasonId>(form.get("teamSeasonId"));
  if (!registrationId || !teamSeasonId) redirect(`${page}?error=unknown_team`);
  const result = await txDb.transaction((tx) =>
    placeFreeAgent(tx, {
      seasonId: season.id,
      registrationId,
      teamSeasonId,
      actorId: subject.userId,
      now: new Date(),
    }),
  );
  if (!result.ok) redirect(`${page}?error=${result.error}`);
  redirect(`${page}?notice=placed`);
}
