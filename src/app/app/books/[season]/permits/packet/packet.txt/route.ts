import { db } from "@/db/client";
import { booksSeasons } from "@/db/queries/books";
import { currentLeague } from "@/db/queries/seasons";
import { can } from "@/domain/authz/permissions";
import { boroughName } from "@/domain/capacity/nearby";
import { exportFilename } from "@/domain/export/csv";
import { packetText } from "@/domain/permits/packet";
import { currentSubject } from "@/lib/auth/permission";
import { loadPacket } from "../load";

const notFound = () =>
  new Response("Not found.", {
    status: 404,
    headers: { "Cache-Control": "private, no-store" },
  });

/** The application packet as a text file, with the screen's choices. */
export async function GET(
  request: Request,
  ctx: RouteContext<"/app/books/[season]/permits/packet/packet.txt">,
) {
  const subject = await currentSubject();
  if (!can(subject, "books.manage")) return notFound();
  const { season: slug } = await ctx.params;
  const league = await currentLeague(db);
  if (!league) return notFound();
  const season = (await booksSeasons(db, league.id)).find(
    (s) => s.slug === slug,
  );
  if (!season) return notFound();
  const url = new URL(request.url);
  const query = Object.fromEntries(
    [...new Set(url.searchParams.keys())].map((k) => {
      const values = url.searchParams.getAll(k);
      return [k, values.length === 1 ? values[0] : values];
    }),
  );
  const { packet } = await loadPacket(league, season, query);
  return new Response(packetText(packet, boroughName), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename([season.slug, "permit-packet"], "txt")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
