import { eq } from "drizzle-orm";
import type { Db } from "../queries/schedule";
import { booksFile } from "../schema/books";
import { slot } from "../schema/game";
import { permitWindow } from "../schema/schedule";
import { season } from "../schema/season";
import type { SeasonId } from "@/domain/ids";

/**
 * Covers every slot of a season with a confirmed permit window that has its
 * document, as a league that holds its fields does, so a schedule made on
 * those slots can be published (H12, issue #407). Call after the slots are
 * in.
 */
export async function permitEverySlot(db: Db, seasonId: SeasonId) {
  const [s] = await db
    .select({ leagueId: season.leagueId })
    .from(season)
    .where(eq(season.id, seasonId));
  if (!s) throw new Error("No such season");
  const [file] = await db
    .insert(booksFile)
    .values({
      leagueId: s.leagueId,
      kind: "permit",
      contentType: "application/pdf",
      bytes: Buffer.from("%PDF-1.4"),
      byteSize: 8,
      sha256: `test-permit-${seasonId}`,
    })
    .returning({ id: booksFile.id });
  const slots = await db
    .select({
      fieldId: slot.fieldId,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
    })
    .from(slot)
    .where(eq(slot.seasonId, seasonId));
  if (slots.length === 0) return;
  await db.insert(permitWindow).values(
    slots.map((s) => ({
      ...s,
      seasonId,
      status: "confirmed" as const,
      documentFileId: file?.id ?? null,
    })),
  );
}
