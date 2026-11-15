# 0066. Other groups on a field

## Status

Accepted

## Context

Other permit holders use the same fields before and after the league, and sometimes two groups hold a permit for the same time. Game-day crews need to know who comes next, when, and whom to call, and admins need to hear about an overlap early enough to sort it out with the permit office. The group's contact is a person's phone or email, so it must stay with the league's admins.

## Decision

- **Two small tables, not columns on the field.** `field_group` holds each group's name, usual weekdays, usual hours and optional contact; `field_overlap` holds a day an admin recorded two groups holding the same time. A field can have many groups, and a group with no usual hours is just a name.
- **Hours are a local wall clock, turned into instants day by day.** Each group's span for a day is built with the league's time zone, so a group that runs past midnight spills into the next day and daylight saving moves neither the start nor the countdown. The countdown compares instants.
- **The handover is worked out against the league's permit hold.** For a field and day the hold is the first start to the last end of the league's permit windows (open slots when there are none; nothing when every slot is cancelled). A group on before us hands over when our hold starts, one on after takes over when it ends, and hours that cut into ours show as an overlap.
- **Overlaps are recorded, not guessed.** Usual hours are approximate and often wrong for a given week, so a warning needs an admin to say a day is a problem. The warning stays listed but goes quiet when that day is rained out, blacked out or the permit is lost, so nobody phones the permit office about a day that is not happening.
- **The contact is admin-only by construction.** The only readers of the tables are the fields screen and the game-day screen, both behind `season.manage`, and a test fails if any other file imports them. The audit log keeps only whether a contact was set.
- **The borough office comes from the existing permits data.** The venue's nearest NYC Parks field gives the borough, and `officeFor` gives the number; a venue Parks' data does not place gets the page that lists the offices.
- **A problem on the day is an incident.** The game-day card links to the incident form with the park rule "Sharing the space" chosen, so these are counted with the season's other park-rule incidents.

## Consequences

- No new service and no cost: the data is two tables and the NYC Parks numbers already in the repository.
- A weekly pattern is as far as "usual hours" goes. A group that keeps different hours in some weeks is handled by recording the overlap for that day, not by editing the pattern.
- The countdown ticks on the phone from the day's list, so the game-day screen needs no extra polling.
