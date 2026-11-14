"use server";

import { isIP } from "node:net";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { currentLeague } from "@/db/queries/seasons";
import { signWaiver, waiverForSeason } from "@/db/queries/waivers";
import { ageMessage } from "@/domain/registration/age";
import { requireSelfToChange } from "@/lib/auth/permission";

export type SignState = { signedName: string; error?: string | undefined };

const MESSAGES: Record<string, string> = {
  no_waiver: "This season has no waiver yet. Check back soon.",
  changed:
    "The waiver was updated while you were reading. Read the new version and sign again.",
  not_agreed: "Tick the box to agree to the waiver.",
  profile_incomplete: "Add your first and last name to your profile first.",
  name_mismatch: "Type your full name as it appears on your profile.",
  already_signed: "You have already signed this waiver.",
};

/** The client's address as the platform reports it, if it is a real IP. */
async function clientIp(): Promise<string | null> {
  const h = await headers();
  const first = (h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? "")
    .split(",")[0]
    ?.trim();
  return first && isIP(first) ? first : null;
}

export async function signWaiverAction(
  slug: string,
  _previous: SignState,
  form: FormData,
): Promise<SignState> {
  const page = `/app/seasons/${slug}/waiver`;
  const subject = await requireSelfToChange("waiver.sign", page);
  const league = await currentLeague(db);
  const view = league
    ? await waiverForSeason(db, {
        leagueId: league.id,
        slug,
        userId: subject.userId,
      })
    : null;
  if (!view) notFound();
  const signedName = String(form.get("signedName") ?? "");
  const result = await txDb.transaction(async (tx) =>
    signWaiver(tx, {
      userId: subject.userId,
      seasonId: view.seasonId,
      shownSha256: String(form.get("shownSha256") ?? ""),
      agreed: form.get("agree") === "yes",
      ageConfirmed: form.get("ageConfirmed") === "yes",
      signedName,
      ip: await clientIp(),
      userAgent: (await headers()).get("user-agent"),
    }),
  );
  if (!result.ok && result.error !== "already_signed")
    return {
      signedName,
      error:
        result.error === "age_unconfirmed" || result.error === "under_age"
          ? ageMessage(result.error, view.minimumAge)
          : MESSAGES[result.error],
    };
  redirect(`${page}?signed=1`);
}
