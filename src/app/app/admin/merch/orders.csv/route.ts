import { db } from "@/db/client";
import {
  merchOrders,
  PRINTER_COLUMNS,
  recordMerchExport,
} from "@/db/queries/merch";
import { currentLeague } from "@/db/queries/seasons";
import { can } from "@/domain/authz/permissions";
import { exportFilename, toCsv } from "@/domain/export/csv";
import { parseId, type UserId } from "@/domain/ids";
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
 * Every paid merch order not yet fulfilled, as a CSV for the printer: one
 * row per order, by item, size and team, with the team color for a
 * replacement jersey. Admins only; a refusal is a plain 404. Every
 * download writes an audit row. Text cells are guarded against formula
 * injection (src/domain/export/csv.ts).
 */
export async function GET(): Promise<Response> {
  const subject = await currentSubject();
  const userId = parseId<UserId>(subject.userId);
  if (userId === null) return text("Sign in to download this file.", 401);
  if (!can(subject, "merch.manage")) return text("Not found.", 404);
  const lg = await currentLeague(db);
  if (!lg) return text("Not found.", 404);
  const rows = await merchOrders(db, lg.id, { statuses: ["paid"] });
  await recordMerchExport(db, {
    actorId: userId,
    leagueId: lg.id,
    rows: rows.length,
  });
  return new Response(toCsv(PRINTER_COLUMNS, rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename(["merch", "orders"], "csv")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
