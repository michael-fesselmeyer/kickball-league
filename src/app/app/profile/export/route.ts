import { db } from "@/db/client";
import { personalData } from "@/db/queries/account";
import { can } from "@/domain/authz/permissions";
import { exportFilename } from "@/domain/export/csv";
import { parseId, type UserId } from "@/domain/ids";
import { currentSubject } from "@/lib/auth/permission";

/** The signed-in person's own data, as a JSON download. */
export async function GET() {
  const subject = await currentSubject();
  const userId = parseId<UserId>(subject.userId);
  if (
    userId === null ||
    !can(subject, "data.export_or_delete", { targetUserId: userId })
  )
    return new Response("Sign in to download your data.", {
      status: 401,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "private, no-store",
      },
    });
  const now = new Date();
  const data = await personalData(db, userId, now);
  const name = exportFilename(
    ["kickball-league", "my-data", now.toISOString().slice(0, 10)],
    "json",
  );
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
