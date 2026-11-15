# ADR 0076: Acting admin: powers handed over for set dates

- Status: accepted
- Date: 2026-11-15

## Context

When the organizers are away, schedules, standings and rain calls should not stall. Making someone an admin for good is too much: admin is a standing role, it sees money, and someone has to remember to take it back.

## Decision

**A handover is its own record, not a role.** An owner names a player for a date range with a chosen set of powers (`acting_admin`: person, powers, `starts_at`, `ends_at`, `ended_at`). The player's role in `league_member` never changes, so nothing has to be remembered or undone: the grant gives nothing before it starts, from its end date, or once an owner ends it.

**Powers are named bundles of matrix actions.** `ACTING_POWER_ACTIONS` (`src/domain/authz/acting-admin.ts`) lists the actions each power opens: game day, scores, rain-outs, schedule, teams and rosters, announcements, discipline. An action no power lists can never be reached by a handover: refunds and recording payments, exports, merging accounts, the audit log, the books, the owner dashboard, private lists, concerns and every owner action, including this one, stay with admins and owners. A test walks every action in the matrix and checks an acting admin gets exactly their own rights plus the listed actions, and nothing else.

**The check lives in `can`.** `loadSubject` adds the powers whose dates include now, for a person whose role is player; `can` runs an action's own rule again as an admin when a power lists it. Every page and Server Action that already asks the matrix honors a handover, and no code reads a grant any other way. Rain-out confirmation, which admins may do only when the owners allow it, also opens to a person the owners handed rain-outs to, since naming that power is the same choice.

**Overlap, expiry and deletion need no job.** Overlapping handovers add their powers while each lasts. The dates are read at the moment of each request, so access ends to the minute. Deleting an account ends its handovers and the account can no longer sign in. A handover is capped at 90 days; an owner makes a new one to go on.

**Actions are audited under the acting admin's name.** An acting admin's changes go through the same code as an admin's, so each audit row names them. Granting and ending a handover are `acting_admin.grant` and `acting_admin.end` rows.

**Notices.** The acting admin and every owner get an urgent `acting_admin` message when a handover starts and when it ends (by date or ended early). A handover that starts now or ends now sends at once; one that starts or ends on a later date is sent by a job that runs twice a day, because the free hosting plan runs each scheduled job once a day at most (ADR 0021). The access itself never waits for the job.

## Alternatives considered

- **Promote to admin for the dates and demote after.** Needs a job to demote; a missed run leaves an admin behind, and the admin sees everything, including money.
- **Per-action checkboxes.** More precise, but owners would have to know the matrix; bundles named for what the organizers do are easier to choose and audit.
- **Hourly notices.** Exact, but needs a paid cron plan.
