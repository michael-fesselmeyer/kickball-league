import { z } from "zod";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

/**
 * Tells the acting admin and the league's owners when a handover starts and
 * when it ends, whether by its date or because an owner ended it (issue
 * #468). Urgent: it says who may act for the league right now.
 */
export const actingAdminPayload = z.object({
  kind: z.enum(["started", "ended", "ended_early"]),
  /** The acting admin, as "Jo S.". */
  person: z.string().min(1),
  /** Whether this notice goes to that person. */
  toActing: z.boolean(),
  /** Power labels, such as "Scores". */
  powers: z.array(z.string().min(1)).min(1),
  /** Such as "Saturday, March 20, 9:00 AM". */
  starts: z.string().min(1),
  ends: z.string().min(1),
});

export type ActingAdminPayload = z.infer<typeof actingAdminPayload>;

export const actingAdminEmail = defineTemplate(actingAdminPayload, (p, ctx) => {
  const powers = p.powers.join(", ");
  const who = p.toActing ? "You are" : `${p.person} is`;
  const [subject, lead] =
    p.kind === "started"
      ? [
          p.toActing
            ? "You are acting admin for the league"
            : `${p.person} is now acting admin`,
          `${who} acting admin from ${p.starts} until ${p.ends}.`,
        ]
      : p.kind === "ended_early"
        ? [
            p.toActing
              ? "Your acting admin access has ended"
              : `${p.person}'s acting admin access has ended`,
            `An owner ended the handover early. ${p.toActing ? "You no longer" : `${p.person} no longer`} have admin powers.`,
          ]
        : [
            p.toActing
              ? "Your acting admin access has ended"
              : `${p.person}'s acting admin access has ended`,
            `The handover that ran until ${p.ends} is over.`,
          ];
  return renderEmail(
    {
      subject,
      heading: subject,
      paragraphs: [
        lead,
        `Powers: ${powers}.`,
        "Every change an acting admin makes is in the audit log under their name. Money, roles and the audit log are never part of a handover.",
      ],
      action: p.toActing
        ? { label: "Open the league", path: "/app" }
        : { label: "See acting admins", path: "/app/admin/acting-admins" },
      reason: p.toActing
        ? "you were named acting admin"
        : "you are an owner of the league",
    },
    ctx,
  );
});
