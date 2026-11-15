# 63. Publish only inside a documented permit

Date: 2026-11-15

## Status

Accepted

## Context

The scheduler places league games in slots cut from permit windows, but a slot can be entered without a permit, a window can be requested and never issued, a permit can be marked lost after the schedule is out, and hand-placed makeups and events at a park never went through the slot cutter at all. In each case the league can be on a field it doesn't hold while telling players it does (issue #407).

We had to decide what counts as holding a field, where the check runs, and what happens when it fails.

## Decision

- **What counts.** A permit window counts when it has an uploaded document and was not marked lost. Its status may still be "requested": the document is the proof. Windows on a field that touch or overlap count as one stretch, so a game across two back-to-back windows is covered.
- **One check.** `coverageGap` in `src/domain/permits/coverage.ts` is a pure function that returns why a span on a field isn't covered (no permit, lost, no document, starts before the permit, ends after it), and `gapSentence` says it in one line ("Field 3 is permitted until 8:00 PM; this game ends at 8:20 PM."). Everything below calls it.
- **Games are a hard constraint.** The scheduler's validator gains H12: a game still to play sits inside a usable permit. Saving any draft (generated, edited on the board, or a rain-out) judges it against the permits as they are then, so the draft shows the gap; publishing judges it again, because a permit can be lost while a draft waits. A draft with an H12 violation can't be published, like any other hard rule. Games already played are never judged.
- **Events.** An event can name one of the league's fields; pickups and practices must (new event kinds), unless marked "open play, no reserved field". Saving an event on a field checks the same rule; an open-play event skips it and its public page says it is open play.
- **After the fact.** The owners' permits screen lists every upcoming game or event that isn't covered. Marking a permit lost or removing a window emails the owners once about what newly lost its cover (`permit_alert`, kind `uncovered`), in the same transaction as the change.
- **The league's own bracket advance** is not held up by a gap elsewhere on the schedule: it publishes as before, and the permits screen and email cover the gap.
- **One override.** A league often holds its permits before anyone uploads the documents. When the only gap is a missing document, an owner or admin may publish the schedule, or save the event, anyway by typing a reason (10 to 300 characters, such as "Permit 1234 issued, PDF comes Monday"). It is kept in the audit log (`schedule.publish_override`, `event.permit_override`) with the gaps it waived. A lost permit, no permit, or hours that fall short are never overridden: those mean the league doesn't hold the field.

## Consequences

- A new season can't be published without its permits' documents unless someone signs for it with a reason. Admins see exactly which games are short and why, and the audit log shows every time the documents were waived.
- Existing schedules are not changed. Upcoming games on undocumented or lost permits show on the permits screen, and the next publish for that season is blocked until they are covered or moved.
- Test fixtures and the demo seed give their permits a document (`src/db/test/permits.ts`, `src/seed/books.ts`).
- The check reads every window on the fields involved; a season has tens of windows, so this stays one small query per save or page.
