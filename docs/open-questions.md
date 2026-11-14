# Open questions

Status: draft v1, 2026-11-11.

Each question lists what the design assumes until it is answered, so nothing here blocks building. "Who" says whether you can answer it or it needs the league owners. "When" is the latest point an answer is useful: **now** (changes Phase 1 work), **pitch** (ask at the owner meeting), **launch** (needed before real registration), **later**.

## Decided on 2026-11-11

| Decision | Choice |
|---|---|
| Mutations | Server Actions over a service layer; route handlers only for webhooks, jobs and feeds |
| Caching | Next.js 16 Cache Components |
| TypeScript | Strictest settings, branded IDs, typed results from domain functions |
| Styling | Tailwind v4 with shadcn/ui, plus hand-written CSS for animation |
| Sign-in | Google and email link, no passwords, 90-day renewing sessions; passkeys in Phase 2 |
| Multi-league | Later. `league_id` on tables now; no league in URLs |
| Workflow | Work goes through issues, small commits and rebase-merged pull requests |
| Tests | Full test suite as specified, including property-based tests |
| Running costs (2026-11-13) | Free services only: no paid plan, paid API key or monthly bill. No AI features, text messages, WhatsApp business alerts, Sign in with Apple or app-store listings ([ADR 0021](adr/0021-free-services-only.md)) |

## 1. Answer first

| # | Question | Assumed until answered | Who | When |
|---|---|---|---|---|
| 1 | Is the fee per team or per player, and how much? What are the roster minimum and maximum? | Both models are supported. Demo data uses $85 per player (the old site's price), minimum 12, maximum 20 | You, then owners | now |
| 2 | Does the league still run Fun and Competitive options? The 2025 rulebook describes one rule set (no stealing; bunting allowed); the old site describes two | One pool, one rule set. Divisions stay optional | You | now |
| 3 | How are nonbinary players counted under the "at most 6 of any gender on the field" and "no more than 2 of the same gender kick in a row" rules? | The player chooses which group they count with; the choice is visible only to their captain and admins | Owners | pitch |
| 4 | Is a 6-and-1 lineup legal? The rulebook lists 4-and-5 and 4-and-3 as the short-handed options but states only "at most 6 of any gender" and "at least 7 total" | Legal. The warning says "check with the ref" for anything outside the listed combinations | Owners | pitch |
| 5 | Summer doubleheaders: does every team play two games back to back each Sunday? How long is a summer slot? | Yes; 5 innings in a 60-minute slot | You | now |
| 6 | What are the standings tiebreakers and the playoff format (how many teams qualify, one day or two)? | Win percentage with a tie as half a win; then head-to-head; then run difference capped at 10 a game; then runs allowed; then coin flip. A forfeit counts as a win and a loss with no runs. Top 8 (or all teams if fewer), single elimination, one day | Owners | pitch |
| 7 | Who are the decision-makers, and when can you get a meeting? | A pitch the week of February 8, 2027 | You | now |

## 2. Money and legal (owners)

| # | Question | Assumed until answered | When |
|---|---|---|---|
| 8 | Does the league have an LLC, a tax ID and a Stripe account? Who will own the Stripe account? | The league owns it; you are added as a developer. Until then, test mode only | pitch |
| 9 | Does the "Amateur Athletic and Release of Liability" named in the rulebook exist as a document? Who wrote it? Is there an insurer with required wording? | A placeholder waiver in the demo, clearly marked as sample text. Real text is required before launch and should be reviewed by a lawyer | pitch |
| 10 | What is the refund policy before the season starts? | Full refund, minus the Stripe fee, until the schedule is published; none after | pitch |
| 11 | What is the rain-out rebate policy? You described a season where about half was rained out and about half the money came back | League credit, pro-rata, when more than 25% of a team's games are lost and not made up. Card refunds are possible but are the admin's choice | pitch |
| 12 | Should the league absorb Stripe's fee (about $2.77 on $85), or add it as a processing fee? | The league absorbs it | pitch |
| 13 | In split pay, what happens to money collected beyond the team fee when extra players join? | Team credit toward next season | pitch |
| 14 | Is the captain guarantee acceptable: a saved card charged for the unpaid balance at the deadline, after a 72-hour warning? | Yes, opt-in per team. Without it the team is unconfirmed until the balance is paid | pitch |
| 15 | Who can see birth dates and emergency contacts? | Owners see birth dates. Emergency contacts: a game's captains and ref, on that game's day only; not admins ([ADR 0042](adr/0042-emergency-contacts-sealed-and-shown-on-game-day.md)) | launch |
| 16 | Are terms of service and a privacy policy available, or should drafts be prepared for their review? | Drafts prepared, marked for legal review | launch |
| 17 | Minimum age: the rulebook says 18. Is it 21 for bar events? | 18 to play; event pages can state 21+ | launch |

## 3. Schedule and fields

| # | Question | Assumed until answered | Who | When |
|---|---|---|---|---|
| 18 | What are the real permit windows at McCarren: which fields, which hours, which dates? How far ahead are they known? | Partly answered (2026-11-12): play days change by season with the permits. Summer Sundays about 2 to 6 pm, spring Mondays about 8 to 10 pm, fall Tuesdays, usually evenings. Still to confirm: field counts and permit dates | Owners | launch |
| 19 | How many weeks is each season, and is there a set playoff Sunday? | 8 weeks of regular play plus one playoff Sunday | You | now |
| 20 | How does the league want makeup time reserved: spare slots each Sunday, a rain date at the end, or shortened games on a later Sunday? | All three are supported; the default is spare slots first, then a rain date, then a squeeze day | Owners | pitch |
| 21 | Do teams currently ask for early or late slots, or have known conflicts? | Captains can submit conflicts and preferences (Phase 2) | You | later |
| 22 | Does the Parks Department publish field closures on wet days, and does the league follow them? | The forecast rule alone, with an admin deciding | Owners | later |
| 23 | Is home and away ever needed for anything (dugout side, who kicks first in playoffs)? | No; rock-paper-scissors at the field, as the rulebook says | You | later |

## 4. Game day and referees

| # | Question | Assumed until answered | Who | When |
|---|---|---|---|---|
| 24 | How many referees work a game, and are they also players in the league? | One per game; often also a player, so they are never assigned during their own team's slot | You | now |
| 25 | Will the owners approve the referee marketplace (availability, accept and decline, pay tracking, incentives)? | Not built. An admin assigns refs by hand | Owners | pitch |
| 26 | How are refs paid today (cash, Venmo), and how often? | Tracked in the app, paid outside it | Owners | pitch |
| 27 | Should captains be able to enter a score when a ref is assigned, or only when there is none? | Either can enter; the ref's report wins | Owners | pitch |
| 28 | Is there a mercy rule or a cap on runs per inning? The rulebook does not mention one | None | You | now |
| 29 | Is the "golden ball worth 2 runs" from the old site still used? | Stored as a rule-set option, off by default | You | later |
| 30 | Should players who are suspended be blocked from RSVPs and sub requests automatically? | Yes (Phase 3) | Owners | later |

## 5. Communication

| # | Question | Assumed until answered | Who | When |
|---|---|---|---|---|
| 31 | Is the league WhatsApp a Community with an announcements channel, or one group? Can the join link be shown to registered players? | A join link is shown after registration if the league provides one | You | now |
| 32 | Will the owners approve an SMS program? | **Answered 2026-11-13: no.** Texts are billed per message, so notices go by email and free web push ([ADR 0021](adr/0021-free-services-only.md)) | — | — |
| 33 | What is the league's sending email address, and who controls the domain's DNS? Email deliverability needs DNS records added | `info@brooklynkickballclub.com`; DNS access arranged at launch | Owners | launch |
| 34 | Does the league have its own Instagram and Facebook? The current site links to another league's | Social links are hidden until real ones are supplied | You | launch |

## 6. Sponsors and events

| # | Question | Assumed until answered | Who | When |
|---|---|---|---|---|
| 35 | Which bar is the home bar now, and what is the current arrangement? | A placeholder bar in the demo | You | now |
| 36 | Would the bar display a check-in QR code and honor a deal shown on a phone? | Yes; the demo shows the flow | Owners, then the bar | pitch |
| 37 | Who picks the team of the week, and who pays its tab? | Admins pick; the sponsor funds it as part of the sponsorship | Owners | pitch |
| 38 | Are any events ticketed, or all free RSVPs? | Free RSVPs; paid tickets in Phase 3 | Owners | later |
| 39 | Are the suggested sponsorship tiers and prices in [roadmap.md](roadmap.md) in the right range? | Not shown publicly | Owners | later |

## 6a. Logo and photos

| # | Question | Assumed until answered | Who | When |
|---|---|---|---|---|
| 39a | Can the owners supply the logo file (ideally SVG), and do they agree to it appearing on the new site and demo? | The current logo is used on the BKC deployment and kept out of the public repository | Owners | pitch |
| 39b | Is the league's Instagram a professional (Business or Creator) account, and will an owner sign in once to connect it? Instagram's API only works for professional accounts, and only the account's owner can grant access | Not connected. The demo shows the feature with a handful of photos an owner has approved | Owners | pitch |
| 39c | Do players agree to appear in photos on the site? Is there a photo release in the waiver? | A photo release clause is added to the waiver draft for the league's lawyer to review, and any player can ask for a photo to be hidden | Owners | launch |
| 39d | Which photos may be used in the demo before Instagram is connected? | None until an owner says yes to specific posts. Photos are never copied from Instagram by scraping | You, then owners | now |

## 7. Jerseys

| # | Question | Assumed until answered | Who | When |
|---|---|---|---|---|
| 40 | Should shirts stay included, become optional, or change to "wear your team color"? You noted that shirts get lost and late joiners miss the order | Shirt size is collected; admins get a size list by team and a late-joiner list. No ordering in the app until Phase 3 | Owners | pitch |

## 8. Growth

| # | Question | Assumed until answered | Who | When |
|---|---|---|---|---|
| 41 | Is the affiliated football league interested in sharing the platform? | The data model allows a second league; nothing is built for it | You | later |
| 42 | Does the league want a public "friends of the league" page linking the softball, soccer, pool and other leagues its players are in? | Phase 3 | Owners | later |
| 43 | Is there a charity the league already supports? | None named; Phase 3 | Owners | later |
| 44 | Would the league run corporate or private events? | Phase 3, a lead form only | Owners | later |
| 45 | Which second park would the league want first, if permits allowed? | None; the model supports multiple venues | Owners | later |
| 53 | How much should a referral be worth, and to whom? | $10 of league credit to the player who shared the link, once the new player's first registration is paid; nothing to the new player | Owners | pitch |

## 9. Technical decisions for you

| # | Question | My recommendation | When |
|---|---|---|---|
| 46 | Keep `brooklynkickballclub.com`, or launch on a new domain? | Keep it; it carries the brand searches. Use a neutral demo domain until the owners agree | launch |
| 47 | Should the site offer Sign in with Apple? It needs a paid Apple Developer account | **Answered 2026-11-13: no.** Google, email link and passkeys cover sign-in ([ADR 0021](adr/0021-free-services-only.md)) | — |
| 48 | Should the repository be public from day one? | Yes, on the `michael-fesselmeyer` account. Keep league-specific data and the waiver text out of the repository | now |
| 48a | Does the league agree to its rulebook being published in a public repository? It is already public as a PDF on the current site, but nobody has asked | Keep the PDF and the full rulebook text out of git until they agree; the repository carries a short sample | now |
| 48b | Which model should the AI features use? | **Answered 2026-11-13: none.** There are no AI features, because every AI provider bills per use; the weekly recap is drafted from templates ([ADR 0021](adr/0021-free-services-only.md)) | — |
| 49 | Project name for the repository and the demo? | Something not tied to BKC, since the league is configurable, with BKC as the first deployment | now |
| 50 | Import existing accounts from the current site? | No. Players re-register, which also collects the waiver and current details | launch |
| 51 | Which free host serves the live league? Vercel's terms allow the Hobby plan only for personal or non-commercial use, and the league takes registration payments | No pick yet. The options and their free limits are in [architecture.md](architecture.md), section 15, "Hosting and commercial use": stay on Hobby if Vercel confirms it fits, or move to another free host such as Cloudflare Workers. A paid plan only if the maintainer authorizes it | launch |
| 52 | Should a second free email provider carry mail beyond Resend's free 100 a day? | Not yet. At 12 teams the outbox spreads large sends over days and leans on push; from 50 teams that is not enough for every reminder ([architecture.md](architecture.md), section 15) | launch |
