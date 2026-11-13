import { db } from "@/db/client";
import { recordAudit } from "@/db/queries/audit";
import { booksSeasons, seasonBooks } from "@/db/queries/books";
import { currentLeague } from "@/db/queries/seasons";
import { can } from "@/domain/authz/permissions";
import { LEDGER_COLUMNS, ledgerLines } from "@/domain/books/ledger-csv";
import { exportFilename, toCsv } from "@/domain/export/csv";
import { parseId, type UserId } from "@/domain/ids";
import { currentSubject } from "@/lib/auth/permission";

const notFound = () =>
  new Response("Not found.", {
    status: 404,
    headers: { "Cache-Control": "private, no-store" },
  });

/**
 * The season's books as a CSV for taxes, one line per transaction. Owners
 * and the operator only; each download is audited.
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/app/books/[season]/ledger.csv">,
) {
  const subject = await currentSubject();
  const userId = parseId<UserId>(subject.userId);
  if (!userId || !can(subject, "books.manage")) return notFound();
  const { season: slug } = await ctx.params;
  const league = await currentLeague(db);
  if (!league) return notFound();
  const season = (await booksSeasons(db, league.id)).find(
    (s) => s.slug === slug,
  );
  if (!season) return notFound();
  const books = await seasonBooks(db, season);
  const lines = ledgerLines(books, league.timeZone);
  await recordAudit(db, {
    actorId: userId,
    action: "books.export",
    entityType: "season",
    entityId: season.id,
    after: { rows: lines.length },
  });
  return new Response(toCsv(LEDGER_COLUMNS, lines), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename([season.slug, "books"], "csv")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
