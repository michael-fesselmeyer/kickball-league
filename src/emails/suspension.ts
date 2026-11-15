import { z } from "zod";
import { fill } from "@/i18n/catalog";
import { defineTemplate } from "./define";
import { emailWords, renderEmail } from "./layout";

/**
 * The one email a suspended player gets: how long, what it means, and how
 * to appeal. It never says who reported the incident.
 */
export const suspensionPayload = z.object({
  seasonName: z.string().min(1),
  /** "1 game", "the rest of the season", "permanently". */
  length: z.string().min(1),
  scope: z.enum(["games", "season", "permanent"]),
  leagueName: z.string().min(1),
  leagueEmail: z.string().nullable(),
});

export const suspensionEmail = defineTemplate(suspensionPayload, (p, ctx) => {
  const { w: all } = emailWords(ctx);
  const w = all.suspension;
  const vars = {
    length: p.length,
    league: p.leagueName,
    season: p.seasonName,
    email: p.leagueEmail ?? "",
  };
  const lasts = {
    games: w.lastsGames,
    season: w.lastsSeason,
    permanent: w.lastsPermanent,
  }[p.scope];
  return renderEmail(
    {
      subject: fill(w.subject, vars),
      heading: w.heading,
      paragraphs: [
        fill(p.scope === "permanent" ? w.banned : w.suspended, vars),
        lasts,
        w.meaning,
        p.leagueEmail ? fill(w.appealTo, vars) : w.appeal,
      ],
      action: { label: all.common.openApp, path: "/app" },
      reason: w.reason,
    },
    ctx,
  );
});
