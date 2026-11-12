import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  PAYMENT_COLUMNS,
  paymentsExport,
  recordExport,
  ROSTER_COLUMNS,
  rosterExport,
} from "@/db/queries/exports";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { team, teamSeason } from "@/db/schema/team";
import { can } from "@/domain/authz/permissions";
import { exportFilename, toCsv } from "@/domain/export/csv";
import { parseId, type TeamSeasonId, type UserId } from "@/domain/ids";
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
 * A roster or payments CSV for a season (admins) or one team (its captains,
 * and admins), as a download. `?team=<team season id>` picks the team.
 * Refusals are a plain 404, like the admin pages, so the files' existence is
 * not revealed. Every download writes an audit row.
 */
export async function csvExport(
  request: Request,
  slug: string,
  file: "roster" | "payments",
): Promise<Response> {
  const subject = await currentSubject();
  const userId = parseId<UserId>(subject.userId);
  if (userId === null) return text("Sign in to download this file.", 401);
  const season = await seasonBySlug(db, slug);
  if (!season) return text("Not found.", 404);

  const raw = new URL(request.url).searchParams.get("team");
  const teamSeasonId = raw === null ? null : parseId<TeamSeasonId>(raw);
  if (raw !== null && teamSeasonId === null) return text("Not found.", 404);
  const action = file === "roster" ? "roster.export" : "payments.export";
  if (!can(subject, action, teamSeasonId ? { teamSeasonId } : {}))
    return text("Not found.", 404);

  let teamName: string | null = null;
  if (teamSeasonId) {
    const [entry] = await db
      .select({ name: team.name })
      .from(teamSeason)
      .innerJoin(team, eq(teamSeason.teamId, team.id))
      .where(
        and(
          eq(teamSeason.id, teamSeasonId),
          eq(teamSeason.seasonId, season.id),
        ),
      );
    if (!entry) return text("Not found.", 404);
    teamName = entry.name;
  }

  const body =
    file === "roster"
      ? await rosterExport(db, season.id, teamSeasonId).then((rows) => ({
          csv: toCsv(ROSTER_COLUMNS, rows),
          rows: rows.length,
        }))
      : await paymentsExport(db, season.id, teamSeasonId).then((rows) => ({
          csv: toCsv(PAYMENT_COLUMNS, rows),
          rows: rows.length,
        }));
  await recordExport(db, {
    actorId: userId,
    action,
    seasonId: season.id,
    teamSeasonId,
    rows: body.rows,
  });
  const name = exportFilename(
    [season.slug, ...(teamName ? [teamName] : []), file],
    "csv",
  );
  return new Response(body.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
