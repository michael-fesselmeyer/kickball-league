import { z } from "zod";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

export const emailBudgetPayload = z.object({
  /** Urgent emails that could not go today. */
  waiting: z.number().int().positive(),
  /** When the quota resets, in the league's time: "Fri 7:00 PM". */
  resumes: z.string().min(1),
  daily: z.number().int().positive(),
  monthly: z.number().int().positive(),
});

/**
 * Tells an admin that today's email quota is used up and urgent email is
 * waiting for tomorrow. Pushes still went out.
 */
export const emailBudgetEmail = defineTemplate(emailBudgetPayload, (p, ctx) =>
  renderEmail(
    {
      subject: "Urgent email is waiting for tomorrow",
      heading: "Today's email allowance is used up",
      paragraphs: [
        `${p.waiting === 1 ? "1 urgent email" : `${p.waiting} urgent emails`} could not go today. The league's free email plan sends ${p.daily} a day and ${p.monthly} a month.`,
        `They go out on their own when the allowance resets (${p.resumes}). Players with push turned on for it already have it on their phone. To reach everyone sooner, share the news with "Copy for WhatsApp" on its page.`,
      ],
      action: { label: "Open the admin dashboard", path: "/app/admin" },
      reason: "you are a league admin",
    },
    ctx,
  ),
);
