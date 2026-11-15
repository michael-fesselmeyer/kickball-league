import { z } from "zod";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

/**
 * Reminds a task's owner about a season ops checklist task (ADR 0061): a
 * few days before it is due, and once when it is overdue. A task with no
 * owner reminds the league's owners. Non-urgent, so it waits out quiet
 * hours and counts toward the daily cap.
 */
export const checklistReminderPayload = z.object({
  kind: z.enum(["soon", "overdue"]),
  title: z.string().min(1),
  notes: z.string(),
  seasonName: z.string().min(1),
  seasonSlug: z.string().min(1),
  /** Such as "Due in 3 days" or "2 days overdue". */
  due: z.string().min(1),
  /** Such as "Saturday, March 20". */
  dueOn: z.string().min(1),
  /** The task has no owner, so it went to the owners. */
  unassigned: z.boolean(),
});

export type ChecklistReminderPayload = z.infer<typeof checklistReminderPayload>;

export const checklistReminderEmail = defineTemplate(
  checklistReminderPayload,
  (p, ctx) =>
    renderEmail(
      {
        subject:
          p.kind === "overdue" ? `Overdue: ${p.title}` : `${p.due}: ${p.title}`,
        heading: p.title,
        paragraphs: [
          `${p.due} (${p.dueOn}) on the ${p.seasonName} checklist.`,
          ...(p.notes ? [p.notes] : []),
          p.unassigned
            ? "Nobody has taken it yet. Pick an owner, or tick it off once it's done."
            : "Tick it off once it's done, or hand it to someone else.",
        ],
        action: {
          label: "Open the checklist",
          path: `/app/admin/seasons/${p.seasonSlug}/checklist`,
        },
        reason: p.unassigned
          ? "you are an owner of the league"
          : "you own a task on the season checklist",
      },
      ctx,
    ),
);
