import { z } from "zod";
import { kickoff, shortDay } from "@/domain/schedule/format";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

/**
 * The start-on-time nudge (issue #467): two hours before a game whose end
 * of play leaves no room for a late start, its captains and ref hear when
 * first pitch is, when play must end and why. Non-urgent: it respects quiet
 * hours and the day's cap like any reminder.
 */
export const startOnTimePayload = z.object({
  gameId: z.uuid(),
  /** "Aces vs Bees". */
  teams: z.string().min(1),
  /** "McCarren Park, Field 2". */
  place: z.string().min(1),
  /** First pitch, as an ISO instant. */
  startsAt: z.string().datetime(),
  /** When play must end, as an ISO instant. */
  endsAt: z.string().datetime(),
  endReason: z.enum(["daylight", "field_time"]),
  /** Sunset, for a daylight end. */
  sunsetAt: z.string().datetime().nullable(),
  timeZone: z.string().min(1),
  role: z.enum(["referee", "captain"]),
});

export type StartOnTimePayload = z.infer<typeof startOnTimePayload>;

export const startOnTimeEmail = defineTemplate(startOnTimePayload, (p, ctx) => {
  const startsAt = new Date(p.startsAt);
  const day = shortDay(startsAt, p.timeZone);
  const first = kickoff(startsAt, p.timeZone);
  const end = kickoff(new Date(p.endsAt), p.timeZone);
  const why =
    p.endReason === "daylight"
      ? `Sunset is at ${p.sunsetAt ? kickoff(new Date(p.sunsetAt), p.timeZone) : "dusk"}, so play must end by ${end} to finish in the light.`
      : `The field must be clear by ${end}, so play ends then.`;
  return renderEmail(
    {
      subject: `First pitch ${first} on ${day}: play ends by ${end}`,
      heading: `${p.teams}: start on time`,
      paragraphs: [
        `${p.teams} plays at ${p.place} on ${day}, first pitch at ${first}. ${why}`,
        "Every minute late comes off the game. If time runs out, the score stands at the last full inning, under your division's rules.",
        p.role === "referee"
          ? `As the ref, tap "First pitch" on the live score screen when play starts, so the clock counts down for both teams.`
          : "Get your team there 15 minutes early, warmed up and with a kicking order ready.",
      ],
      action: { label: "Open the game", path: `/app/games/${p.gameId}/live` },
      reason:
        p.role === "referee"
          ? "you're refereeing this game"
          : "you captain one of the teams in this game",
    },
    ctx,
  );
});
