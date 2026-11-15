import { z } from "zod";
import { fill } from "@/i18n/catalog";
import { defineTemplate } from "./define";
import { emailWords, renderEmail } from "./layout";

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
    const { w: all } = emailWords(ctx);
    const w = all.concern;
    const league = { league: p.leagueName };
    const lines =
      p.step === "received"
        ? [fill(w.received, league), p.inApp ? w.followInApp : w.answerByEmail]
        : p.step === "reply"
          ? [fill(w.replied, league), p.text]
          : [fill(w.closed, league), p.text];
    const title =
      p.step === "received"
        ? w.receivedTitle
        : p.step === "reply"
          ? w.replyTitle
          : w.closedTitle;
    return renderEmail(
      {
        subject: title,
        heading: title,
        paragraphs: lines,
        ...(p.inApp
          ? { action: { label: all.common.openApp, path: "/app/concerns" } }
          : {}),
        reason: w.reason,
      },
      ctx,
    );
  },
);
