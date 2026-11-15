# ADR 0058: Scheduled announcements go out with the outbox's daily sweep

- Status: accepted
- Date: 2026-11-14

## Context

Admins often write an announcement before it should go out: the week's field change on Sunday for Thursday, or a reminder to bring shirts the morning of picture day. Until now an announcement went out the moment it was sent.

The site runs on free plans only ([ADR 0021](0021-free-services-only.md)). On the free hosting plan, scheduled jobs run at most once a day, at a fixed time, so a message can't be sent at an exact minute the admin picks. The outbox already has a daily sweep (`/api/jobs/outbox` in `vercel.json`, 13:30 UTC), and every action that queues a message also drains the outbox right after its response (`after()` in `sendQueuedSoon`).

## Decision

**An admin picks a day, not a minute.** The compose form offers three choices: send now, at the next morning send, or on a chosen day within four months. A scheduled announcement's `send_at` is the sweep on that day (`src/domain/messaging/send-time.ts`), and the form shows when that is in the league's time zone ("about 8:30 AM EST"). The form says plainly that scheduled messages go out once a day.

**The outbox releases it.** `drainOutboxNow` first calls `releaseDueAnnouncements`. That queues one message per recipient for every waiting announcement whose `send_at` has passed, marks it sent and records how many it reached. The daily sweep releases it on time; if the sweep is late or fails, the next drain after any other send picks it up. From there it is an ordinary announcement message: non-urgent, so quiet hours, each person's daily limit, their email settings and the email quota all apply.

**The audience is read when it sends.** A league-wide announcement scheduled a week out reaches people who register in that week too.

**Until it sends, it can change.** The admin can edit the subject, message and day, or cancel it. Each is a conditional update on a row with no `sent_at` and no `cancelled_at`, so a change that races the sweep either lands first or is refused with "already gone out". Scheduling, edits and cancellations are audited.

**Only admins schedule.** Captains' team messages still send at once.

## Alternatives considered

- **Queue the messages at once with a later `send_after`.** No new release step, but the audience is fixed when the admin writes it, and editing or cancelling means rewriting or deleting hundreds of queued rows.
- **An exact time with a more frequent cron.** Needs a paid hosting plan or an outside scheduler. Out under ADR 0021.
- **A free outside cron service calling the job every few minutes.** Another account and secret to manage for little gain: announcements rarely need minute precision.

## Consequences

- `announcement` gains `send_at`, `sent_at` and `cancelled_at`; existing rows are marked sent at their creation time. A check constraint keeps each row either sent or waiting (or cancelled).
- A scheduled announcement arrives at about the same time of morning every day, shifting by an hour with daylight saving time. The form shows the time for the chosen day.
- If the sweep's time in `vercel.json` changes, `OUTBOX_SWEEP_UTC` must change with it; a unit test fails until they match.
- The day an admin picks is a date in the league's time zone. The send time is that day's sweep, the one that falls on it locally. Far east of UTC, that's the sweep on the UTC date before.
- Each release queues up to 20 announcements and repeats while a batch comes back full, so a busy day goes out in one sweep. If a release fails, the error is logged and the drain goes on with the rest of the outbox. The announcement waits for the next drain.
- An edit or a cancel waits on the same row lock as a release. One that arrives as the announcement goes out is refused with "already sent". The messages it queued keep the text they had.
- An announcement counts toward the admin's daily limit on the day it is written, not the day it sends.
