import { z } from "zod";
import { bringBy } from "@/domain/equipment/equipment";
import { kickoff, shortDay } from "@/domain/schedule/format";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

/**
 * The evening before a game, for the person bringing a league kit to it
 * (src/db/queries/equipment.ts, queueGearReminders): which kit, where to get
 * it, and where and when it goes. Non-urgent: it can wait for quiet hours
 * to end, and the next morning is still in time.
 */
export const gearReminderPayload = z.object({
  kitName: z.string().min(1),
  /** "McCarren Park, Field 2". */
  place: z.string().min(1),
  /** The game's kickoff, as an ISO instant. */
  startsAt: z.string().datetime(),
  timeZone: z.string().min(1),
  /** "Aces vs Bees". */
  teams: z.string().min(1),
  /** Where the kit is when the reminder is queued. */
  from: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("holding") }),
    z.object({ kind: z.literal("on_its_way") }),
    z.object({ kind: z.literal("with"), name: z.string().min(1) }),
    z.object({ kind: z.literal("at_home"), homeLocation: z.string().min(1) }),
  ]),
});

export type GearReminderPayload = z.infer<typeof gearReminderPayload>;

export const gearReminderEmail = defineTemplate(
  gearReminderPayload,
  (p, ctx) => {
    const startsAt = new Date(p.startsAt);
    const day = shortDay(startsAt, p.timeZone);
    const by = kickoff(bringBy(startsAt), p.timeZone);
    const getIt =
      p.from.kind === "holding"
        ? `You have ${p.kitName}.`
        : p.from.kind === "on_its_way"
          ? `${p.kitName} is on its way to you: confirm it in the app when you have it.`
          : p.from.kind === "with"
            ? `${p.from.name} has ${p.kitName} right now; get it from them, and confirm in the app when they hand it over.`
            : `${p.kitName} is at ${p.from.homeLocation}; tap "I picked up ${p.kitName}" in the app when you have it.`;
    return renderEmail(
      {
        subject: `Bring ${p.kitName} to ${p.place} by ${by} on ${day}`,
        heading: `${p.kitName} for ${p.teams}`,
        paragraphs: [
          getIt,
          `Bring it to ${p.place} by ${by} on ${day}, half an hour before ${p.teams} kicks off.`,
          "If anything is missing from the kit, report it in the app so the league can restock it.",
        ],
        action: { label: "Open your gear", path: "/app#gear" },
        reason: "you're bringing league gear to this game",
      },
      ctx,
    );
  },
);
