import { db } from "@/db/client";
import { booksFileOf } from "@/db/queries/books";
import { currentLeague } from "@/db/queries/seasons";
import { can } from "@/domain/authz/permissions";
import { type BooksFileId, parseId } from "@/domain/ids";
import { currentSubject } from "@/lib/auth/permission";
import { privateFileResponse } from "@/lib/books/store-file";

const notFound = () =>
  new Response("Not found.", {
    status: 404,
    headers: { "Cache-Control": "private, no-store" },
  });

/**
 * A receipt photo, permit document or insurance certificate, for the
 * league's owners and the operator only. There is no public address for
 * these files and nothing caches them; anyone else gets a 404.
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/app/books/files/[file]">,
) {
  const subject = await currentSubject();
  if (!can(subject, "books.manage")) return notFound();
  const { file } = await ctx.params;
  const id = parseId<BooksFileId>(file);
  const league = await currentLeague(db);
  if (!id || !league) return notFound();
  const found = await booksFileOf(db, league.id, id);
  if (!found) return notFound();
  return privateFileResponse({ ...found, name: `${found.kind}-${id.slice(0, 8)}` });
}
