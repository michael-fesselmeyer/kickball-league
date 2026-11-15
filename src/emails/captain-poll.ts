import { z } from "zod";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

/**
 * A quick poll for captains (ADR 0063): the invitation when an admin opens
 * it, and a reminder to a team that has not voted as it nears closing.
 * Non-urgent, so it waits out quiet hours and counts toward the daily cap.
 */
export const captainPollPayload = z.object({
  kind: z.enum(["new", "reminder"]),
  question: z.string().min(1),
  seasonName: z.string().min(1),
  /** The teams this person answers for, such as "Aces" or "Aces and Bees". */
  teams: z.string().min(1),
  /** Such as "Thursday, March 4 at 9:00 PM". */
  closes: z.string().min(1),
});

export type CaptainPollPayload = z.infer<typeof captainPollPayload>;

export const captainPollEmail = defineTemplate(captainPollPayload, (p, ctx) =>
  renderEmail(
    {
      subject:
        p.kind === "reminder"
          ? `Your vote is still needed: ${p.question}`
          : `Captains' poll: ${p.question}`,
      heading: p.question,
      paragraphs: [
        p.kind === "reminder"
          ? `${p.teams} hasn't voted in this ${p.seasonName} captains' poll yet. It closes ${p.closes}.`
          : `The league has a quick question for ${p.seasonName} captains. Each team gets one vote, for ${p.teams}, and you can change it until ${p.closes}.`,
      ],
      action: { label: "Vote now", path: "/app/polls" },
      reason: "you captain a team this season",
    },
    ctx,
  ),
);
