# ADR 0019: Split messages into urgent and non-urgent, by kind

- Status: accepted
- Date: 2026-11-13

## Context

The product spec (section 9, "Alerts that fit each role, without too many") asks for a daily cap per person, a digest for non-urgent news and quiet hours, without losing the messages a player has to act on. A rain-out at 9 pm, a sub spot that was just confirmed or a score that becomes final in 24 hours is worthless the next morning; an announcement or a reminder about a missing score can wait a few hours or a day. Per-topic opt-out already lets people turn whole topics off, but that is all or nothing.

## Decision

**Every kind of message is urgent or non-urgent, in one table.** `MESSAGE_KINDS` in `src/domain/notifications/kinds.ts` names each email template the outbox sends and its urgency. The template registry (`src/emails/templates.ts`) and `enqueueMessages` are typed by that table, so a new kind of message does not compile until it is classified. `docs/architecture.md`, section 5, shows the same table, and a unit test keeps the two in step.

**The rules apply when a message is sent, not when it is queued**, in `decide` (`src/domain/notifications/limits.ts`):

- Urgent: always sent at once. In quiet hours a push is marked silent, so it arrives without sound or vibration where the platform allows.
- Non-urgent: in quiet hours it is queued again for the moment they end. Outside them it is sent while the person is under their daily cap for that channel, and held for their next digest after that. Held messages are never dropped.
- The digest itself is never capped but waits out quiet hours like news.

The cap counts messages sent since local midnight, per channel, in the league's time zone. Quiet hours and the digest time (6 pm, daily or on Sundays) are wall-clock times in that zone, computed so that daylight-saving changes neither skip nor repeat them.

**Defaults are generous and a member can only tighten them**: 3 non-urgent messages a day per channel, a daily digest, quiet hours from 10 pm to 8 am. A cap of 0 means "everything that can wait comes in the digest".

## Alternatives considered

- **Classify per message rather than per kind** (a payment reminder 7 days out can wait; one a day before cannot). More precise, but it scatters the decision across every place that queues a message, and the spec asks for one place a new kind has to choose. Kinds whose messages are mostly time-critical are urgent as a whole: payment reminders (three a season at most), score confirmations (final after 24 hours) and event notices.
- **Classify per topic.** Topics are what people opt out of, and one topic mixes urgencies: `score` holds both the confirmation a captain must answer within a day and the reminder that a score is missing.
- **Decide when queuing.** The person's limits and their sends that day change between queueing and sending, and quiet hours depend on the moment of sending; deciding at send time, as consent already is, keeps one rule.
- **A per-person time zone.** Members are local to the league, and every other time in the app is in the league's zone. The domain functions take the zone as an argument, so a per-person zone is a column away.

## Consequences

- Announcements, new-team answers and missing-score reminders now wait out the night and fold into the digest on busy days. Rain-outs, schedule changes, sub requests and answers, payment reminders, score confirmations, rain alerts and event notices go at once, as before.
- On Vercel's Hobby plan the outbox sweep runs once a day, so it moved from 5:30 am to 9:30 am New York time (after quiet hours end); a message that waited for the morning goes out with the next send or that sweep. The digest job runs once a day after 6 pm.
- Adding a kind of message means adding a row to `MESSAGE_KINDS` and to the table in `docs/architecture.md`.
