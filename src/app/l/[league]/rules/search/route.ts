import { createHash } from "node:crypto";
import { db } from "@/db/client";
import { consumeRateLimit } from "@/db/queries/rate-limit";
import { rulebookVisibility, searchSections } from "@/db/queries/rules";
import { loadSubject } from "@/db/queries/subject";
import { parseId, type UserId } from "@/domain/ids";
import {
  canReadRulebook,
  rulesMatching,
  searchTerms,
} from "@/domain/rules/rulebook";
import { currentAuthSession } from "@/lib/auth/permission";
import { cachedLeague } from "@/lib/league/public";

/** A person may search this often in a minute; the free database has limits. */
const SEARCHES_PER_MINUTE = 40;

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });

/**
 * The rulebook's search (ADR 0066): Postgres full-text search over the
 * league's sections, then the rules in each that hold the words. Answers
 * only for who may read the rulebook right now, so a league that turns it
 * back to owners only stops answering at once. The page itself is static;
 * this is the one request a search makes.
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/l/[league]/rules/search">,
): Promise<Response> {
  const league = await cachedLeague((await ctx.params).league);
  if (!league) return json({ results: [] }, 404);
  const visibility = await rulebookVisibility(db, league.id);
  if (visibility !== "public") {
    const session = await currentAuthSession();
    const userId = parseId<UserId>(session?.user.id);
    const subject = await loadSubject(db, userId, league.id);
    if (!canReadRulebook(visibility, subject.globalRole))
      return json({ results: [] }, 403);
  }
  const network = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")[0]
    ?.trim();
  const key = createHash("sha256")
    .update(`${league.id}:${network ?? ""}`)
    .digest("hex")
    .slice(0, 32);
  const allowed = await consumeRateLimit(
    db,
    `rules-search:${key}`,
    { windowSeconds: 60, max: SEARCHES_PER_MINUTE },
    new Date(),
  );
  if (!allowed) return json({ results: [] }, 429);

  const terms = searchTerms(new URL(request.url).searchParams.get("q") ?? "");
  const rows = await searchSections(db, league.id, terms);
  return json({
    results: rows.map((r) => ({
      slug: r.slug,
      title: r.title,
      hits: rulesMatching(r.slug, r.body, terms),
    })),
  });
}
