import { z } from "zod";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

/**
 * What the league tells the sender of a concern: that it arrived, a reply,
 * or that it is closed and what was done. Never says who else saw it.
 */
export const concernUpdatePayload = z.object({
  step: z.enum(["received", "reply", "closed"]),
  leagueName: z.string().min(1),
  /** The reply, or what was done when closing; empty for "received". */
  text: z.string().max(2000),
  /** A signed-in sender follows the thread in the app. */
  inApp: z.boolean(),
});

export const concernUpdateEmail = defineTemplate(
  concernUpdatePayload,
  (p, ctx) => {
    const lines =
      p.step === "received"
        ? [
            `${p.leagueName} got your message. Only the league's admins read it, and one of them will answer.`,
            p.inApp
              ? "You can follow it in the app."
              : "If you left an address, the answer comes to this email.",
          ]
        : p.step === "reply"
          ? [`${p.leagueName} replied:`, p.text]
          : [`${p.leagueName} closed your message. What was done:`, p.text];
    return renderEmail(
      {
        subject:
          p.step === "received"
            ? "We got your message"
            : p.step === "reply"
              ? "A reply from the league"
              : "Your message is closed",
        heading:
          p.step === "received"
            ? "We got your message"
            : p.step === "reply"
              ? "A reply from the league"
              : "Your message is closed",
        paragraphs: lines,
        ...(p.inApp
          ? { action: { label: "Open the app", path: "/app/concerns" } }
          : {}),
        reason: "you sent the league a message",
      },
      ctx,
    );
  },
);
