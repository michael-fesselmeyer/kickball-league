import { db } from "@/db/client";
import { booksSeasons, requestSheetInputs } from "@/db/queries/books";
import { currentLeague } from "@/db/queries/seasons";
import { can } from "@/domain/authz/permissions";
import type { RequestRow } from "@/domain/books/request-sheet";
import { type Column, exportFilename, toCsv } from "@/domain/export/csv";
import { currentSubject } from "@/lib/auth/permission";
import { requestChoices, requestSheetFor, WEEKDAYS } from "../request";

const notFound = () =>
  new Response("Not found.", {
    status: 404,
    headers: { "Cache-Control": "private, no-store" },
  });

const COLUMNS: readonly Column<RequestRow>[] = [
  { header: "Date", value: (r) => r.date },
  {
    header: "Day",
    value: (r) => WEEKDAYS[new Date(`${r.date}T12:00:00Z`).getUTCDay()],
  },
  { header: "Field", value: (r) => r.field },
  { header: "Start", value: (r) => r.start },
  { header: "End", value: (r) => r.end },
  { header: "Hours", value: (r) => r.minutes / 60 },
  { header: "Games", value: (r) => r.games },
];

/** The "What to request" sheet as a CSV, with the screen's choices. */
export async function GET(
  request: Request,
  ctx: RouteContext<"/app/books/[season]/permits/request.csv">,
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
  const inputs = await requestSheetInputs(db, league.id, season.id);
  const url = new URL(request.url);
  const query = Object.fromEntries(
    [...new Set(url.searchParams.keys())].map((k) => {
      const values = url.searchParams.getAll(k);
      return [k, values.length === 1 ? values[0] : values];
    }),
  );
  const choices = requestChoices(query, {
    teams: inputs.teams,
    weekday: new Date(`${season.startsOn}T12:00:00Z`).getUTCDay(),
  });
  const sheet = requestSheetFor(choices, season, inputs);
  const rows = sheet.ok ? sheet.value.rows : [];
  return new Response(toCsv(COLUMNS, rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename([season.slug, "permit-request"], "csv")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
