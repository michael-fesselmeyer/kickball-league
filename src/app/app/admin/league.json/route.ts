import { db } from "@/db/client";
import { recordAudit } from "@/db/queries/audit";
import { leagueExport, siteSettings } from "@/db/queries/platform";
import { parseId, type UserId } from "@/domain/ids";
import { currentSubject } from "@/lib/auth/permission";
import { isCurrentOperator } from "@/lib/platform/site";

/**
 * The whole league as JSON: seasons, places, teams, rosters, games, scores
 * and payments. The operator and the league's owners can download it at any
 * time, paused or not, so the league's data is never held back.
 */
export async function GET(): Promise<Response> {
  const subject = await currentSubject();
  const userId = parseId<UserId>(subject.userId);
  const allowed =
    userId !== null &&
    (subject.globalRole === "owner" || isCurrentOperator(userId));
  if (!allowed) return new Response("Not found", { status: 404 });
  const site = await siteSettings(db);
  if (!site) return new Response("Not found", { status: 404 });
  const data = await leagueExport(db, site.leagueId);
  await recordAudit(db, {
    actorId: userId,
    action: "league.export",
    entityType: "league",
    entityId: site.leagueId,
  });
  const day = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="league-export-${day}.json"`,
      "cache-control": "no-store",
    },
  });
}
