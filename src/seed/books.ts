import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import type { Db } from "@/db/queries/schedule";
import {
  booksFile,
  expense,
  insuranceCertificate,
  permitWindow,
  season,
  slot,
} from "@/db/schema";
import type { BooksFileId, LeagueId, PermitWindowId } from "@/domain/ids";
import { localDay } from "@/domain/schedule/public-game";
import type { SeedData } from "./generate";

/**
 * Sample books for the demo league (ADR 0034): the current season's games
 * sit on permit windows under one invented permit with a cost, a renewal
 * date and a sample document image; a few expenses; and an insurance
 * certificate from an invented insurer. Nothing here is a real permit.
 */

export const SEED_PERMIT_NUMBER = "SAMPLE-0042";

/** Clears the sample books before the league's seasons are removed. */
export async function removeSeedBooks(tx: Db, leagueId: LeagueId) {
  const seasonIds = tx
    .select({ id: season.id })
    .from(season)
    .where(eq(season.leagueId, leagueId));
  await tx.delete(expense).where(inArray(expense.seasonId, seasonIds));
  await tx
    .delete(insuranceCertificate)
    .where(eq(insuranceCertificate.leagueId, leagueId));
  // Permit windows let go of their documents on their own (set null).
  await tx.delete(booksFile).where(eq(booksFile.leagueId, leagueId));
}

/** A sample permit document: an image that says it is a sample. */
async function samplePermitImage(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800">
  <rect width="600" height="800" fill="#fdf6ec"/>
  <rect x="20" y="20" width="560" height="760" fill="none" stroke="#1d1b18" stroke-width="4"/>
  <text x="300" y="120" font-family="sans-serif" font-size="40" text-anchor="middle" fill="#1d1b18">SAMPLE PERMIT</text>
  <text x="300" y="200" font-family="sans-serif" font-size="32" text-anchor="middle" fill="#1d1b18">${SEED_PERMIT_NUMBER}</text>
  <text x="300" y="300" font-family="sans-serif" font-size="24" text-anchor="middle" fill="#5c5650">Demo data, not a real permit</text>
</svg>`;
  return sharp(Buffer.from(svg)).webp({ quality: 70 }).toBuffer();
}

export async function addSeedBooks(tx: Db, data: SeedData) {
  const tz = data.league.timezone;
  const bytes = await samplePermitImage();
  const [file] = await tx
    .insert(booksFile)
    .values({
      leagueId: data.league.id,
      kind: "permit",
      contentType: "image/webp",
      bytes,
      byteSize: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    })
    .returning({ id: booksFile.id });
  const documentFileId: BooksFileId | null = file?.id ?? null;

  // One window per field and game day, covering that day's slots.
  const byWindow = Map.groupBy(
    data.slots,
    (s) => `${s.fieldId}/${localDay(s.startsAt, tz)}`,
  );
  const windows = [...byWindow.values()].flatMap((slots) => {
    const first = slots[0];
    if (!first) return [];
    return [
      {
        fieldId: first.fieldId,
        seasonId: data.season.id,
        startsAt: new Date(Math.min(...slots.map((s) => s.startsAt.getTime()))),
        endsAt: new Date(Math.max(...slots.map((s) => s.endsAt.getTime()))),
        permitNumber: SEED_PERMIT_NUMBER,
        status: "confirmed" as const,
        documentFileId,
        renewsOn: data.nextSeason.startsOn,
        slotIds: slots.map((s) => s.id),
      },
    ];
  });
  // $1,800 for the season, split evenly with the leftover cents up front.
  const total = 180_000;
  const base = Math.floor(total / windows.length);
  const left = total - base * windows.length;
  for (const [i, { slotIds, ...w }] of windows.entries()) {
    const [created] = await tx
      .insert(permitWindow)
      .values({ ...w, costCents: base + (i < left ? 1 : 0) })
      .returning({ id: permitWindow.id });
    const windowId: PermitWindowId | undefined = created?.id;
    if (windowId)
      await tx
        .update(slot)
        .set({ permitWindowId: windowId })
        .where(
          and(inArray(slot.id, slotIds), eq(slot.seasonId, data.season.id)),
        );
  }

  await tx.insert(expense).values([
    {
      seasonId: data.season.id,
      spentOn: data.season.startsOn,
      amountCents: 21_450,
      category: "equipment" as const,
      note: "Twelve kickballs and a pump",
    },
    {
      seasonId: data.season.id,
      spentOn: data.season.startsOn,
      amountCents: 96_000,
      category: "shirts" as const,
      note: "Season shirts, first order",
    },
    {
      seasonId: data.season.id,
      spentOn: data.season.endsOn,
      amountCents: 30_000,
      category: "refs" as const,
      note: "Playoff refs",
    },
  ]);
  await tx.insert(insuranceCertificate).values({
    leagueId: data.league.id,
    insurer: "Example Mutual",
    policyNumber: "GL-SAMPLE-7",
    startsOn: data.season.startsOn,
    expiresOn: data.nextSeason.endsOn,
  });
}
