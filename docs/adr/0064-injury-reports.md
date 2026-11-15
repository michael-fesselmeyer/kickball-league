# ADR 0064: Injury reports are incidents with the least health data

- Status: accepted
- Date: 2026-11-15

## Context

Incident reports cover conduct. When someone is hurt at a game the league needs a proper record: insurance carriers ask for one, and a claim can arrive long after the season. The details are health information, so the league should keep as little as it can, let as few people read it as it can, and delete it when it has no use.

## Decision

**An injury is an incident whose kind is "injury", with a small extra record, read only by owners and admins, and deleted three years after it was filed.**

- It is built on the incident feature. The same people file it (the game's ref, either captain or an admin, from kickoff on, under `incident.log`), it has the same status and it appears in the same review queue. Its form is separate (`/app/games/[game]/incident/injury`), because it asks for different things, and the general form refuses the injury kind.
- Only the minimum is stored. `injury_report` holds who was hurt (a player in the game), the body area and the care given (none, first aid, EMS); the last two are fixed lists. `injury_witness` holds up to six people from the game. What happened is the incident's text, at most 1,000 characters (a database check), and the form asks for no diagnosis. Follow-up notes are the incident's existing admin notes.
- Only owners and admins read it, export it or delete it: the permissions `injury.read` and `injury.delete`, both admin-only, with matrix tests. The people who filed it can't open it again. An injury names no one in `incident_person`, so it never leads to a suspension.
- Every view, export and deletion writes an audit row (`injury.view`, `injury.export`, `injury.delete`), and filing writes the usual `incident.file`. None of these rows holds a health detail.
- **Retention: three years.** A daily job (`/api/jobs/injury-retention`) deletes the injury, its witnesses, the follow-up notes and the text of every report older than three years, and an admin can delete them at any time from the report. The incident stays, with its game, date and status, so the league still counts it. Three years is the usual time limit in New York for an adult to bring a personal injury claim, so the record outlives the time it would be asked for. This is a judgment, not legal advice; if the league's insurer asks for longer, the constant changes. A different period is one constant, `INJURY_RETENTION_YEARS`.
- The insurance export is a CSV from the report page (`/injury.csv`), with a line for each fact and the insurer, policy number and dates of the league's insurance certificate in force on the game's day, or the one that ran out last, saying whether it was in force. Text cells are guarded against spreadsheet formulas.
- Notifications carry no health details. Filing queues one urgent message to each other owner and admin: "A report was filed for Aces vs Bees", with a link that needs an owner or admin to open. It does not say the report is an injury.
- A person's data export leaves injury reports out: owners and admins hold them for the league and its insurer, and a copy in the person's own export could reach a shared device. Deleting an account clears who was hurt and drops the person as a witness.

## Alternatives considered

- **Store the injury on the incident row.** It would put health columns on a table that every incident reader reads. A separate table keeps them away from the review queue's queries and makes removal a single delete.
- **Encrypt the details at rest** (as emergency contacts are, [ADR 0043](0043-emergency-contacts-sealed-and-shown-on-game-day.md)). The details are read by admins in the app, never matched on, and deleted on a schedule, so the database's own protection and the short retention serve; the audit log covers who read them. It stays an option if an insurer asks.
- **Keep reports for seven years, the usual business-records period.** Longer than a claim can be brought, for health details the league has no other use for.
- **Email the details to the owners.** Email is not private. The message says only that a report was filed.

## Consequences

- Adding the `injury` kind and two tables is a schema change (the `schema` label).
- The review queue lists injuries by kind and game, with no text, so an admin has to open one to read it, and that opening is audited.
- The daily job is one more entry in `vercel.json`.
- An owner can't recover a deleted injury report. That is the point; the audit log keeps who deleted it and why.
