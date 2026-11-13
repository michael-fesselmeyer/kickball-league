import { z } from "zod";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

/** The event a notice is about, as the league writes it. */
export const eventNoticePayload = z.object({
  kind: z.enum(["spot_opened", "cancelled", "announced", "updated"]),
  title: z.string().min(1),
  slug: z.string().min(1),
  /** "Fri, Nov 20, 7:00 – 10:00 PM". */
  when: z.string().min(1),
  place: z.string().nullable(),
  /** The event's external invite (Partiful or any https page), if any. */
  inviteUrl: z.string().nullable().optional(),
  /** Public events link to their public page; others to the app's. */
  publicPage: z.boolean().optional(),
});

export type EventNoticePayload = z.infer<typeof eventNoticePayload>;

/** The invite's site, for its line: "partiful.com". */
const hostOf = (url: string) => new URL(url).hostname.replace(/^www\./, "");

/**
 * A waitlisted player got a spot, an event they RSVP'd to was called off,
 * or an admin told an event's audience about it or about a change.
 */
export const eventNoticeEmail = defineTemplate(eventNoticePayload, (p, ctx) => {
  const where = p.place ? `${p.when}, ${p.place}` : p.when;
  if (p.kind === "announced" || p.kind === "updated") {
    const invite = p.inviteUrl
      ? [`RSVP on ${hostOf(p.inviteUrl)}: ${p.inviteUrl}`]
      : [];
    return renderEmail(
      {
        subject:
          p.kind === "announced"
            ? `New event: ${p.title}`
            : `Update: ${p.title}`,
        heading:
          p.kind === "announced"
            ? `You're invited: ${p.title}`
            : `${p.title} has changed`,
        paragraphs: [
          p.kind === "announced"
            ? `${p.title} is on: ${where}.`
            : `The league changed the details of ${p.title}. It's now ${where}.`,
          ...invite,
        ],
        action: {
          label: "See the event",
          path: p.publicPage ? `/events/${p.slug}` : `/app/events/${p.slug}`,
        },
        reason: "the league posted an event for you",
      },
      ctx,
    );
  }
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
