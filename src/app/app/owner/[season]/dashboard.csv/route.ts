import { db } from "@/db/client";
import { recordAudit } from "@/db/queries/audit";
import { dashboardSeasons } from "@/db/queries/owner-dashboard";
import { currentLeague } from "@/db/queries/seasons";
import { can } from "@/domain/authz/permissions";
import { DASHBOARD_COLUMNS, dashboardLines } from "@/domain/dashboard/csv";
import { exportFilename, toCsv } from "@/domain/export/csv";
import { parseId, type UserId } from "@/domain/ids";
import { currentSubject } from "@/lib/auth/permission";
import { cachedDashboard } from "../../load";

const notFound = () =>
  new Response("Not found.", {
    status: 404,
    headers: { "Cache-Control": "private, no-store" },
  });

/**
 * The dashboard's numbers as a CSV: every season's membership and money,
 * and the chosen season's teams, events and sponsor check-ins. Counts and
 * totals only. Owners and the operator; each download is audited.
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/app/owner/[season]/dashboard.csv">,
) {
  const subject = await currentSubject();
  const userId = parseId<UserId>(subject.userId);
  if (!userId || !can(subject, "dashboard.view")) return notFound();
  const { season: slug } = await ctx.params;
  const league = await currentLeague(db);
  if (!league) return notFound();
  const season = (await dashboardSeasons(db, league.id)).find(
    (s) => s.slug === slug,
  );
  if (!season) return notFound();
  const { view } = await cachedDashboard(league.id, season);
  const lines = dashboardLines(view, season.name);
  await recordAudit(db, {
    actorId: userId,
    action: "dashboard.export",
    entityType: "season",
    entityId: season.id,
    after: { rows: lines.length },
  });
  return new Response(toCsv(DASHBOARD_COLUMNS, lines), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename([season.slug, "dashboard"], "csv")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
