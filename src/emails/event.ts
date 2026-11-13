import { z } from "zod";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

/** The event a notice is about, as the league writes it. */
export const eventNoticePayload = z.object({
  kind: z.enum(["spot_opened", "cancelled"]),
  title: z.string().min(1),
  slug: z.string().min(1),
  /** "Fri, Nov 20, 7:00 – 10:00 PM". */
  when: z.string().min(1),
  place: z.string().nullable(),
});

export type EventNoticePayload = z.infer<typeof eventNoticePayload>;

/** A waitlisted player got a spot, or an event they RSVP'd to was called off. */
export const eventNoticeEmail = defineTemplate(eventNoticePayload, (p, ctx) => {
  const where = p.place ? `${p.when}, ${p.place}` : p.when;
  return p.kind === "spot_opened"
    ? renderEmail(
        {
          subject: `You're in: ${p.title}`,
          heading: `A spot opened up for ${p.title}`,
          paragraphs: [
            `You were on the waitlist for ${p.title} (${where}), and now you have a spot.`,
            "Plans changed? Drop your spot on the event page so the next person on the list gets it.",
          ],
          action: { label: "See the event", path: `/app/events/${p.slug}` },
          reason: "you joined this event's waitlist",
        },
        ctx,
      )
    : renderEmail(
        {
          subject: `Called off: ${p.title}`,
          heading: `${p.title} is called off`,
          paragraphs: [
            `The league called off ${p.title} (${where}). Sorry about that. Your RSVP is cleared and there's nothing you need to do.`,
          ],
          action: { label: "See other events", path: "/events" },
          reason: "you RSVP'd to this event",
        },
        ctx,
      );
});
