import { z } from "zod";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

const about = {
  seasonName: z.string().min(1),
  seasonSlug: z.string().min(1),
  team: z.string().min(1),
};

/**
 * The season-end leadership check-in (ADR 0091). Kind `leadership_check_in`
 * (non-urgent) for the whole roster: it opened, a teammate suggested you,
 * the ballot opened, and the outcome. Kind `leadership_result` (urgent) for
 * the captain alone: the result, before the team hears it. No message ever
 * names who suggested whom or how anyone voted.
 */
export const leadershipPayload = z.discriminatedUnion("kind", [
  z.object({
    ...about,
    kind: z.literal("opened"),
    /** "Sunday, November 22", in the league's time zone. */
    closes: z.string().min(1),
  }),
  z.object({
    ...about,
    kind: z.literal("suggested"),
    role: z.enum(["captain", "co_captain"]),
  }),
  z.object({ ...about, kind: z.literal("ballot"), closes: z.string().min(1) }),
  z.object({
    ...about,
    kind: z.literal("outcome"),
    outcome: z.enum([
      "no_quorum",
      "no_candidates",
      "no_majority",
      "captain_stays",
      "new_captain",
      "winner_left",
      "closed_by_league",
    ]),
    /** The teammate chosen, as "Jo S.", for `new_captain`. */
    elected: z.string().min(1).optional(),
    /** For `new_captain`: whether they take over now or next season. */
    when: z.enum(["now", "next_season"]).optional(),
  }),
  z.object({
    ...about,
    kind: z.literal("result"),
    elected: z.string().min(1),
    /** The last day to choose, as "Sunday, November 22". */
    decideBy: z.string().min(1),
    /** The captain said they'd hand over, so that is what happens by default. */
    steppingDown: z.boolean(),
  }),
]);

export type LeadershipPayload = z.infer<typeof leadershipPayload>;

const OUTCOME = {
  no_quorum:
    "Not quite enough of the team checked in this time, so nothing changes. Thanks to everyone who did.",
  no_candidates:
    "Everyone's happy with how the team is led, so nothing changes. Thanks for checking in.",
  no_majority:
    "The ballot didn't land on a clear choice, so nothing changes this time. Thanks for voting.",
  captain_stays:
    "The team chose to keep its captain. Thanks for voting, and here's to next season.",
  winner_left:
    "The teammate the ballot chose has left the team, so nothing changes this time.",
  closed_by_league:
    "The league closed this check-in with no change. Your captain can still hand over as usual.",
} as const;

export const leadershipEmail = defineTemplate(leadershipPayload, (p, ctx) => {
  const page = { path: `/app/seasons/${p.seasonSlug}/team/leadership` };
  const reason = `you play for ${p.team}`;
  switch (p.kind) {
    case "opened":
      return renderEmail(
        {
          subject: `Who'd you like to help lead ${p.team} next season?`,
          heading: "Leadership check-in",
          paragraphs: [
            `${p.seasonName} is wrapping up, so every team gets a quick, private check-in about next season.`,
            "Put yourself forward, suggest a teammate to help as co-captain or captain, or just say things are good as they are. Nobody sees your answer.",
            `It's open until ${p.closes}.`,
          ],
          action: { label: "Check in", ...page },
          reason,
        },
        ctx,
      );
    case "suggested":
      return renderEmail(
        {
          subject:
            p.role === "captain"
              ? `A teammate thinks you'd make a great captain of ${p.team}`
              : `A teammate would love your help leading ${p.team}`,
          heading: "You've been suggested",
          paragraphs: [
            p.role === "captain"
              ? `In ${p.team}'s season-end check-in, a teammate suggested you as next season's captain.`
              : `In ${p.team}'s season-end check-in, a teammate suggested you as a co-captain.`,
            "Would you like to stand? Saying no is completely fine, and only you see this.",
          ],
          action: { label: "Answer", ...page },
          reason,
        },
        ctx,
      );
    case "ballot":
      return renderEmail(
        {
          subject: `Vote for ${p.team}'s captain next season`,
          heading: "The secret ballot is open",
          paragraphs: [
            `Enough of ${p.team} checked in, and teammates are standing for captain, so there's a short secret ballot.`,
            `Nobody sees how you vote, not the captain, teammates or the league. Voting closes ${p.closes}.`,
          ],
          action: { label: "Vote", ...page },
          reason,
        },
        ctx,
      );
    case "outcome":
      return renderEmail(
        {
          subject: `${p.team}'s leadership check-in is done`,
          heading: "Check-in done",
          paragraphs: [
            p.outcome === "new_captain" && p.elected
              ? p.when === "now"
                ? `The team chose ${p.elected} as captain, and they're taking over now. Thanks for voting.`
                : `The team chose ${p.elected} as captain for next season. Until then they help lead as a co-captain. Thanks for voting.`
              : OUTCOME[
                  p.outcome === "new_captain" ? "no_majority" : p.outcome
                ],
          ],
          action: { label: "See your team", ...page },
          reason,
        },
        ctx,
      );
    case "result":
      return renderEmail(
        {
          subject: `${p.team}'s leadership check-in: you hear first`,
          heading: "Your team's result, just for you",
          paragraphs: [
            `The team's secret ballot chose ${p.elected} to captain ${p.team} next season. You're hearing it first; the team hears once you've chosen.`,
            "You can hand over now, or stay on as captain for the rest of this season with them as co-captain, taking over next season.",
            p.steppingDown
              ? `As you said you'd hand over, they're offered the captaincy on ${p.decideBy} if you don't choose first.`
              : `If you'd rather not choose, the second happens on ${p.decideBy}.`,
          ],
          action: { label: "Choose", ...page },
          reason: `you captain ${p.team}`,
        },
        ctx,
      );
  }
});
