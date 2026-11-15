import { z } from "zod";
import { fill } from "@/i18n/catalog";
import { defineTemplate } from "./define";
import { emailWords, renderEmail } from "./layout";

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
  (p, ctx) => {
    const w = emailWords(ctx).w.volunteer;
    const vars = {
      role: p.role.toLowerCase(),
      occasion: p.occasion,
      when: p.when,
      place: p.place ?? "",
    };
    return renderEmail(
      {
        subject: fill(w.subject, vars),
        heading: w.heading,
        paragraphs: [
          fill(p.place ? w.leadAt : w.lead, vars),
          ...(p.notes ? [p.notes] : []),
          w.drop,
        ],
        action: { label: w.action, path: "/app/volunteer" },
        reason: w.reason,
      },
      ctx,
    );
  },
);
