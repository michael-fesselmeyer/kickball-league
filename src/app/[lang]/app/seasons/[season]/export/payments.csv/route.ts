import { csvExport } from "../csv-export";

/** The season's payments, or one team's with `?team=`, as a CSV download. */
export async function GET(
  request: Request,
  ctx: RouteContext<"/app/seasons/[season]/export/payments.csv">,
) {
  const { season } = await ctx.params;
  return csvExport(request, season, "payments");
}
