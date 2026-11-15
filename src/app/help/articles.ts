import type { HelpEntry } from "@/domain/help/search";

/**
 * The help center's how-tos, one list per role. Each is written from what
 * the app does today: a button's words are quoted as the screen shows them.
 * When a screen changes, its how-to here changes in the same pull request.
 */

export type HelpArticle = {
  /** The anchor on its role's page: /help/<role>#<id>. */
  id: string;
  title: string;
  /** One sentence, shown in the list and the search results. */
  summary: string;
  steps: readonly string[];
  /** Short notes after the steps. */
  notes?: readonly string[];
  /** Where to do it in the app. */
  screen?: { href: string; label: string };
  /** Other words people search with. */
  keywords?: readonly string[];
};

export type HelpRole = {
  slug: "player" | "captain" | "ref" | "admin" | "owner";
  title: string;
  /** Who the page is for. */
  intro: string;
  articles: readonly HelpArticle[];
};

export const HELP_ROLES: readonly HelpRole[] = [
  {
    slug: "player",
    title: "Players",
    intro: "Joining a team, paying, saying if you're coming, and your alerts.",
    articles: [
      {
        id: "sign-up",
        title: "Sign up for a season",
        summary:
          "Join a team from your captain's invite link, or sign up solo as a free agent.",
        steps: [
          "On a team: open the invite link your captain shared. Sign in with your email, a passkey or Google, then tap to join.",
          "Solo: open the season from the home page, choose to join as a free agent, and take the five-question team-fit quiz. A friend code keeps up to four friends together.",
          "Confirm your profile: name, shirt size, birth date and an emergency contact.",
          "Read and sign the season's waiver.",
          "Pay, if your team splits the fee or you're a free agent. Your season page shows each step with a check when it's done.",
        ],
        notes: [
          "You need to meet the season's minimum age, shown when you register.",
          "Free agents are placed on a team by the league, and you're emailed when it happens.",
        ],
        screen: { href: "/app", label: "Your home" },
        keywords: [
          "register",
          "join",
          "invite",
          "free agent",
          "waiver",
          "account",
        ],
      },
      {
        id: "pay",
        title: "Pay your share",
        summary:
          "Pay your fixed share of the team fee by card, Apple Pay or Google Pay, with any promo code or league credit.",
        steps: [
          "Sign the waiver first. Payment opens once it's signed.",
          'Open your season page. The "Pay" step shows what you owe.',
          'Add a promo code if you have one. League credit is used automatically; untick "Use my league credit" to keep it.',
          'Tap "Pay securely with Stripe" and finish on Stripe\'s page.',
        ],
        notes: [
          "If your captain pays the whole team fee, the step says so and there's nothing to pay.",
          "Paid a teammate in cash? Your captain can record it on the team page.",
        ],
        screen: { href: "/app", label: "Your home, then your season" },
        keywords: [
          "money",
          "fee",
          "stripe",
          "card",
          "promo code",
          "credit",
          "owe",
        ],
      },
      {
        id: "rsvp",
        title: "Say if you're coming (RSVP)",
        summary:
          "Tap In, Maybe or Out for each game so your captain knows who's playing.",
        steps: [
          "Open your team page from your home screen.",
          'Under each game still to come, tap "In", "Maybe" or "Out". The one you picked stays dark.',
          "Change it any time before the game. Your captain sees the count and whether the team can field a full lineup.",
        ],
        notes: [
          'Away for a few weeks? Use "Away some weeks? Mark them" on the team page, and your captain sees it for every game in those weeks.',
        ],
        screen: { href: "/app", label: "Your home, then your team" },
        keywords: ["attendance", "in", "out", "maybe", "away", "vacation"],
      },
      {
        id: "subs",
        title: "Find a sub, or be one",
        summary:
          "Tell your captain you're out so they can ask for a sub, or pick up a game for a team that's short.",
        steps: [
          "Can't make a game? Tap \"Out\" on your team page. Your captain asks the league for subs; you don't need to find one yourself.",
          'Want to play more? Open "Sub for a team" from your home. Teams that are short post there.',
          "Tap \"I'm in\" to hold a spot. The captain confirms, and you get an email when you're playing.",
          'Plans changed? "Drop out" (or "I can\'t make it" once you\'re confirmed) opens the spot again.',
        ],
        notes: [
          "To sub you need to be registered this season with a signed waiver, and not playing or refereeing at that time.",
          "Sub alerts are on unless you turn them off in your profile.",
        ],
        screen: { href: "/app/subs", label: "Sub for a team" },
        keywords: ["substitute", "short", "pickup", "fill in"],
      },
      {
        id: "install",
        title: "Install the app on your phone",
        summary:
          "Add the league to your home screen so it opens like an app and keeps your next game for when there's no signal.",
        steps: [
          'iPhone: open the site in Safari, tap "Share", then "Add to Home Screen".',
          'Android: in Chrome, open the menu and tap "Install app" (or "Add to Home screen"). Captains, refs and admins may also see an "Install" button on their home screen.',
          "Open the league from your new icon and sign in once.",
        ],
        notes: [
          "Your next game stays on the phone, so it opens at the field with no signal.",
          "There's nothing to download from an app store and nothing to pay.",
        ],
        keywords: [
          "pwa",
          "home screen",
          "offline",
          "iphone",
          "android",
          "download",
        ],
      },
      {
        id: "alerts",
        title: "Turn alerts on or off",
        summary:
          "Choose which emails and phone notifications you get, and when the non-urgent ones arrive.",
        steps: [
          "Open your profile from your home.",
          'Under "Email settings", tick the emails you want and tap "Save email settings". Sign-in links always come.',
          'Under "Push notifications", tick topics and tap "Save push settings". Your browser asks to allow notifications. "Turn off push on this device" stops them on this phone.',
          'Under "How often we message you", set a daily limit, a daily or weekly digest, and quiet hours.',
        ],
        notes: [
          "Urgent messages, such as a rain-out on your game day, still come during quiet hours, without a sound.",
        ],
        screen: { href: "/app/profile#notifications", label: "Your profile" },
        keywords: [
          "notifications",
          "email",
          "push",
          "quiet hours",
          "digest",
          "unsubscribe",
        ],
      },
    ],
  },
  {
    slug: "captain",
    title: "Captains",
    intro: "Running your team: the roster, the kicking order, scores and help.",
    articles: [
      {
        id: "invite",
        title: "Invite players",
        summary:
          "Share one invite link in your team chat; each player joins, signs the waiver and pays their own share.",
        steps: [
          'Open your team page. Under "Invite players", tap "Make an invite link", then "Copy link" or "Share on WhatsApp".',
          "Share it in your team chat. Each player signs in, joins, signs the waiver and, on a split fee, pays their share.",
          "Watch the roster fill in: who has joined, signed the waiver and paid.",
          "Teammate paid you in cash or by another app? Record it beside their name.",
        ],
        notes: [
          "Making a new link stops the old one working.",
          'Need someone kept off your team? Add them to the private "Not on my team" list on the same page.',
        ],
        keywords: ["roster", "invite link", "add players", "whatsapp"],
      },
      {
        id: "lineup",
        title: "Build a kicking order",
        summary:
          "Set the order from the players who said they're in, with the two-in-a-row rule checked as you go.",
        steps: [
          'On your team page, tap "Set kicking order" on a game not yet played.',
          "The builder lists who's in, then any approved subs, with the side each counts toward.",
          "Drag a row by its handle, or use the up and down buttons. With a keyboard, pick a row up with Space and move it with the arrow keys.",
          'Breaks of the two-in-a-row rule are named as you go. "Auto-arrange" fixes the order with as few moves as it can; "Copy last game" starts from your last saved order.',
          "Save. Each player sees their spot on the team page, and on game day the ref and the other captain see the order.",
        ],
        keywords: ["batting order", "lineup", "order", "gender rule"],
      },
      {
        id: "scores",
        title: "Enter and confirm scores",
        summary:
          "Report the final score, then the other side confirms it; disputes go to the league.",
        steps: [
          'After kickoff, open the game from your home and tap "Score". With no ref, you can also score it live, half-inning by half-inning.',
          "Enter both scores and whether it was played to the end or called early, then save.",
          'The other team\'s captain (or either captain, when a ref reported it) taps "Confirm" or "Dispute" with a note.',
          "A confirmed score is final at once. With no answer, it's final on the date shown unless someone disputes it.",
        ],
        notes: [
          "No signal at the field? The score is saved on the phone and sent when you're back in range.",
          "Once it's final you can rate the other team's sportsmanship.",
        ],
        keywords: ["score", "result", "confirm", "dispute", "final"],
      },
      {
        id: "co-captains",
        title: "Co-captains and handing over the team",
        summary:
          "Share the team's tools with co-captains, or hand the captaincy to a teammate.",
        steps: [
          'On your team page, open "Captain and co-captains".',
          '"Make co-captain" gives a teammate the team\'s tools: kicking orders, sub requests, scores, payments and the private list. "Make a player" takes them back.',
          'To hand the team over, pick a teammate and tap "Offer the captaincy". You can withdraw it until they answer.',
          'When they tap "Become captain", they lead the team and you stay on as a co-captain, which you can step down from.',
        ],
        notes: ["Each change emails the teammate."],
        keywords: ["co-captain", "handoff", "transfer", "captaincy"],
      },
      {
        id: "find-subs",
        title: "Ask for subs",
        summary:
          "Short for a game? Post a sub request and approve who claims it.",
        steps: [
          'On your team page, tap "Find subs" (or "Short? Find subs" on a game).',
          "Pick the game, how many you need and, if it matters, how many of them should be women or men. Add a note.",
          'Eligible players are emailed, free agents first. When one taps "I\'m in" you get an email.',
          "Approve or decline each claim. The request closes at game time.",
        ],
        notes: ["Sub requests aren't offered for playoff games."],
        keywords: ["substitute", "short", "pickup"],
      },
    ],
  },
  {
    slug: "ref",
    title: "Refs",
    intro:
      "Your games, live scoring at the field, and reporting what happened.",
    articles: [
      {
        id: "game-day",
        title: "Game day",
        summary:
          "Check in at the field, see both kicking orders and open the score screen.",
        steps: [
          "Your home shows \"Games you're refereeing\" with time, field and each team's approved subs.",
          "At the field, tap \"I'm at the field\" so the league knows you're there.",
          '"Kicking orders" shows both teams\' orders on game day, and whether each keeps to the rule.',
          'From kickoff, "Score" opens the score screen. The park permit and everyone\'s emergency contacts are a tap away on game day.',
        ],
        notes: ["Install the app so your next game opens with no signal."],
        screen: { href: "/app", label: "Your home" },
        keywords: ["referee", "check in", "assignment", "permit", "emergency"],
      },
      {
        id: "live-scoring",
        title: "Live scoring",
        summary:
          "Tap the runs after each half-inning; the public game page follows along.",
        steps: [
          "On the score screen, open live scoring and choose who kicks first.",
          "After each half-inning, tap its runs (0 to 7, or type a number). Fix any half by changing its runs, or take back the last one.",
          'End with "Game over" to report every run, or "Called after the" Nth inning to report the score at the last complete inning (at least 4).',
          "Either becomes the reported score, and the captains confirm it.",
        ],
        notes: [
          "No signal? Runs are kept on the phone and sent when you're back in range.",
          "The public game page shows the line score within about 15 seconds.",
        ],
        keywords: ["score", "innings", "runs", "called game", "offline"],
      },
      {
        id: "incidents",
        title: "Report an incident",
        summary:
          "Tell the league about an ejection, a safety problem or anything else, from kickoff on.",
        steps: [
          "From the score screen, follow the link to report an incident.",
          "Pick what kind: ejection, forfeit-related, unsportsmanlike conduct, outside alcohol at the sponsor bar, safety, or other.",
          "Tick the people involved from either team and say what happened.",
          "Send it. Admins review every report and decide on any suspension.",
        ],
        notes: ["Either captain and admins can report one too."],
        keywords: ["ejection", "safety", "conduct", "suspension", "report"],
      },
    ],
  },
  {
    slug: "admin",
    title: "Admins",
    intro: "Setting up a season, the schedule, rain-outs and game day.",
    articles: [
      {
        id: "season-setup",
        title: "Set up a season",
        summary:
          "Create the season, set its prices, dates and rules, and open registration.",
        steps: [
          'Under Seasons, tap "New season", or start from last season with "Rollover" to bring its teams along.',
          "Fill in the setup: dates, pricing and fee model, roster limits, registration window, payment deadline and the minimum age.",
          "Add the waiver, divisions and rule set if the season uses them, and any promo codes.",
          "Add fields, permit windows and blackout dates under Fields, so the scheduler knows when games can be played.",
        ],
        notes: [
          "Teams' scheduling requests come in until registration closes; read them under Requests before you generate.",
        ],
        screen: { href: "/app/admin/seasons", label: "Seasons" },
        keywords: [
          "new season",
          "registration",
          "pricing",
          "fields",
          "rollover",
          "waiver",
        ],
      },
      {
        id: "schedule",
        title: "Make and publish the schedule",
        summary:
          "Generate a draft, check its numbers, adjust it, then publish.",
        steps: [
          'Open the season\'s Schedule screen and tap "Generate" to make a draft from the season as it stands.',
          "Check the draft's problems and metrics, and the scheduler's notes.",
          'Move or swap games with the form, or on a desktop drag them on the schedule board. "Save as a new draft" keeps your changes as a new version.',
          "Publish the version. The public schedule, team pages, calendar feeds and the schedule widget update.",
        ],
        notes: ["A version that breaks a hard rule can't be published."],
        keywords: ["generate", "publish", "draft", "board", "fixtures"],
      },
      {
        id: "rain-outs",
        title: "Call a rain-out",
        summary:
          "Cancel a game day, review the makeup games, then publish and let players know.",
        steps: [
          "The day before game day, a weather watch alert links to the season's Rain-out screen. You can also open it any time.",
          "Pick the date. The preview lists the games affected, their makeups and how fairness changes.",
          'Tap "Cancel" for that day "and save these makeups as a draft". Nothing is sent yet.',
          "Publish the draft on the Schedule screen. Each player on a moved team is emailed their makeup time.",
          "Copy the ready-made message for the league chat after you publish.",
        ],
        notes: [
          "The app never cancels on its own; the call is always yours.",
          "Teams that lose games can get a rebate as league credit under Rebates.",
        ],
        keywords: ["rain", "weather", "cancel", "makeup", "postpone"],
      },
      {
        id: "command-center",
        title: "Game-day command center",
        summary:
          "Every game on one phone screen: fields, refs, check-ins and scores, refreshed every 10 seconds.",
        steps: [
          "Open Game day from the admin dashboard. It shows today, or the next game day.",
          "The counts at the top show games, refs at the field, games playing now and scores missing.",
          'Each game card shows its field, the score state and its ref. "Mark here" checks a ref in; "Score" opens its score screen.',
          "The buttons at the top call a rain-out, send an announcement or assign refs.",
        ],
        screen: { href: "/app/admin/today", label: "Game day" },
        keywords: ["today", "dashboard", "refs", "live", "game day"],
      },
    ],
  },
  {
    slug: "owner",
    title: "Owners",
    intro: "The league's books, park permits and the numbers.",
    articles: [
      {
        id: "books",
        title: "Keep the books",
        summary:
          "Record each season's expenses with a receipt photo; the ledger adds up money in and out.",
        steps: [
          "Open Books. It opens on the newest season.",
          'Under "Add an expense", enter the date, amount, category and a note, and take or choose a photo of the receipt.',
          "The ledger shows money in, money out by category and the net. Payments in come from registrations on their own.",
          "Download the ledger as a CSV for taxes. It has no player names.",
        ],
        screen: { href: "/app/books", label: "Books" },
        keywords: [
          "expenses",
          "receipts",
          "ledger",
          "taxes",
          "accounting",
          "csv",
        ],
      },
      {
        id: "permits",
        title: "Park permits",
        summary:
          "Keep each permit and the insurance certificate, see games on a lost permit, and copy what to request.",
        steps: [
          "Open Books, then Permits for the season.",
          "Add each permit with its cost, dates and document. The insurance certificate goes on the same screen.",
          "Games on a lost permit are listed in red, with a link to the schedule board to move them.",
          '"What to request" builds the request from the season\'s teams, game day and slot length. Copy the sheet or download it as a CSV.',
          "\"Fees and hours\" estimates each permit's fee until you enter its real cost, shows when the fees are due, and counts the season's hours against NYC Parks' 50-hour insurance line.",
          "When a rain-out or blackout leaves permitted time unused, \"Give back field time\" lists it with the borough office's number and the answers for Parks' cancellation form.",
        ],
        notes: [
          "Refs and captains see the permit for their game at the field, even with no signal.",
          "Nothing is sent to NYC Parks: you call or fill in the form yourself.",
        ],
        screen: { href: "/app/books/permits", label: "Permits" },
        keywords: [
          "permit",
          "parks",
          "insurance",
          "certificate",
          "fields",
          "fees",
          "cancel",
        ],
      },
      {
        id: "permit-renewal",
        title: "Renewing permits and the application packet",
        summary:
          "Draft next year's NYC Parks renewal from this season's permits, and gather what Parks may ask for.",
        steps: [
          "Open Books, then Permits for the season you want to renew.",
          '"Renew for next year" drafts the renewal: the same fields, days and hours, a year on, with the renewal and new-request dates.',
          "Change the hours, drop a field or add one. Anything more than last year goes in a separate new request, so the league keeps its returning status.",
          '"Application packet" gathers the website, schedule and roster counts, one application per borough and the insurance certificate. Player names go in only if you choose.',
        ],
        notes: [
          "Owners get an email 30 and 7 days before renewals open.",
          "Nothing is sent to NYC Parks: copy the sheets into the application yourself.",
        ],
        screen: { href: "/app/books/permits", label: "Permits" },
        keywords: ["permit", "renewal", "renew", "parks", "packet", "roster"],
      },
      {
        id: "dashboard",
        title: "Owner dashboard",
        summary:
          "Membership, money, teams, event turnout and sponsor check-ins, season by season.",
        steps: [
          "Open the owner dashboard. It opens on the newest season past draft.",
          "Each section starts with its headline numbers, then a table: new and returning members, money in and out, each team against its roster target, and the week chart.",
          'Tap "Refresh now" for up-to-the-minute numbers, or download them as a CSV.',
          "Under Summary, choose what to fold into Other, preview exactly what goes public, and publish the season's money summary.",
        ],
        screen: { href: "/app/owner", label: "Owner dashboard" },
        keywords: ["numbers", "metrics", "retention", "money summary", "csv"],
      },
    ],
  },
];

export const roleBySlug = (slug: string): HelpRole | undefined =>
  HELP_ROLES.find((r) => r.slug === slug);

/** The article a screen links to, so a typo in a link fails a test. */
export function helpHref(role: HelpRole["slug"], articleId?: string): string {
  return articleId ? `/help/${role}#${articleId}` : `/help/${role}`;
}

/** Every how-to as the search box and the sitemap see it. */
export function helpEntries(): HelpEntry[] {
  return HELP_ROLES.flatMap((role) =>
    role.articles.map((a) => ({
      href: helpHref(role.slug, a.id),
      title: a.title,
      summary: a.summary,
      role: role.title,
      keywords: a.keywords ?? [],
    })),
  );
}
