# ADR 0061: The season ops checklist comes from a template

- Status: accepted
- Date: 2026-11-14

## Context

Running a season means the same jobs every time: renew the field permits, get the insurance certificate, open registration, book the bar for the season party, order shirts, line up refs, send the schedule and send the end-of-season survey. They are shared among a few owners and admins, and one forgotten job can hold up a season. A permit renewal is one example. The books already remind owners about permit and insurance dates ([ADR 0034](0034-owners-books-and-permits-in-postgres.md)), but the other jobs had nowhere to live.

The jobs repeat, but their dates move with each season's first day, and the people doing them change.

## Decision

**Each season gets its own checklist, copied from a league template.**

- `checklist_template_task` holds the league's recurring jobs. Each has a title, notes, a usual owner and `offset_days` from the season's first day. Owners edit it. The platform operator can too, as with the books. A league with an empty template gets a starter set of typical tasks, so there is always something to start from.
- `checklist_task` is one job on one season's checklist, with its own owner, due date, notes and done or not. Any owner or admin can see and change it. Starting a season's checklist copies the template with each due date set to `starts_on + offset_days`. A unique `(season_id, template_task_id)` makes starting twice harmless: the second start adds only tasks the template gained since.
- Season rollover offers to start the new season's checklist in the same transaction, ticked by default.
- The admin dashboard shows the next three open tasks.
- Reminders run as a daily job (`/api/jobs/checklist-reminders`), the only schedule the free plan allows ([ADR 0021](0021-free-services-only.md)). Each open task's owner gets one non-urgent `checklist_reminder` through the outbox in the 3 days before it is due, and one once it is overdue, for up to 30 days. A task with no owner reminds every owner, so an unassigned job can't slip quietly. The dedupe key includes the due date and the owner, so moving either sends afresh.

## Alternatives considered

- **One checklist per league, reset each season.** It's simpler, but it loses each season's record of who did what and when, and a season being set up overlaps the season being played.
- **Due dates fixed on the calendar.** Seasons start on different dates each year, so every date would need editing each season. An offset from the first day carries over.
- **Link each template task to its season tasks and update them when the template changes.** That would overwrite dates and owners admins had already set for this season. Changes to the template apply to seasons started afterwards, and "Add new tasks from the template" brings in new ones by choice.
- **Remind at a chosen time of day.** Scheduled jobs run once a day on the free plan, and these reminders aren't urgent.

## Consequences

- If owners remove every template task, the starter tasks come back. The template page says so.
- Reminders are emails only for now. The outbox would also send push for a topic that has it, but `operations` is email only.
- A task's owner must be an owner or admin when it is set. If that person later loses the role, the task still shows them, but its reminders go to the owners, as for a task with no owner.
- When a season's first day changes in season setup, its open tasks from the template move by the same number of days, in the same transaction. Tasks added by hand and done tasks keep their dates. A template task whose date an admin changed by hand still moves; the alternative was tracking which dates were edited, for little gain.
