import { z } from "zod";
import { fill } from "@/i18n/catalog";
import { bringBy } from "@/domain/equipment/equipment";
import { kickoff, shortDay } from "@/domain/schedule/format";
import { defineTemplate } from "./define";
import { emailWords, renderEmail } from "./layout";

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
    const { locale, w: all } = emailWords(ctx);
    const w = all.gear;
    const startsAt = new Date(p.startsAt);
    const day = shortDay(startsAt, p.timeZone, locale);
    const by = kickoff(bringBy(startsAt), p.timeZone, locale);
    const kit = { kit: p.kitName };
    const getIt =
      p.from.kind === "holding"
        ? fill(w.holding, kit)
        : p.from.kind === "on_its_way"
          ? fill(w.onItsWay, kit)
          : p.from.kind === "with"
            ? fill(w.with, { ...kit, name: p.from.name })
            : fill(w.atHome, { ...kit, place: p.from.homeLocation });
    const vars = { ...kit, place: p.place, by, day, teams: p.teams };
    return renderEmail(
      {
        subject: fill(w.subject, vars),
        heading: fill(w.heading, vars),
        paragraphs: [getIt, fill(w.bring, vars), w.missing],
        action: { label: w.action, path: "/app#gear" },
        reason: w.reason,
      },
      ctx,
    );
  },
);
