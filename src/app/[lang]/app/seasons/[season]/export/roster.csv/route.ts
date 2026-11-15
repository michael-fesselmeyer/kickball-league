import { csvExport } from "../csv-export";

/** The season's roster, or one team's with `?team=`, as a CSV download. */
export async function GET(
  request: Request,
  ctx: RouteContext<"/app/seasons/[season]/export/roster.csv">,
) {
  const { season } = await ctx.params;
  return csvExport(request, season, "roster");
}
