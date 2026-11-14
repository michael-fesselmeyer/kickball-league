/**
 * Whether a season may appear on a public page (ADR 0049): the league's own
 * seasons once they leave draft. Private seasons never do.
 */
export function isPublicSeason(s: {
  status: string;
  visibility: "league" | "private";
}): boolean {
  return s.visibility === "league" && s.status !== "draft";
}
