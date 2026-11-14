import { z } from "zod";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

/**
 * The reminder each volunteer gets the day before their shift: what the
 * job is, when and where. Times are written out when the reminder is
 * queued, in the league's time zone.
 */
export const volunteerReminderPayload = z.object({
  /** Such as "Setup". */
  role: z.string().min(1),
  /** Such as "Fall 2026 game day" or an event's title. */
  occasion: z.string().min(1),
  /** Such as "Tuesday, October 20, 6:00 PM to 6:45 PM". */
  when: z.string().min(1),
  place: z.string().nullable(),
  notes: z.string(),
});

export type VolunteerReminderPayload = z.infer<typeof volunteerReminderPayload>;

export const volunteerReminderEmail = defineTemplate(
  volunteerReminderPayload,
  (p, ctx) =>
    renderEmail(
      {
        subject: `Tomorrow: your ${p.role.toLowerCase()} shift`,
        heading: "Thanks for volunteering!",
        paragraphs: [
          `You're down for ${p.role.toLowerCase()} at ${p.occasion}: ${p.when}${p.place ? `, ${p.place}` : ""}.`,
          ...(p.notes ? [p.notes] : []),
          "Can't make it after all? Drop the shift in the app so someone else can take it.",
        ],
        action: { label: "See your shifts", path: "/app/volunteer" },
        reason: "you signed up for a volunteer shift",
      },
      ctx,
    ),
);
