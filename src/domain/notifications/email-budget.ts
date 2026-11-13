import type { DeliveryClass } from "./kinds";

/**
 * The email provider's free allowance, which the outbox never goes past
 * (docs/architecture.md, section 5, "The email budget"; ADR 0019). Resend's
 * free plan allows 100 emails a UTC day and 3,000 a month, and refuses the
 * rest without queuing them. `reserve` of each is kept back from ordinary
 * messages for sign-in links (sent outside the outbox) and for the notice
 * that tells admins the allowance ran out.
 */
export type EmailBudget = { daily: number; monthly: number; reserve: number };

export const FREE_EMAIL_BUDGET: EmailBudget = {
  daily: 100,
  monthly: 3000,
  reserve: 10,
};

const positive = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return raw !== undefined && Number.isInteger(n) && n >= 0 ? n : fallback;
};

/**
 * The budget from `EMAIL_DAILY_LIMIT`, `EMAIL_MONTHLY_LIMIT` and
 * `EMAIL_RESERVE`, defaulting to the free plan. A value that is not a
 * whole number is ignored, and the reserve never takes the whole day.
 */
export function emailBudgetFrom(
  env: Readonly<Record<string, string | undefined>>,
): EmailBudget {
  const daily = positive(env.EMAIL_DAILY_LIMIT, FREE_EMAIL_BUDGET.daily);
  const monthly = positive(env.EMAIL_MONTHLY_LIMIT, FREE_EMAIL_BUDGET.monthly);
  const reserve = Math.min(
    positive(env.EMAIL_RESERVE, FREE_EMAIL_BUDGET.reserve),
    Math.floor(Math.min(daily, monthly) / 2),
  );
  return { daily, monthly, reserve };
}

/** The provider counts days in UTC. */
export const startOfUtcDay = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

/** The free plan does not say when its month starts; a calendar month is the cautious reading. */
export const startOfUtcMonth = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

export const nextUtcDay = (now: Date): Date =>
  new Date(startOfUtcDay(now).getTime() + 24 * 60 * 60 * 1000);

/** Emails sent so far today and this month, as the provider counts them. */
export type EmailUse = { today: number; month: number };

/**
 * How many more emails may go now. Ordinary messages stop short of the
 * reserve; the admins' budget notice may use it.
 */
export function emailsLeft(
  budget: EmailBudget,
  used: EmailUse,
  { reserve }: { reserve: boolean },
): number {
  const held = reserve ? 0 : budget.reserve;
  return Math.max(
    0,
    Math.min(
      budget.daily - held - used.today,
      budget.monthly - held - used.month,
    ),
  );
}

/**
 * What happens to an email the budget cannot cover now. Nothing is
 * dropped: an urgent message whose push copy already reached the person
 * is marked as delivered by push; any other urgent message, and the
 * digest, waits for tomorrow's allowance (and admins are told); news that
 * can wait goes into the person's digest.
 */
export type OutOfEmail = "pushed" | "tomorrow" | "digest";

export function whenOutOfEmail(
  kind: DeliveryClass,
  { pushSent }: { pushSent: boolean },
): OutOfEmail {
  if (kind === "urgent") return pushSent ? "pushed" : "tomorrow";
  return kind === "non_urgent" ? "digest" : "tomorrow";
}

/**
 * Whether the provider refused an email because the account's daily or
 * monthly quota is used up (HTTP 429, `daily_quota_exceeded` or
 * `monthly_quota_exceeded`). Such an email waits for tomorrow instead of
 * using up a retry.
 */
export const isQuotaRefusal = (error: string): boolean =>
  /quota_exceeded/.test(error);
