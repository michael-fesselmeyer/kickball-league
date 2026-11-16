import { db } from "@/db/client";
import { fieldLayoutFile, onSetupShift } from "@/db/queries/field-layouts";
import { can } from "@/domain/authz/permissions";
import { type FieldId, parseId, type UserId } from "@/domain/ids";
import { currentSubject } from "@/lib/auth/permission";
import { privateFileResponse } from "@/lib/books/store-file";
import { activeLeagueId } from "@/lib/league/active";

const notFound = () =>
  new Response("Not found.", {
    status: 404,
    headers: { "Cache-Control": "private, no-store" },
  });

/**
 * A field's layout file, for the league's admins and for members on a
 * set-up shift. A game's ref and captains get theirs with the game, from
 * its permit page. Never cached by a CDN.
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/[lang]/app/fields/[field]/layout/file">,
) {
  const subject = await currentSubject();
  const fieldId = parseId<FieldId>((await ctx.params).field);
  const userId = parseId<UserId>(subject.userId);
  const leagueId = await activeLeagueId();
  if (!fieldId || !userId || !leagueId) return notFound();
  const allowed =
    can(subject, "season.manage") ||
    (await onSetupShift(db, userId, leagueId, new Date()));
  if (!allowed) return notFound();
  const file = await fieldLayoutFile(db, leagueId, fieldId);
  if (!file) return notFound();
  return privateFileResponse({ ...file, name: "field-layout" });
}
