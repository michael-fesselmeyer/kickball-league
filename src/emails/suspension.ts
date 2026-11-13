import { z } from "zod";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

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

const LASTS: Record<z.infer<typeof suspensionPayload>["scope"], string> = {
  games:
    "It counts down as your team's games become final, and ends on its own once they are played.",
  season: "It ends when the season ends.",
  permanent: "It lasts until the league lifts it.",
};

export const suspensionEmail = defineTemplate(suspensionPayload, (p, ctx) =>
  renderEmail(
    {
      subject: `You're suspended: ${p.length}`,
      heading: "You're suspended",
      paragraphs: [
        p.scope === "permanent"
          ? `After an incident report, ${p.leagueName} has banned you from playing, permanently.`
          : `After an incident report, ${p.leagueName} has suspended you for ${p.length} in ${p.seasonName}.`,
        LASTS[p.scope],
        "While you're suspended you can't RSVP that you're in for a game, claim a sub spot or be placed on a team from the free-agent pool. Your captain sees that you're suspended, not why.",
        p.leagueEmail
          ? `To appeal, reply to this email or write to ${p.leagueEmail}, and say what you'd like the league to know.`
          : "To appeal, reply to this email and say what you'd like the league to know.",
      ],
      action: { label: "Open the app", path: "/app" },
      reason: "the league suspended you after an incident report",
    },
    ctx,
  ),
);
