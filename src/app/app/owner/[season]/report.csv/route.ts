import { db } from "@/db/client";
import { recordAudit } from "@/db/queries/audit";
import { can } from "@/domain/authz/permissions";
import { reportLines } from "@/domain/dashboard/report-card";
import { reportColumns, reportCsvLines } from "@/domain/dashboard/report-csv";
import { exportFilename, toCsv } from "@/domain/export/csv";
import { parseId, type UserId } from "@/domain/ids";
import { currentSubject } from "@/lib/auth/permission";
import { loadReport } from "../../report";

const notFound = () =>
  new Response("Not found.", {
    status: 404,
    headers: { "Cache-Control": "private, no-store" },
  });

/**
 * The season report card as a CSV, money included: owners and the
 * operator only, and each download is audited.
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/app/owner/[season]/report.csv">,
) {
  const subject = await currentSubject();
  const userId = parseId<UserId>(subject.userId);
  if (!userId || !can(subject, "dashboard.view")) return notFound();
  const { season: slug } = await ctx.params;
  const report = await loadReport(slug);
  const previousName = report.previous?.name ?? null;
  const lines = reportCsvLines(
    reportLines(report.current, report.previous),
    previousName,
  );
  await recordAudit(db, {
    actorId: userId,
    action: "report_card.export",
    entityType: "season",
    entityId: report.season.id,
    after: { rows: lines.length },
  });
  return new Response(
    toCsv(reportColumns(report.current.name, previousName), lines),
    {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${exportFilename([slug, "report-card"], "csv")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
