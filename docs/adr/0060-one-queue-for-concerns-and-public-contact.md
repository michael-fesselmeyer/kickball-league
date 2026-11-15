# ADR 0060: One queue for private concerns and public contact messages

- Status: accepted
- Date: 2026-11-15

## Context

Only refs, captains and admins could report anything, and only about a game. A player with a concern about how they were treated, a neighbor near the field, a park worker or a visitor had no way to reach the league. Both kinds of message need the same handling: an admin reads it, replies, adds notes and closes it with what was done.

The site must cost nothing to run (ADR 0021), so spam protection and email cannot depend on a paid service.

## Decision

**One `concern` table, two sources.** A private concern from a signed-in player (`source = player`) and a message from the public contact form (`source = public`) are the same record with a `source` column, so admins work one queue, shown on the incidents screen. Incidents stay separate: they are about a game and name people, and they feed suspensions. A concern is free text about a game, a team or the league.

**A park-rules category** (`park_rule` enum: play outside permit hours, alcohol or glass, amplified sound, litter, field damage, sharing the space) is a nullable column on both `concern` and `incident`, so a season's park issues can be counted across both.

**The public page stays static.** `/contact` is plain HTML with a client form that posts to a server action; the action reads the request's headers, the page reads nothing. The form's result is held in the component, not the URL, so no submission shows anything from an earlier one.

**Free spam and abuse protection.** A honeypot field (answered as a success, so a bot learns nothing), a cap of two links, and three limits counted in the existing `rate_limit` table: 3 a day per email address, 10 a day per network, and 60 an hour for everyone together, so a flood cannot use the day's free email. The address and network are stored only as hashes in the limit keys.

**Replies use the outbox.** A message may now have no user: `message.user_id` is nullable and `recipient_email` holds the address, with a check that one of them is set. The drain treats such a message as urgent mail with default preferences, and counts it against the same email quota. A signed-in sender's mail goes to their account. Notes are never emailed. The topic is `discipline`, the league's official correspondence, which is always delivered and is not on the settings page.

**Privacy.** The sender's address is visible only to admins, opening a concern that has one writes `concern.read` to the audit log, and the audit entries for a concern never hold its text or address. An address is cleared (and its queued emails deleted) 12 months after the concern closes, by the daily outbox sweep. A concern is never shown to a team or the public.

**Time to first reply** is `first_replied_at`, set by the first reply (not a note). The incidents screen shows the share of the last 90 days' concerns, among those with someone to answer, replied to within a day.

## Consequences

- Replying to someone without an account needs no new service, but costs one email from the free quota per step (received, each reply, closed).
- Rate limiting by network trusts `x-forwarded-for`, which Vercel sets.
- Anonymous senders have no unsubscribe, so only one acknowledgement, replies the admin writes and one closing note are ever sent.
