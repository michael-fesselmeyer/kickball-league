import { currentLeague } from "@/db/queries/seasons";
import { db } from "@/db/client";
import { can } from "@/domain/authz/permissions";
import { currentSubject } from "@/lib/auth/permission";
import { loadCommand, parseDay } from "../load";

const headers = { "Cache-Control": "private, no-store" };

/**
 * The command center's state as JSON, which the open screen asks for every
 * ten seconds while it is visible (docs/architecture.md, section 3). Admins
 * only; anyone else gets a 404, as the page does.
 */
export async function GET(request: Request) {
  const subject = await currentSubject();
  if (subject.userId === null || !can(subject, "season.manage"))
    return Response.json({ error: "Not found." }, { status: 404, headers });
  const league = await currentLeague(db);
  if (!league)
    return Response.json({ error: "Not found." }, { status: 404, headers });
  const day = parseDay(new URL(request.url).searchParams.get("date"));
  const found = await loadCommand(league.id, new Date(), day);
  return Response.json(found?.state ?? null, { headers });
}
