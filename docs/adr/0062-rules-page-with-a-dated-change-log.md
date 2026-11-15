# ADR 0062: A rules page with a dated change log

- Status: accepted
- Date: 2026-11-15

## Context

When the league changed a rule, such as the fielding mix, the kicking order or the number of innings, players heard about it late or not at all. Teams ended up playing by different versions of the rules. There was no single place to read the current rules or to see what changed and when.

The league's rulebook stays out of the repository until the league agrees to publish it. The page needs the real rules, so the text has to live in the app's database, entered by admins.

## Decision

**Rules are sections that admins write in the app. Changing them means publishing a dated change.**

- `rule_section` holds the rules as they stand. A section keeps the slug it was created with, so links such as `/rules#lineups` from the kicking-order builder survive a new title.
- The only way to change the rules is to publish. Each publish adds a `rule_change` row with a one-line summary, the day it starts, and every section it added, edited or removed, with the text before and after. Rows are never removed, so the history is complete without a separate versions table.
- A publish is refused as stale when someone else published after the editor was opened. Publishes for a league queue on an advisory lock and compare the newest change's id. The editor comes back with the admin's text to copy from.
- A change can be marked for notice. Its start date must then be at least 3 days after today in the league's time zone. Publishing queues one non-urgent email for each player registered in a season that is open or under way, through the outbox, saying when the change starts. It uses the `announcement` topic, so it respects each player's email settings, quiet hours, daily cap and the email quota ([ADR 0021](0021-free-services-only.md)).
- The public `/rules` page is static HTML read inside `use cache`. Publishing expires it. Each division's rule-set settings (innings, time limit, bunting, stealing) show on it automatically, and a division change expires the page through `refreshSeasonPages`.
- Text is plain: blank lines make paragraphs, and lines starting with "- " make a list. Nothing an admin types is read as HTML.

## Alternatives considered

- **Keep the rules in a Markdown file in the repository.** That would put the rulebook in the repository, and only someone with commit access could change it.
- **A rich-text editor.** It would add client JavaScript to a page admins rarely open, and stored HTML to sanitize on the public page. Plain text with paragraphs and lists covers a rulebook.
- **Keep the newest text only, and edit sections freely.** That loses the "what changed" history players need, and when the change happened.
- **Send the notice on the start date, or a set number of days before it.** It would need a scheduled send per change. Sending when the change is published, at least 3 days ahead, gives the same warning with nothing to schedule.

## Consequences

- A change publishes its text at once, even when it starts later. The page labels the section "New wording from" its start date, and the change log says when it starts.
- Sections keep their order. A new section goes at the end, and reordering is left for later.
- The notice period is 3 days for every league, set in code (`NOTICE_DAYS`). A league that wants a longer notice picks a later start date.
- The demo seed publishes sample rules that are clearly invented, so the page has content in the demo and in Lighthouse runs.
- Each league has its own rules, change log and page, like its other public pages ([ADR 0048](0048-several-leagues-on-one-deployment.md)). The default league's page is `/rules`, and another league's is `/l/<slug>/rules`. A publish refreshes its own league's page at once, and the notice links to that page.
