import { z } from "zod";
import { fill } from "@/i18n/catalog";
import { inviteSite } from "@/domain/events/audience";
import { defineTemplate } from "./define";
import { emailWords, publicPath, renderEmail } from "./layout";

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

/**
 * A waitlisted player got a spot, an event they RSVP'd to was called off,
 * or an admin told an event's audience about it or about a change.
 */
export const eventNoticeEmail = defineTemplate(eventNoticePayload, (p, ctx) => {
  const { w: all } = emailWords(ctx);
  const w = all.event;
  const where = p.place ? `${p.when}, ${p.place}` : p.when;
  const vars = { title: p.title, where };
  if (p.kind === "announced" || p.kind === "updated") {
    const invite = p.inviteUrl
      ? [fill(w.rsvpOn, { site: inviteSite(p.inviteUrl), url: p.inviteUrl })]
      : [];
    const announced = p.kind === "announced";
    return renderEmail(
      {
        subject: fill(announced ? w.announcedSubject : w.updatedSubject, vars),
        heading: fill(announced ? w.announcedHeading : w.updatedHeading, vars),
        paragraphs: [
          fill(announced ? w.announcedLead : w.updatedLead, vars),
          ...invite,
        ],
        action: {
          label: all.common.seeEvent,
          path: p.publicPage
            ? publicPath(ctx, `/events/${p.slug}`)
            : `/app/events/${p.slug}`,
        },
        reason: w.postedReason,
      },
      ctx,
    );
  }
  return p.kind === "spot_opened"
    ? renderEmail(
        {
          subject: fill(w.spotSubject, vars),
          heading: fill(w.spotHeading, vars),
          paragraphs: [fill(w.spotLead, vars), w.spotDrop],
          action: { label: all.common.seeEvent, path: `/app/events/${p.slug}` },
          reason: w.waitlistReason,
        },
        ctx,
      )
    : renderEmail(
        {
          subject: fill(w.offSubject, vars),
          heading: fill(w.offHeading, vars),
          paragraphs: [fill(w.offLead, vars)],
          action: { label: w.otherEvents, path: publicPath(ctx, "/events") },
          reason: w.rsvpReason,
        },
        ctx,
      );
});
