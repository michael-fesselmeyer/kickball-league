import { db } from "@/db/client";
import { booksFileOf } from "@/db/queries/books";
import { can } from "@/domain/authz/permissions";
import { type BooksFileId, parseId } from "@/domain/ids";
import { currentSubject } from "@/lib/auth/permission";
import { privateFileResponse } from "@/lib/books/store-file";
import { activeLeague } from "@/lib/league/active";

const notFound = () =>
  new Response("Not found.", {
    status: 404,
    headers: { "Cache-Control": "private, no-store" },
  });

/**
 * A photo from a field's end-of-day check (issue #409), for the admins on
 * the command center. Only field photos are served here; never cached.
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/[lang]/app/admin/today/photo/[file]">,
) {
  const subject = await currentSubject();
  if (!can(subject, "season.manage")) return notFound();
  const id = parseId<BooksFileId>((await ctx.params).file);
  const league = await activeLeague();
  if (!id || !league) return notFound();
  const found = await booksFileOf(db, league.id, id);
  if (!found || found.kind !== "field_photo") return notFound();
  return privateFileResponse({ ...found, name: `field-${id.slice(0, 8)}` });
}
