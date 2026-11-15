import { z } from "zod";
import { fill } from "@/i18n/catalog";
import { defineTemplate } from "./define";
import { emailWords, renderEmail } from "./layout";

const about = {
  seasonName: z.string().min(1),
  seasonSlug: z.string().min(1),
  team: z.string().min(1),
};

/**
 * Changes to who leads a team (ADR 0042): the captaincy offered to a
 * teammate (kind `captain_handoff`, urgent: it waits on their answer), and,
 * as `team_role`, the answer for the captain who offered it and a teammate
 * made a co-captain or a player again. A withdrawn offer sends nothing.
 */
export const teamRolePayload = z.discriminatedUnion("kind", [
  z.object({
    ...about,
    kind: z.literal("offered"),
    /** The captain offering, as "Jo S.". */
    captain: z.string().min(1),
  }),
  z.object({
    ...about,
    kind: z.literal("accepted"),
    /** The new captain, as "Jo S.". */
    player: z.string().min(1),
  }),
  z.object({
    ...about,
    kind: z.literal("declined"),
    player: z.string().min(1),
  }),
  z.object({ ...about, kind: z.literal("co_captain") }),
  z.object({ ...about, kind: z.literal("player") }),
]);

export type TeamRolePayload = z.infer<typeof teamRolePayload>;

export const teamRoleEmail = defineTemplate(teamRolePayload, (p, ctx) => {
  const { w: all } = emailWords(ctx);
  const w = all.teamRole;
  const team = { path: `/app/seasons/${p.seasonSlug}/team` };
  const seeTeam = { label: all.common.seeTeam, ...team };
  const vars = {
    team: p.team,
    season: p.seasonName,
    captain: p.kind === "offered" ? p.captain : "",
    player: "player" in p ? p.player : "",
  };
  const playReason = fill(w.playReason, vars);
  const offeredReason = fill(w.offeredReason, vars);
  switch (p.kind) {
    case "offered":
      return renderEmail(
        {
          subject: fill(w.offeredSubject, vars),
          heading: fill(w.offeredHeading, vars),
          paragraphs: [fill(w.offeredLead, vars), w.offeredMore],
          action: { label: w.answer, ...team },
          reason: playReason,
        },
        ctx,
      );
    case "accepted":
      return renderEmail(
        {
          subject: fill(w.acceptedSubject, vars),
          heading: w.acceptedHeading,
          paragraphs: [fill(w.acceptedLead, vars), w.acceptedMore],
          action: seeTeam,
          reason: offeredReason,
        },
        ctx,
      );
    case "declined":
      return renderEmail(
        {
          subject: fill(w.declinedSubject, vars),
          heading: w.declinedHeading,
          paragraphs: [fill(w.declinedLead, vars), w.declinedMore],
          action: seeTeam,
          reason: offeredReason,
        },
        ctx,
      );
    case "co_captain":
      return renderEmail(
        {
          subject: fill(w.coSubject, vars),
          heading: w.coHeading,
          paragraphs: [fill(w.coLead, vars), w.coMore],
          action: seeTeam,
          reason: playReason,
        },
        ctx,
      );
    case "player":
      return renderEmail(
        {
          subject: fill(w.playerSubject, vars),
          heading: w.playerHeading,
          paragraphs: [fill(w.playerLead, vars)],
          action: seeTeam,
          reason: playReason,
        },
        ctx,
      );
  }
});
