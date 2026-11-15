import { z } from "zod";
import { fill } from "@/i18n/catalog";
import { defineTemplate } from "./define";
import { emailWords, renderEmail } from "./layout";

/** The game a sub notice is about, as the league writes it. */
const about = {
  seasonName: z.string().min(1),
  seasonSlug: z.string().min(1),
  /** The team asking for subs. */
  team: z.string().min(1),
  /** "Aces vs Bees". */
  teams: z.string().min(1),
  /** When and where: "Sun, Sep 13, 7:00 PM, Field 2". */
  when: z.string().min(1),
};

/** A call for subs, sent to each eligible player. */
export const subRequestPayload = z.object({
  ...about,
  /** "2 subs, at least 1 woman". */
  spots: z.string().min(1),
  note: z.string().nullable(),
  freeAgent: z.boolean(),
});

export type SubRequestPayload = z.infer<typeof subRequestPayload>;

export const subRequestEmail = defineTemplate(subRequestPayload, (p, ctx) => {
  const w = emailWords(ctx).w.sub;
  const vars = {
    team: p.team,
    teams: p.teams,
    when: p.when,
    spots: p.spots,
    season: p.seasonName,
  };
  return renderEmail(
    {
      subject: fill(w.requestSubject, vars),
      heading: fill(w.requestHeading, vars),
      paragraphs: [
        fill(w.requestLead, vars),
        ...(p.note ? [fill(w.fromCaptain, { note: p.note })] : []),
        w.hold,
      ],
      action: { label: w.seeRequests, path: "/app/subs" },
      reason: fill(p.freeAgent ? w.freeAgentReason : w.playerReason, vars),
    },
    ctx,
  );
});

/** What happened to a claim, for the captain or for the player. */
export const subUpdatePayload = z.discriminatedUnion("kind", [
  z.object({
    ...about,
    kind: z.enum(["claimed", "withdrawn"]),
    /** The player, as "Jo S.". */
    player: z.string().min(1),
  }),
  z.object({
    ...about,
    kind: z.enum(["approved", "declined", "cancelled"]),
  }),
]);

export type SubUpdatePayload = z.infer<typeof subUpdatePayload>;

const captainPage = (slug: string) => `/app/seasons/${slug}/team/subs`;

export const subUpdateEmail = defineTemplate(subUpdatePayload, (p, ctx) => {
  const w = emailWords(ctx).w.sub;
  const vars = {
    team: p.team,
    teams: p.teams,
    when: p.when,
    player: "player" in p ? p.player : "",
  };
  const captainReason = fill(w.captainReason, vars);
  const offeredReason = fill(w.offeredReason, vars);
  switch (p.kind) {
    case "claimed":
      return renderEmail(
        {
          subject: fill(w.claimedSubject, vars),
          heading: fill(w.claimedHeading, vars),
          paragraphs: [fill(w.claimedLead, vars), w.claimedMore],
          action: {
            label: w.approveOrDecline,
            path: captainPage(p.seasonSlug),
          },
          reason: captainReason,
        },
        ctx,
      );
    case "withdrawn":
      return renderEmail(
        {
          subject: fill(w.withdrawnSubject, vars),
          heading: w.withdrawnHeading,
          paragraphs: [fill(w.withdrawnLead, vars)],
          action: {
            label: w.seeYourRequest,
            path: captainPage(p.seasonSlug),
          },
          reason: captainReason,
        },
        ctx,
      );
    case "approved":
      return renderEmail(
        {
          subject: fill(w.approvedSubject, vars),
          heading: w.approvedHeading,
          paragraphs: [fill(w.approvedLead, vars), w.approvedMore],
          action: { label: w.seeDetails, path: "/app/subs" },
          reason: offeredReason,
        },
        ctx,
      );
    case "declined":
      return renderEmail(
        {
          subject: fill(w.declinedSubject, vars),
          heading: w.declinedHeading,
          paragraphs: [fill(w.declinedLead, vars)],
          action: {
            label: emailWords(ctx).w.common.seeOtherRequests,
            path: "/app/subs",
          },
          reason: offeredReason,
        },
        ctx,
      );
    case "cancelled":
      return renderEmail(
        {
          subject: fill(w.cancelledSubject, vars),
          heading: w.cancelledHeading,
          paragraphs: [fill(w.cancelledLead, vars)],
          action: {
            label: emailWords(ctx).w.common.seeOtherRequests,
            path: "/app/subs",
          },
          reason: offeredReason,
        },
        ctx,
      );
  }
});
