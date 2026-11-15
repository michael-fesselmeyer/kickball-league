import { db } from "@/db/client";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { recordShirtExport, shirtOrderBoard } from "@/db/queries/shirt-order";
import { can } from "@/domain/authz/permissions";
import { exportFilename, toCsv } from "@/domain/export/csv";
import { parseId, type UserId } from "@/domain/ids";
import { vendorColumns, vendorRows } from "@/domain/shirts/order";
import { currentSubject } from "@/lib/auth/permission";

const text = (body: string, status: number) =>
  new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });

/**
 * The season's shirt order for the vendor: season shirts and paid
 * replacement jerseys by team, color and size, as counts. Player names
 * only with `?names=1`, for packing by team. Admins only; a refusal is a
 * plain 404. Every download writes an audit row, and text cells are guarded
 * against formula injection (src/domain/export/csv.ts).
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/app/admin/seasons/[season]/shirt-order/order.csv">,
): Promise<Response> {
  const subject = await currentSubject();
  const userId = parseId<UserId>(subject.userId);
  if (userId === null) return text("Sign in to download this file.", 401);
  if (!can(subject, "shirts.manage")) return text("Not found.", 404);
  const season = await seasonBySlug(db, (await ctx.params).season);
  if (!season) return text("Not found.", 404);
  const names = new URL(request.url).searchParams.get("names") === "1";
  const board = await shirtOrderBoard(db, season.id);
  const rows = vendorRows(
    {
      teams: board.teams,
      unplaced: board.freeAgents,
      jerseys: board.jerseys,
      offered: board.settings.sizes,
    },
    names,
  );
  await recordShirtExport(db, {
    actorId: userId,
    seasonId: season.id,
    rows: rows.length,
    names,
  });
  const name = exportFilename(
    [season.slug, "shirt-order", ...(names ? ["with-names"] : [])],
    "csv",
  );
  return new Response(toCsv(vendorColumns(names), rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
