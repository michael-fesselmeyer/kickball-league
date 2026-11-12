# SEO plan

Status: draft v1, 2026-11-11.

## 1. Goal and honest expectations

Be the first result people in Brooklyn find when they look for adult kickball, and show up for wider New York City searches.

| Search | Realistic outcome | Why |
|---|---|---|
| "Brooklyn kickball", "kickball Brooklyn league", "McCarren Park kickball", "kickball Williamsburg" | Top 3 within a season | Few competitors, strong local relevance, and the current site already holds the brand name |
| "NYC kickball league", "kickball NYC", "adult kickball New York" | First page within 6–12 months | Large multi-sport companies hold these today; a focused, fast, locally linked site can sit beside them |
| "kickball near me" | Map results in north Brooklyn | Driven by the Google Business Profile and reviews, not the website alone |
| "kickball" | Not a target for position | A single-word national term owned by encyclopedias and national bodies. The rules and "how to play" content can still earn visits from longer questions |

I have no search-volume data for these terms. The first task after launch is to connect Google Search Console and adjust this plan to what people actually type.

## 2. Keywords and the page each maps to

One primary page per intent, so pages do not compete with each other.

| Keyword group | Example searches | Page | Page's job |
|---|---|---|---|
| Brand | brooklyn kickball club, BKC kickball | `/` | Confirm this is the league; route to join |
| Core local | brooklyn kickball, kickball league brooklyn, adult kickball brooklyn, coed kickball brooklyn | `/` | Say what, where, when and how much above the fold |
| City-wide | nyc kickball league, kickball nyc, adult kickball new york, kickball league manhattan | `/nyc-kickball-league` | An honest city-wide page: a Brooklyn league open to all five boroughs, with travel times by subway line |
| Park and neighborhood | mccarren park kickball, kickball williamsburg, kickball greenpoint, sports leagues near mccarren park | `/parks/mccarren-park` | Fields, map, transit, what Sundays look like, the home bar nearby |
| Joining | join a kickball team nyc, kickball free agent, sign up for kickball alone, kickball teams looking for players | `/free-agents` | Explain solo signup and the matching quiz |
| Season and price | kickball spring league brooklyn, summer kickball league nyc, kickball league cost | `/seasons` and `/seasons/[season]` | Dates, price, format, register |
| Rules | kickball rules, adult kickball rules, kickball bunting rules, how many players in kickball, coed kickball rules | `/rules` | The full searchable rulebook, with a plain-language summary at the top |
| How to play | how to play kickball, kickball positions, kickball strategy | `/news/how-to-play-kickball` (a guide) | Evergreen guide that links to rules and joining |
| Social | things to do in brooklyn sunday, meet people in brooklyn, social sports brooklyn, adult sports leagues brooklyn | `/about` and `/events` | The "meet people in real life" story, with the events calendar |
| Results | [team name] kickball, brooklyn kickball standings, kickball scores | `/teams/[team]`, `/seasons/[season]/standings` | Fresh, linkable pages that players share |
| Sponsor | [bar name] kickball, kickball bar williamsburg | `/sponsors/[sponsor]` | Deals and the after-game plan; earns a link back from the bar |
| Referee | kickball referee jobs nyc, umpire kickball | `/refs` | Recruit refs |
| Corporate (P3) | corporate kickball nyc, team building kickball brooklyn | `/corporate` | Lead form |
| Questions | is kickball coed, what to wear to kickball, how long is a kickball game | `/faq` | Short answers that link deeper |

Rules for landing pages: each must hold information that exists nowhere else on the site. A second park gets a park page when the league plays there, not before. Pages that only swap a neighborhood name into the same text get ignored or penalized, so they are not built.

## 3. Technical SEO

| Item | Plan |
|---|---|
| Rendering | Every public page is server-rendered into a static shell (see [architecture.md](architecture.md)); all content is in the HTML |
| Core Web Vitals | Budgets in [design-system.md](design-system.md): LCP ≤ 2.0s, INP ≤ 150ms, CLS ≤ 0.05 on phones, enforced in CI |
| Titles and descriptions | Generated per page with `generateMetadata`. Pattern: "Schedule · Spring 2027 · Brooklyn Kickball Club". Unique on every page, under about 60 and 155 characters |
| Canonical URLs | One canonical per page; lower-case, hyphenated, no trailing slash; filters and sort orders are not indexable |
| Sitemap | `sitemap.ts` lists every public page with its last-modified time; split by type if it passes a few thousand URLs |
| Robots | `robots.ts` allows public pages and disallows `/app`, `/api` and preview deployments. Preview and demo deployments send `noindex` |
| Redirects | Every URL on the current site maps to its replacement with a 301: `/Home` to `/`, `/Join` to `/seasons`, `/Account/Registration` to `/sign-up`, `/Account/Login` to `/sign-in`, and the rulebook PDF to `/rules` |
| Domain | Keep `brooklynkickballclub.com` so existing links and brand searches carry over; choose one host (with or without `www`) and redirect the other |
| Open Graph and share cards | An image for every game and team (built: `/games/[game]/share.png` and `/teams/[team]/share.png`), plus a default (to come); titles written for sharing in WhatsApp, such as "Foul Play 8, The Big Kicks 6". Each page links its image with a version of the data it shows, so a link preview changes only when the score, status, time, place or record does. Images stay under 300 kB, the size above which WhatsApp drops the preview |
| Internal links | Game pages link to both teams and the park; team pages link to games and the season; every page reaches Join in one tap |
| Headings and landmarks | One `h1` per page, ordered headings, real lists and tables; this serves accessibility and search equally |
| Images | Descriptive `alt` text, explicit dimensions, modern formats |
| Past seasons | Old seasons stay online at stable URLs. Every result and recap is a permanent, indexable page that keeps earning visits |
| Calendar feeds and JSON endpoints | Not indexed |

### Structured data

Added as JSON-LD and validated in CI against the schema.org types.

| Type | On | Key properties |
|---|---|---|
| `SportsOrganization` | Home, About | name, sport ("Kickball"), logo, url, email, telephone, `areaServed` (Brooklyn, New York City), `sameAs` (social profiles), location |
| `WebSite` | Home | name, url |
| `SportsTeam` | Team pages | name, sport, logo, `memberOf` the league, coach (the captain, only if they opt in) |
| `SportsEvent` | Game pages | name, startDate, endDate, `eventStatus` (scheduled, postponed, cancelled), location, `homeTeam` and `awayTeam` as competitors, organizer |
| `Event` | Social event pages | name, dates, location, offers (price, availability), organizer, `eventAttendanceMode` |
| `Place` or `Park` | Park pages | name, address, geo, map link |
| `BarOrPub` (a `LocalBusiness` type) | Sponsor bar pages | name, address, geo, url, opening hours if the bar supplies them |
| `FAQPage` | FAQ | questions and answers. Google now shows FAQ rich results for few sites, so this is for clarity to machines, not for a visual result |
| `BreadcrumbList` | Deep pages | The path |
| `Article` | News and recaps | headline, datePublished, author, image |

`LocalBusiness` is used for the sponsor bars, which have premises. The league itself is a `SportsOrganization` with an area served, because it has no storefront.

`SportsEvent` status matters here: when a game is rained out, its page and markup change to "postponed" with the new date, which is exactly what a searcher on a wet Sunday morning wants.

## 4. Content plan

| Content | Purpose | When |
|---|---|---|
| **HTML rulebook** replacing the PDF | Rank for rules questions; each rule number has its own link; search within the page; a plain-language summary first | MVP |
| **Home page** that answers what, where, when, price | Core local terms | MVP |
| **Park page: McCarren Park** | Park and neighborhood terms; directions by subway line (G to Nassau Av, L to Bedford Av), where fields are, what to bring | MVP |
| **FAQ** | Long-tail questions; reduces emails to the commissioners | MVP |
| **Season pages** with dates and price | Seasonal terms; kept online after the season ends | MVP |
| **City-wide landing page** | NYC terms | P2 |
| **Free-agent page** | Joining terms | P2 |
| **Weekly recap** (auto-drafted from scores: results, standings moves, game of the week; an admin adds color) | Fresh content weekly; players share it | P2 |
| **Season recap and champions page** | History, internal links, shareable | P2 |
| **"How to play kickball" guide** | Evergreen entry point | P2 |
| **Event pages** | Social terms; each event is an indexable page | P2 |
| **Team pages with history** | Team-name searches | MVP, history in P2 |
| **"Friends of the league" page** linking local leagues the players also play in | Local relevance and link exchange | P3 |
| **Photo galleries** | Image search, time on site | P3 |

Writing rules: answer the question in the first two sentences; use the words people search with ("kickball league", "Brooklyn", "coed", "adults"); name real places; put the price on the page.

## 5. Off-site

| Action | Detail | Owner |
|---|---|---|
| **Google Business Profile** | Create or claim it as a service-area business (category "Sports league" or nearest; area: Brooklyn). Add hours (Sundays), photos, the website, and a post per season. This drives map results and "near me" | League owner; needs their Google account |
| **Reviews** | After each season, email players a one-tap link to leave a Google review | League, automated ask in P2 |
| **Consistent name, address, phone** | The same league name, phone (929-251-5187 today) and email everywhere, matching the site footer | League |
| **Fix the social links** | The current site links to a different league's Facebook and Twitter. Create or claim the league's own Instagram and Facebook and link those | League |
| **Sponsor bar links** | Each sponsor agreement includes a link from the bar's website and a tag in their Instagram posts. The QR check-in poster carries the site address | Sponsorship terms |
| **Local citations** | List the league where New Yorkers look for things to do and for adult sports leagues: neighborhood blogs and newsletters for Greenpoint and Williamsburg, "things to do" calendars, Meetup, Eventbrite for social events, Yelp, Nextdoor, Reddit's NYC and Brooklyn communities where rules allow | League, with a checklist |
| **Friends of the league** | Trade links with the leagues players already overlap with (softball, soccer, pool, football) | League |
| **Press** | One pitch a year to local outlets around opening day or the charity game | League |
| **Park permits** | Ask whether permitted leagues can be listed on any Parks Department or conservancy page | League |

## 6. Measuring

| Tool | What to watch |
|---|---|
| Google Search Console | Impressions, clicks and position for the keyword groups above; indexing errors; Core Web Vitals report |
| Vercel Speed Insights | Real-user LCP, INP and CLS by page |
| Vercel Web Analytics | Visits by landing page; the path from landing to registration |
| Google Business Profile | Searches, calls, direction requests |
| In-app | "How did you hear about us?" at registration, one optional question |

Review monthly in season. The first review after launch decides which P2 content gets written first.
