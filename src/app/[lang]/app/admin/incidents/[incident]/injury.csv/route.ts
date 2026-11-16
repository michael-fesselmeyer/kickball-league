import { db } from "@/db/client";
import { exportInjury } from "@/db/queries/injury";
import { can } from "@/domain/authz/permissions";
import { injuryExportCsv } from "@/domain/discipline/injury";
import { exportFilename } from "@/domain/export/csv";
import { type IncidentId, parseId, type UserId } from "@/domain/ids";
import { currentSubject } from "@/lib/auth/permission";
import { allInLeague } from "@/lib/league/guard";

const text = (body: string, status: number) =>
  new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });

/**
 * An injury report for the insurance carrier, as a CSV that also shows the
 * dates of the league's insurance certificate (ADR 0064). Owners and
 * admins of the report's league only; a refusal is a plain 404. Every
 * download writes an audit row, and text cells are guarded against formula
 * injection (src/domain/export/csv.ts).
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/[lang]/app/admin/incidents/[incident]/injury.csv">,
): Promise<Response> {
  const subject = await currentSubject();
  const actorId = parseId<UserId>(subject.userId);
  if (actorId === null) return text("Sign in to download this file.", 401);
  if (!can(subject, "injury.read")) return text("Not found.", 404);
  const incidentId = parseId<IncidentId>((await ctx.params).incident);
  if (!incidentId) return text("Not found.", 404);
  if (!(await allInLeague(subject.leagueId, { incident: incidentId })))
    return text("Not found.", 404);
  const report = await exportInjury(db, { incidentId, actorId });
  if (!report) return text("Not found.", 404);
  return new Response(injuryExportCsv(report), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename(["injury-report", report.reportedOn], "csv")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
