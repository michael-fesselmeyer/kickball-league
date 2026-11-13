# ADR 0021: Free services only

- Status: accepted
- Date: 2026-11-13

## Context

The league is run by volunteers, and the site must cost nothing to run. [ADR 0003](0003-free-hosting-and-secrets.md) kept development on free tiers but left room for paid plans later, and the planning docs counted on several: a paid hosting plan and a paid email tier for production, a paid error-monitoring tier at larger sizes, an AI provider billed per use behind a monthly cap, text messages billed per message, alerts through WhatsApp's business messaging, and an Apple Developer account for Sign in with Apple.

## Decision

**No feature may need a paid plan, a paid API key or a monthly bill. If a feature has no free option, it is left out.** A paid service is used only if the maintainer expressly authorizes it.

- **Hosting, database, email, file storage, error monitoring, analytics and CI** stay on their free tiers: Vercel Hobby (including Blob, Web Analytics and Speed Insights), Neon Free, Resend Free, Sentry Developer and GitHub Actions in a public repository. No account has a payment method on file, so reaching a limit stops a service instead of billing it.
- **Notices go by email and web push.** Web push uses the league's own VAPID keys and no account at a push service ([ADR 0014](0014-web-push-without-a-library.md)). "Copy for WhatsApp" covers the league's group chats.
- **Weather comes from the National Weather Service API**, which is free with no key ([ADR 0005](0005-weather-forecast-source.md)).
- **Payments stay on Stripe**, which has no monthly fee. Its per-payment fees come out of the league's own payments; paid Stripe add-ons are not used.
- **Left out:** AI features (Ask the rulebook, the AI-drafted recap, an AI helper), text messages, WhatsApp business alerts, Sign in with Apple and app-store listings. The weekly recap is drafted from templates instead.
- Each service's free limit, what the site does as it nears it, and the expected use at 12, 50 and 200 teams are kept in [architecture.md](../architecture.md), section 15, with a link to the provider's own page for every figure.

## Alternatives considered

- **Paid plans with spending caps.** A cap limits the bill but does not remove it, and every plan adds a monthly cost the league would have to cover.
- **Optional paid features, off unless a key is set.** The code, tests and docs for them still have to be kept up, for features the league would not switch on.

## Consequences

- Free limits shape the design. Email is the tightest: Resend's free tier sends 100 emails a day, fewer than one reminder to every player of a 12-team league. The outbox will need to wait for the next day's quota instead of failing, keep part of each day's quota for sign-in links and receipts, and send routine notices by push to people who have it on.
- At about 50 teams some limits are reached (CDN requests, database compute, analytics events), and at 200 teams the free hosting plan does not fit. Growing past that needs another free host or an authorized paid plan.
- Vercel's terms allow the Hobby plan only for personal or non-commercial use, and the league takes payments. Which free host serves the live league is an open question for launch ([open-questions.md](../open-questions.md), question 51).
- The AI recap work and its schema (an `ai_usage` table and a league AI budget) are dropped. The `sms` value stays in the `message_channel` enum unused, since removing it would need a migration for no gain.
- Free tiers change. The limits in section 15 are checked again before launch and whenever a provider announces a change.
