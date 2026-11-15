import { z } from "zod";
import { fill } from "@/i18n/catalog";
import { defineTemplate } from "./define";
import { emailWords, renderEmail } from "./layout";

const about = {
  /** The organization the league or tournament is for. */
  organization: z.string().min(1),
  kind: z.enum(["tournament", "league"]),
};

/**
 * Private leagues and tournaments (ADR 0049), for the organizer: the
 * request arrived, it was accepted as a private season, or the league
 * can't take it.
 */
export const privateEventPayload = z.discriminatedUnion("step", [
  z.object({ ...about, step: z.literal("received") }),
  z.object({
    ...about,
    step: z.literal("accepted"),
    seasonName: z.string().min(1),
    seasonSlug: z.string().min(1),
  }),
  z.object({
    ...about,
    step: z.literal("declined"),
    reason: z.string().nullable(),
  }),
]);

export type PrivateEventPayload = z.infer<typeof privateEventPayload>;

export const privateEventEmail = defineTemplate(
  privateEventPayload,
  (p, ctx) => {
    const { w: all } = emailWords(ctx);
    const w = all.privateEvent;
    const vars = {
      what: p.kind === "tournament" ? w.tournament : w.league,
      organization: p.organization,
    };
    const reason = fill(w.reason, vars);
    switch (p.step) {
      case "received":
        return renderEmail(
          {
            subject: fill(w.receivedSubject, vars),
            heading: w.receivedHeading,
            paragraphs: [fill(w.receivedLead, vars), w.receivedMore],
            action: { label: w.seeRequest, path: "/app/private-events" },
            reason,
          },
          ctx,
        );
      case "accepted": {
        const accepted = { ...vars, season: p.seasonName };
        return renderEmail(
          {
            subject: fill(w.acceptedSubject, accepted),
            heading: fill(w.acceptedHeading, accepted),
            paragraphs: [fill(w.acceptedLead, accepted), w.acceptedMore],
            action: {
              label: w.organizerPage,
              path: `/app/private-events/${p.seasonSlug}`,
            },
            reason,
          },
          ctx,
        );
      }
      case "declined":
        return renderEmail(
          {
            subject: fill(w.declinedSubject, vars),
            heading: w.declinedHeading,
            paragraphs: [
              fill(w.declinedLead, vars),
              ...(p.reason
                ? [fill(all.common.fromLeague, { text: p.reason })]
                : []),
              w.declinedMore,
            ],
            action: { label: w.askAgain, path: "/app/private-events/new" },
            reason,
          },
          ctx,
        );
    }
  },
);
