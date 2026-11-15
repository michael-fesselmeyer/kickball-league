"use server";

import { redirect } from "next/navigation";
import { txDb } from "@/db/client";
import {
  addInsurance,
  removeInsurance,
  setPermitDetails,
} from "@/db/queries/books";
import { optionalCents, optionalDate } from "@/domain/books/forms";
import { type InsuranceCertificateId, parseId } from "@/domain/ids";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { prepareUpload, type PreparedFile } from "@/lib/books/store-file";
import { refreshOwnerDashboard } from "@/lib/owner-dashboard-cache";
import { booksSeason, text, upload } from "../../load";

const pageFor = (slug: string) => `/app/books/${slug}/permits`;

function back(
  slug: string,
  section: string,
  query: Record<string, string>,
): never {
  redirect(
    `${pageFor(slug)}?${new URLSearchParams(query).toString()}#${section}`,
  );
}

async function context(slug: string) {
  const subject = await requirePermissionToChange("books.manage", {
    next: pageFor(slug),
  });
  return { actor: subject.userId, ...(await booksSeason(slug)) };
}

/** The uploaded file, prepared, or a redirect with what went wrong. */
async function prepared(
  slug: string,
  section: string,
  form: FormData,
): Promise<PreparedFile | null> {
  const file = upload(form, "document");
  if (!file) return null;
  const result = await prepareUpload(file);
  if (!result.ok) back(slug, section, { error: result.error });
  return result.value;
}

export async function savePermitDetailsAction(slug: string, form: FormData) {
  const { actor, league, season } = await context(slug);
  const cost = optionalCents(text(form, "cost"));
  const opens = optionalDate(text(form, "applicationOpensOn"));
  const closes = optionalDate(text(form, "applicationClosesOn"));
  const renews = optionalDate(text(form, "renewsOn"));
  if (!cost.ok) back(slug, "permits", { error: "amount" });
  if (!opens.ok || !closes.ok || !renews.ok)
    back(slug, "permits", { error: "date" });
  const document = await prepared(slug, "permits", form);
  const result = await txDb.transaction((tx) =>
    setPermitDetails(
      tx,
      {
        leagueId: league.id,
        seasonId: season.id,
        key: text(form, "key"),
        costCents: cost.value,
        ...(document ? { document } : {}),
        applicationOpensOn: opens.value,
        applicationClosesOn: closes.value,
        renewsOn: renews.value,
      },
      actor,
    ),
  );
  if (!result.ok) back(slug, "permits", { error: result.error });
  // A permit's cost is part of the dashboard's money out.
  refreshOwnerDashboard();
  back(slug, "permits", { notice: "permit_saved" });
}

export async function addInsuranceAction(slug: string, form: FormData) {
  const { actor, league } = await context(slug);
  const starts = optionalDate(text(form, "startsOn"));
  const expires = optionalDate(text(form, "expiresOn"));
  const startsOn = starts.ok ? starts.value : null;
  const expiresOn = expires.ok ? expires.value : null;
  if (!startsOn || !expiresOn) back(slug, "insurance", { error: "date" });
  const document = await prepared(slug, "insurance", form);
  const result = await txDb.transaction((tx) =>
    addInsurance(
      tx,
      {
        leagueId: league.id,
        insurer: text(form, "insurer"),
        policyNumber: text(form, "policyNumber"),
        startsOn,
        expiresOn,
        document,
      },
      actor,
    ),
  );
  if (!result.ok) back(slug, "insurance", { error: result.error });
  back(slug, "insurance", { notice: "insurance_added" });
}

export async function removeInsuranceAction(slug: string, form: FormData) {
  const { actor, league } = await context(slug);
  const id = parseId<InsuranceCertificateId>(text(form, "id"));
  if (!id) back(slug, "insurance", { error: "unknown_certificate" });
  const result = await txDb.transaction((tx) =>
    removeInsurance(tx, { leagueId: league.id, id }, actor),
  );
  if (!result.ok) back(slug, "insurance", { error: result.error });
  back(slug, "insurance", { notice: "insurance_removed" });
}
