import { z } from "zod";
import { fill } from "@/i18n/catalog";
import { defineTemplate } from "./define";
import { emailWords, renderEmail } from "./layout";

/**
 * Money emails from roadmap item 13: the captain guarantee's warning and a
 * declined charge, a waitlist offer, and league credit from a referral or a
 * rain-out rebate. Amounts and times arrive already written out in the
 * league's time zone.
 */

export const guaranteeWarningPayload = z.object({
  teamName: z.string().min(1),
  seasonName: z.string().min(1),
  seasonSlug: z.string().min(1),
  balance: z.string().min(1),
  /** When the card will be charged, such as "Monday, March 1 at 12:00 AM". */
  chargeOn: z.string().min(1),
  card: z.string().min(1),
  /**
   * The card price of the balance, when the league's processing fees are on
   * (ADR 0093): what the card will be charged, fee included.
   */
  charge: z.string().min(1).optional(),
});
export type GuaranteeWarningPayload = z.infer<typeof guaranteeWarningPayload>;

export const guaranteeWarningEmail = defineTemplate(
  guaranteeWarningPayload,
  (p, ctx) => {
    const w = emailWords(ctx).w.money;
    const vars = {
      team: p.teamName,
      season: p.seasonName,
      balance: p.balance,
      on: p.chargeOn,
      card: p.card,
      charge: p.charge ?? "",
    };
    return renderEmail(
      {
        subject: fill(w.warningSubject, vars),
        heading: fill(w.warningHeading, vars),
        paragraphs: [
          fill(p.charge ? w.warningLeadCharge : w.warningLead, vars),
          w.warningMore,
        ],
        action: {
          label: w.whoPaid,
          path: `/app/seasons/${p.seasonSlug}/team`,
        },
        reason: fill(w.guaranteeReason, vars),
      },
      ctx,
    );
  },
);

export const guaranteeFailedPayload = z.object({
  teamName: z.string().min(1),
  seasonName: z.string().min(1),
  seasonSlug: z.string().min(1),
  balance: z.string().min(1),
});
export type GuaranteeFailedPayload = z.infer<typeof guaranteeFailedPayload>;

export const guaranteeFailedEmail = defineTemplate(
  guaranteeFailedPayload,
  (p, ctx) => {
    const w = emailWords(ctx).w.money;
    const vars = {
      team: p.teamName,
      season: p.seasonName,
      balance: p.balance,
    };
    return renderEmail(
      {
        subject: fill(w.failedSubject, vars),
        heading: w.failedHeading,
        paragraphs: [fill(w.failedLead, vars), w.failedMore],
        action: {
          label: w.payBalance,
          path: `/app/seasons/${p.seasonSlug}/team`,
        },
        reason: fill(w.guaranteeReason, vars),
      },
      ctx,
    );
  },
);

export const waitlistOfferPayload = z.object({
  seasonName: z.string().min(1),
  seasonSlug: z.string().min(1),
  /** When the offer runs out, such as "Friday, February 12 at 12:00 PM". */
  expires: z.string().min(1),
});
export type WaitlistOfferPayload = z.infer<typeof waitlistOfferPayload>;

export const waitlistOfferEmail = defineTemplate(
  waitlistOfferPayload,
  (p, ctx) => {
    const w = emailWords(ctx).w.money;
    const vars = { season: p.seasonName, expires: p.expires };
    return renderEmail(
      {
        subject: fill(w.waitlistSubject, vars),
        heading: w.waitlistHeading,
        paragraphs: [fill(w.waitlistLead, vars), w.waitlistMore],
        action: {
          label: w.registerTeam,
          path: `/app/seasons/${p.seasonSlug}/register`,
        },
        reason: fill(w.waitlistReason, vars),
      },
      ctx,
    );
  },
);

export const referralCreditPayload = z.object({
  amount: z.string().min(1),
  seasonName: z.string().min(1),
});
export type ReferralCreditPayload = z.infer<typeof referralCreditPayload>;

export const referralCreditEmail = defineTemplate(
  referralCreditPayload,
  (p, ctx) => {
    const { w: all } = emailWords(ctx);
    const w = all.money;
    const vars = { amount: p.amount, season: p.seasonName };
    return renderEmail(
      {
        subject: fill(w.referralSubject, vars),
        heading: w.referralHeading,
        paragraphs: [fill(w.referralLead, vars), all.common.nextFee],
        action: { label: all.common.seeCredit, path: "/app/profile#credit" },
        reason: w.referralReason,
      },
      ctx,
    );
  },
);

export const rebateCreditPayload = z.object({
  amount: z.string().min(1),
  seasonName: z.string().min(1),
  teamName: z.string().min(1),
  gamesLost: z.number().int().positive(),
  gamesCount: z.number().int().positive(),
});
export type RebateCreditPayload = z.infer<typeof rebateCreditPayload>;

export const rebateCreditEmail = defineTemplate(
  rebateCreditPayload,
  (p, ctx) => {
    const { w: all } = emailWords(ctx);
    const w = all.money;
    const vars = {
      amount: p.amount,
      season: p.seasonName,
      team: p.teamName,
      lost: p.gamesLost,
      count: p.gamesCount,
    };
    return renderEmail(
      {
        subject: fill(w.rebateSubject, vars),
        heading: w.rebateHeading,
        paragraphs: [fill(w.rebateLead, vars), all.common.nextFee],
        action: { label: all.common.seeCredit, path: "/app/profile#credit" },
        reason: fill(w.rebateReason, vars),
      },
      ctx,
    );
  },
);
