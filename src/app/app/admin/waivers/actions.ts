"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { currentLeague } from "@/db/queries/seasons";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { assignWaiver, publishWaiver } from "@/db/queries/waivers";
import type { WaiverId } from "@/domain/ids";
import type { WaiverDraftErrors } from "@/domain/waiver/waiver";
import { requirePermission } from "@/lib/auth/permission";

const PAGE = "/app/admin/waivers";

export type WaiverDraftState = {
  title: string;
  body: string;
  errors: WaiverDraftErrors;
};

const text = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
};

/** Publishes a new waiver version; earlier versions and signatures stay. */
export async function publishWaiverAction(
  _previous: WaiverDraftState,
  form: FormData,
): Promise<WaiverDraftState> {
  const subject = await requirePermission("season.manage", { next: PAGE });
  const league = await currentLeague(db);
  if (!league) notFound();
  const title = text(form, "title");
  const body = text(form, "body");
  const result = await txDb.transaction((tx) =>
    publishWaiver(tx, { leagueId: league.id, title, body }, subject.userId),
  );
  if (!result.ok) return { title, body, errors: result.error };
  redirect(`${PAGE}?published=${result.value.version}`);
}

/** Sets the version a season's players sign. */
export async function assignWaiverAction(slug: string, form: FormData) {
  const subject = await requirePermission("season.manage", { next: PAGE });
  const league = await currentLeague(db);
  const season = await seasonBySlug(db, slug);
  if (!league || !season) notFound();
  const chosen = text(form, "waiverId");
  const result = await txDb.transaction((tx) =>
    assignWaiver(
      tx,
      {
        leagueId: league.id,
        seasonId: season.id,
        waiverId: chosen ? (chosen as WaiverId) : null,
      },
      subject.userId,
    ),
  );
  if (!result.ok) redirect(`${PAGE}?error=${result.error}`);
  redirect(`${PAGE}?assigned=${encodeURIComponent(season.name)}`);
}
