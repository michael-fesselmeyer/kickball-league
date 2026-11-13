import { db } from "@/db/client";
import { memberPhotoFile } from "@/db/queries/member-photos";
import { currentLeague } from "@/db/queries/seasons";
import { can } from "@/domain/authz/permissions";
import { type MemberPhotoId, parseId } from "@/domain/ids";
import { currentSubject } from "@/lib/auth/permission";
import { imageResponse, notFound } from "@/lib/social/image-response";

/**
 * Any stored member photo, waiting ones included: for its uploader, and for
 * admins reviewing it (ADR 0035). `?download` saves it as a file, the copy
 * an admin reposts on Instagram. Everyone else gets 404.
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/app/photos/[photo]">,
): Promise<Response> {
  const id = parseId<MemberPhotoId>((await ctx.params).photo);
  const [subject, photo, league] = await Promise.all([
    currentSubject(),
    id ? memberPhotoFile(db, id) : null,
    currentLeague(db),
  ]);
  if (!photo || !subject.userId) return notFound();
  const mine = photo.uploaderId === subject.userId;
  const reviewer =
    can(subject, "photos.manage") && photo.leagueId === league?.id;
  if (!mine && !reviewer) return notFound();
  const response = imageResponse(photo, "private, no-store");
  if (new URL(request.url).searchParams.has("download")) {
    const day = photo.createdAt.toISOString().slice(0, 10);
    response.headers.set(
      "Content-Disposition",
      `attachment; filename="league-photo-${day}-${photo.sha256.slice(0, 8)}.jpg"`,
    );
  }
  return response;
}
