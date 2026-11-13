import { z } from "zod";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

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
});
export type GuaranteeWarningPayload = z.infer<typeof guaranteeWarningPayload>;

export const guaranteeWarningEmail = defineTemplate(
  guaranteeWarningPayload,
  (p, ctx) =>
    renderEmail(
      {
        subject: `${p.teamName} still owes ${p.balance}: your card is charged ${p.chargeOn}`,
        heading: `Heads up: ${p.balance} left on ${p.teamName}`,
        paragraphs: [
          `Your team's ${p.seasonName} fee still has ${p.balance} unpaid. As the team's guarantee, your ${p.card} will be charged that amount on ${p.chargeOn}.`,
          "Anything your teammates pay before then comes off the charge. Collect the rest from them afterwards, or remove the card if you would rather pay another way.",
        ],
        action: {
          label: "See who has paid",
          path: `/app/seasons/${p.seasonSlug}/team`,
        },
        reason: `you saved a card to guarantee ${p.teamName}'s fee`,
      },
      ctx,
    ),
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
  (p, ctx) =>
    renderEmail(
      {
        subject: `We couldn't charge your card for ${p.teamName}`,
        heading: "Your card was declined",
        paragraphs: [
          `We tried to charge your saved card ${p.balance} for the rest of ${p.teamName}'s ${p.seasonName} fee, and the bank said no.`,
          "Your team is not confirmed until the fee is paid. Pay the balance from the team page, or save a different card.",
        ],
        action: {
          label: "Pay the balance",
          path: `/app/seasons/${p.seasonSlug}/team`,
        },
        reason: `you saved a card to guarantee ${p.teamName}'s fee`,
      },
      ctx,
    ),
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
  (p, ctx) =>
    renderEmail(
      {
        subject: `A team spot opened in ${p.seasonName}. It's yours until ${p.expires}`,
        heading: "You're up! A spot just opened",
        paragraphs: [
          `A team spot opened in ${p.seasonName} and you're next on the waitlist. We're holding it for you until ${p.expires}.`,
          "Register your team before then to take it. After that, it goes to the next team in line.",
        ],
        action: {
          label: "Register your team",
          path: `/app/seasons/${p.seasonSlug}/register`,
        },
        reason: `you joined the ${p.seasonName} waitlist`,
      },
      ctx,
    ),
);

export const referralCreditPayload = z.object({
  amount: z.string().min(1),
  seasonName: z.string().min(1),
});
export type ReferralCreditPayload = z.infer<typeof referralCreditPayload>;

export const referralCreditEmail = defineTemplate(
  referralCreditPayload,
  (p, ctx) =>
    renderEmail(
      {
        subject: `You earned ${p.amount} in league credit`,
        heading: "Thanks for bringing a friend",
        paragraphs: [
          `Someone you invited just paid for ${p.seasonName}, so ${p.amount} of league credit is in your account.`,
          "It comes off your next fee automatically when you pay.",
        ],
        action: { label: "See your credit", path: "/app/profile#credit" },
        reason: "someone registered through your referral link",
      },
      ctx,
    ),
);

export const rebateCreditPayload = z.object({
  amount: z.string().min(1),
  seasonName: z.string().min(1),
  teamName: z.string().min(1),
  gamesLost: z.number().int().positive(),
  gamesCount: z.number().int().positive(),
});
export type RebateCreditPayload = z.infer<typeof rebateCreditPayload>;

export const rebateCreditEmail = defineTemplate(rebateCreditPayload, (p, ctx) =>
  renderEmail(
    {
      subject: `${p.amount} of league credit for the rained-out games`,
      heading: "Some of your fee is coming back",
      paragraphs: [
        `${p.teamName} lost ${p.gamesLost} of ${p.gamesCount} games in ${p.seasonName} to weather that could not be made up. Your share of the rebate, ${p.amount}, is now league credit.`,
        "It comes off your next fee automatically when you pay.",
      ],
      action: { label: "See your credit", path: "/app/profile#credit" },
      reason: `you paid toward ${p.teamName}'s ${p.seasonName} fee`,
    },
    ctx,
  ),
);
