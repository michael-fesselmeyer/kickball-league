import type { HelpEntry } from "@/domain/help/search";
import type { Locale } from "@/i18n/locales";
import { linkIn } from "@/i18n/routing";
import { HELP_ES, type SpanishRole } from "./articles.es";

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
          "If the league has the card price turned on, the Pay step shows the total for each way to pay first: the card price with its processing fee on its own line, a bank transfer if offered, and the lower price for cash, Zelle or check, with how to pay those.",
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
          "zelle",
          "cash",
          "check",
          "bank transfer",
          "processing fee",
        ],
      },
      {
        id: "raise-concern",
        title: "Raise a concern with the league",
        summary:
          "Tell the league privately about a game, a team or how you were treated.",
        steps: [
          'From your home screen, tap "Raise a concern".',
          "Choose what it is about, add a link to the game if there is one, and say what happened.",
          'Tap "Send to the league". You get an email that it arrived.',
          'Follow the answer under "Your concerns". You get an email when the league replies and when it closes the concern, with what was done.',
        ],
        notes: [
          "Only the league's admins read it. It is never shown to the other team, your captain or anyone outside the league.",
          "For an emergency at the field, call 911 first.",
        ],
        screen: { href: "/app/concerns/new", label: "Raise a concern" },
        keywords: [
          "complaint",
          "report",
          "safety",
          "treated",
          "private",
          "contact",
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
        id: "conduct",
        title: "Read the code of conduct",
        summary:
          "The league's code covers play, the park, alcohol and sound, and conduct online.",
        steps: [
          'Read the code on the league\'s public rules page, under "Code of conduct".',
          "When you sign your season waiver, the code is shown above the box and you tick it to agree.",
          "You accept each version once. If the league publishes a new one, you accept it at your next registration.",
        ],
        notes: [
          "Joining a team, joining with a team link and joining as a free agent all go through the same waiver step.",
        ],
        screen: { href: "/app", label: "Your home, then sign the waiver" },
        keywords: ["rules", "behavior", "park", "alcohol", "glass", "agree"],
      },
      {
        id: "alerts",
        title: "Turn alerts on, down or off",
        summary:
          "Choose which emails and phone notifications you get, and get fewer without missing your games.",
        steps: [
          "Open your profile from your home.",
          'Under "Email settings", tick the emails you want and tap "Save email settings". Sign-in links always come.',
          'Under "How often we message you", set a daily limit, a daily or weekly digest, and quiet hours.',
          'Under "Fewer messages, not none", pick "Only my team", get league news as a weekly roundup, or tap "Snooze for 2 weeks".',
          'Under "Push notifications", tick topics and tap "Save push settings". Your browser asks to allow notifications. "Turn off push on this device" stops them on this phone.',
        ],
        notes: [
          'We never ask for notifications on your first visit. Now and then a card offers one alert at the moment it helps, like rain-out alerts after you RSVP. Each card asks once, and "No thanks" keeps them away for a month.',
          "Every email has the same choices at the bottom: only my team, a weekly digest, snooze, or stop that kind of email.",
          "Rain-outs, changes to your games, payment deadlines and your shirt size always come. Rule changes are on unless you turn them off.",
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
          "snooze",
          "fewer emails",
          "too many emails",
          "rules",
        ],
      },
      {
        id: "contact-league",
        title: "Contact the league",
        summary:
          "Ask a question or report a problem at the field. No account needed.",
        steps: [
          'Open "Contact the league" from the About page or a park page.',
          'Pick what it is about: "A question", "A problem at the field", "Something about how the park is used" or "Something else".',
          "Add the date and field if you know them, and write your message. Please leave out links.",
          'Add your email if you want a reply, then tap "Send to the league".',
        ],
        notes: [
          "Only the league's admins read it, and your email is kept a year after they close your message.",
          'Signed in and it\'s about a game or a person? Use "Raise a concern" instead.',
          "For an emergency, call 911 first.",
        ],
        keywords: [
          "question",
          "park rules",
          "problem",
          "email the league",
          "reach",
        ],
      },
      {
        id: "check-in",
        title: "Check in at the game",
        summary:
          "Scan the code on your captain's or ref's phone so the league knows you played.",
        steps: [
          "At the field, ask your captain or the ref to show the game's check-in code.",
          "Scan it with your phone's camera and sign in if asked.",
          'Tap "Check in". You see "You\'re checked in".',
        ],
        notes: [
          "The code changes every few minutes, so a code from a photo won't work. Scan the live one.",
          "Told you're not on the roster? Ask a captain to add you, or to approve your sub claim, then scan again.",
          "Check-in closed or missed it? Ask your captain to tick you in. It counts toward your games played.",
        ],
        keywords: ["qr", "scan", "attendance", "games played", "played"],
      },
      {
        id: "email-choices",
        title: "Choose which emails you get",
        summary:
          "News from the league is opt-in. Pick your emails, set a daily limit and unsubscribe in one tap.",
        steps: [
          "Open your profile and find the email settings.",
          'Tick the emails you want, such as "Announcements from admins and captains". Sign-in links always come.',
          "Set a daily limit for news and reminders, and hold them overnight if you like.",
          'Tap "Save email settings".',
        ],
        notes: [
          "A new account starts with league news off, so tick it if you want it.",
          "Every email has an unsubscribe link for its topic. One tap and it stops.",
          "Urgent things, like a rain-out or a payment deadline, still arrive at once.",
        ],
        screen: { href: "/app/profile", label: "Your profile" },
        keywords: [
          "unsubscribe",
          "newsletter",
          "news",
          "opt in",
          "email",
          "digest",
          "quiet hours",
        ],
      },
      {
        id: "season-card",
        title: "Your season card",
        summary:
          "After a season ends you get a card with your games, your team's season and any awards. Share it if you like.",
        steps: [
          'Open the message that says your season card is ready, or find "Your season in kickball" in the app.',
          "Look it over. Only you can see it at first.",
          'To share, tap "Make my card\'s link public", then share it or copy it for WhatsApp.',
          'Changed your mind? Tap "Make my card private". The link and its picture stop working.',
        ],
        notes: ["No other player's name is on your card."],
        screen: { href: "/app", label: "Your home" },
        keywords: ["end of season", "wrapped", "stats", "share", "awards"],
      },
      {
        id: "who-has-field",
        title: "See who has a field",
        summary:
          "Each park has a public page showing which fields the league holds and when.",
        steps: [
          "Open the park's page from the league's site.",
          'Under "Fields and hours", see each field the league has permitted for the coming days, with its permit number and hours.',
          "A line for today says whether the league holds a field right now.",
          'Read "House rules" before you set up.',
        ],
        notes: [
          'Someone else on a field we hold? Be friendly, show them the permit number and tell the league through "Contact the league".',
        ],
        keywords: [
          "permit",
          "park",
          "field",
          "someone is on our field",
          "nyc parks",
        ],
      },
      {
        id: "change-team",
        title: "Look for a new team, quietly",
        summary:
          "Open to a different team next season? Say so privately. Your current team never sees it.",
        steps: [
          'Open your profile and tap "Looking for a change".',
          "Choose who can see it: captains recruiting for next season, league admins, or both. Add a short note if you like, such as a night that suits you. You don't need to give a reason.",
          'Tap "I\'m open to a new team". Your current captain, co-captains and teammates never see it, and nothing public shows it.',
          'Recruiting teams see only how many players are open. When one sends an invite, you get an email: tap "Yes, share my name and email" or "No thanks". A no tells nobody.',
          'It clears on its own when next season\'s registration closes. "Take it back" removes it and any invites at any time.',
        ],
        screen: { href: "/app/change-team", label: "Looking for a change" },
        keywords: ["switch teams", "new team", "transfer", "move", "change"],
      },
      {
        id: "leadership-check-in",
        title: "The season-end leadership check-in",
        summary:
          "Privately say who you'd like to help lead next season; a secret ballot follows only if enough of the team takes part.",
        steps: [
          'When the season ends, your team page shows "Leadership check-in". Open it.',
          'Tick "I\'d like to help as a co-captain" or "I\'d like to captain next season", suggest a teammate, or leave it all blank to say things are good. Tap "Check in". It\'s once, and nobody sees your answer.',
          "Suggested by a teammate? Within a day you're asked whether you'd like to stand. Saying no is fine, and you're never told who suggested you.",
          'If enough of the roster checked in and a teammate stands for captain, a secret ballot opens. Pick one and tap "Cast my secret vote".',
          "Your captain hears the result first; the team hears the outcome a few days later. A change needs over half the votes.",
        ],
        notes: [
          "Nobody sees how anyone voted or who suggested whom: not the captain, teammates or the league.",
          "Captains can still hand the team over any time from the team page.",
        ],
        screen: { href: "/app", label: "Your home, then your team" },
        keywords: [
          "captain",
          "vote",
          "ballot",
          "election",
          "co-captain",
          "nominate",
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
      {
        id: "game-day-checklist",
        title: "Game-day checklist",
        summary:
          "Tick the league's before and after list for your team, even with no signal.",
        steps: [
          "On game day, open the game-day checklist from your game. It opens on the day.",
          "Tick each item before play for your team's game.",
          "Tick the after-play items when you're done.",
          'When your game is the last at the field, confirm "Field left clean" or note what you saw. A photo is optional.',
        ],
        notes: [
          "Your ticks are saved on your phone and sent when you're back online.",
          "The league writes the list each season, so it can differ from last time.",
        ],
        screen: { href: "/app", label: "Your home" },
        keywords: [
          "checklist",
          "set up",
          "field clean",
          "before game",
          "after game",
        ],
      },
      {
        id: "check-in-players",
        title: "Check your players in",
        summary:
          "Show the game's rotating code so players scan it, or tick them in yourself.",
        steps: [
          "At the game, open its check-in screen and hold up the code for your players to scan.",
          'Each player scans it and taps "Check in".',
          "Watch the screen for anyone who checked in without a signed waiver.",
          "Anyone missed? Tick them in by hand, at the field or up to a week later.",
        ],
        notes: [
          "Approved subs count too.",
          "Your team page shows attendance and each player's games played. Some seasons need a minimum for the playoffs.",
        ],
        screen: { href: "/app", label: "Your home, then the game" },
        keywords: ["attendance", "qr", "games played", "tick in", "playoffs"],
      },
      {
        id: "injury-report",
        title: "Report an injury",
        summary:
          "File a short, private report if someone is hurt in your game.",
        steps: [
          "Call 911 first if it is serious.",
          'On the game page, tap "Someone was hurt? Report an injury".',
          "Choose who was hurt, where they were hurt and what care they needed.",
          "Say what happened: when, how and what was done. Leave out anything not needed.",
          'Tap "Send the report".',
        ],
        notes: [
          "Only the league's owners and admins can read it. The league is emailed that a report was filed, with no details.",
          "The game has to have started for you to file.",
        ],
        keywords: [
          "hurt",
          "injured",
          "insurance",
          "accident",
          "first aid",
          "safety",
        ],
      },
      {
        id: "recruit",
        title: "Invite players looking for a change",
        summary:
          "While next season is open for registration, invite players who are quietly open to a new team.",
        steps: [
          'On your team page for next season, find "Players looking for a change". It shows how many players are open and haven\'t heard from you yet.',
          'Add a short pitch if you like (your night, your vibe) and tap "Invite" (it shows how many). Everyone gets the same words, and you never see who they are.',
          'A player who says yes appears under "Said yes" with their name, email and note, and you get an email. Send them your team link.',
        ],
        notes: [
          "A player who says no, or doesn't answer, stays anonymous. The count never includes anyone who has played for your team.",
        ],
        keywords: [
          "recruit",
          "new players",
          "free agents",
          "looking for a change",
        ],
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
          'Tap "First pitch" when play starts. The game clock then counts down to when play must end: sunset less a margin, or the time the field must be clear, whichever comes first. If the start was late, say which team held it up.',
          "After each half-inning, tap its runs (0 to 7, or type a number). Fix any half by changing its runs, or take back the last one.",
          'End with "Game over" to report every run, or "Called after the" Nth inning to report the score at the last complete inning (at least 4). When time runs out, pick daylight or field time as the reason.',
          "Either becomes the reported score, and the captains confirm it.",
        ],
        notes: [
          "No signal? Runs are kept on the phone and sent when you're back in range, and the clock keeps counting.",
          "The public game page shows the line score within about 15 seconds.",
          "The game clock counts down from the scheduled start and says when no new inning may start near the time limit.",
          "To eject a player, use Eject a player below the scorer. It files the report for the league and takes them out of their team's kicking order for the rest of the game.",
        ],
        keywords: [
          "score",
          "innings",
          "runs",
          "called game",
          "offline",
          "sunset",
          "late start",
        ],
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
      {
        id: "ref-pool",
        title: "Take a game from the ref pool",
        summary:
          "Say when you can ref, pick up games that need a ref and drop one if your plans change.",
        steps: [
          'Open "Your games and pay". Under "When can you ref?", tick the game times you can work and tap "Save when I can ref".',
          "When a game has no ref, the league asks the pool. Open the link and take the game. The first ref to take it gets it.",
          "Your games show on your home with their pay.",
          'Can\'t make one? Tap "Drop this game" before it starts, and say why. Admins see the reason.',
        ],
        notes: [
          "You can't take a game your own team plays, or one at the same time as a game you play or ref.",
          "Game started already? Tell an admin instead of dropping it.",
          "Not in the pool? Ask an admin to add you.",
        ],
        screen: { href: "/app/referee", label: "Your games and pay" },
        keywords: [
          "assign",
          "pay",
          "availability",
          "drop",
          "take a game",
          "pool",
        ],
      },
      {
        id: "injury",
        title: "Report an injury",
        summary:
          "If someone is hurt, get help first, then file a short private report.",
        steps: [
          "Call 911 first if it is serious. Look after the player.",
          'Open the game and tap "Someone was hurt? Report an injury".',
          "Choose who was hurt, where and what care they needed from the lists.",
          'Say what happened and who saw it, then tap "Send the report".',
        ],
        notes: [
          "Only the league's owners and admins read the report. Players, captains and the other team never see it.",
          "Captains and admins can file one too.",
        ],
        keywords: ["hurt", "accident", "insurance", "first aid", "safety"],
      },
      {
        id: "permit-layout",
        title: "Find the permit and the field layout",
        summary:
          "See which fields we hold and where the permitted area ends, even with no signal.",
        steps: [
          "Open your game on game day and tap the park permit.",
          'Use "Open the layout (PDF)" to see where the permitted area ends and where the diamonds go.',
          "Use it to set up, or to show someone else on the field what we hold.",
        ],
        notes: [
          "It is saved on your phone with your next game, so it opens without a signal.",
          "No layout? The screen says so. Ask an admin to add it.",
          "When a game would run past the field's permit, you and the captains get a warning before it starts.",
        ],
        screen: { href: "/app/referee", label: "Your games" },
        keywords: ["permit", "layout", "map", "field", "past permit", "late"],
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
      {
        id: "refunds",
        title: "Refund a payment",
        summary:
          "Send money back through Stripe, or mark a cash or Venmo refund as handed back.",
        steps: [
          "Open the season's registrations and find the player.",
          "Under their payment, type an amount in dollars, or leave it blank to refund what is left, and add a reason.",
          'Tap "Refund through Stripe" for a card payment, or "Mark refunded" for cash or Venmo.',
          "Card refunds show as refunded once Stripe confirms. Until then you see the amount as pending.",
        ],
        notes: [
          "You need a sign-in from the last 15 minutes. If it asks, sign out and back in, then refund again. Nothing was refunded.",
          "Stripe said no? Nothing went back. Try again in a minute.",
          "You can't refund more than is left on the payment. Every refund is in the audit log.",
        ],
        screen: { href: "/app/admin", label: "Admin" },
        keywords: [
          "money back",
          "stripe",
          "partial",
          "cancel",
          "credit",
          "audit",
        ],
      },
      {
        id: "shirt-order",
        title: "Run the shirt order",
        summary:
          "Count sizes, remind players who haven't picked one, and send the vendor a sheet.",
        steps: [
          'Open the season\'s "Shirt order" and save the sizes you offer. Sign-up forms use them from then on.',
          "See the counts for the whole league and each team. Players with no size get one reminder email.",
          'Add the cost and vendor if you have them, then tap "Download for the vendor (CSV)". It has sizes and counts only unless you tick "Include names for team packing".',
          'Tap "Mark the order placed", then "Mark the order received" when the box arrives. Each player\'s shirt updates.',
        ],
        notes: [
          "Once the order is placed the sizes stay as they were when it was counted.",
          "An owner can add the cost to the books as a shirts expense from this screen.",
          'Players who joined late and replacement jerseys are listed under "Replacement jerseys to make".',
        ],
        screen: { href: "/app/admin", label: "Admin" },
        keywords: [
          "shirts",
          "jerseys",
          "sizes",
          "vendor",
          "late joiners",
          "csv",
        ],
      },
      {
        id: "game-day-checklists",
        title: "Set up the game-day checklists",
        summary:
          "Write each season's captain checklist and give the set-up lead a plan for the day.",
        steps: [
          "Open the season's game-day checklist and review the before and after items. Sensible defaults are there.",
          'Post a "Set-up lead" volunteer shift for each game day. Whoever claims it gets the checklist for the day.',
          "The set-up lead sees each field's permit, your short script for asking people to move and a one-tap note for how it went.",
          "On the day, the command center shows each field's set-up and end-of-day checks.",
        ],
        notes: [
          "Anything but a fine result shows on the incidents screen.",
          "Everything works with no signal and syncs later.",
        ],
        screen: { href: "/app/admin", label: "Admin" },
        keywords: [
          "set-up lead",
          "volunteer",
          "field clean",
          "checklist",
          "move a group",
        ],
      },
      {
        id: "field-layouts",
        title: "Add a field layout",
        summary:
          "Upload a picture of where the permitted area ends. A schedule can't be published without one.",
        steps: [
          "Open the field and add its layout: a photo or PDF showing the permitted area, the diamonds and the spectator areas.",
          "Add a short note, or confirm the field needs no layout.",
          "Publish the schedule. It checks that every field it uses has one.",
        ],
        notes: [
          "The layout opens from the command center, from the set-up shift and from the ref's and captains' permit page.",
          "It uses the same file storage and limits as permit documents.",
        ],
        screen: { href: "/app/admin", label: "Admin" },
        keywords: ["layout", "diamond", "map", "photo", "pdf", "permit"],
      },
      {
        id: "permit-coverage",
        title: "When a game isn't covered by a permit",
        summary:
          "Publishing and event saves check that a permit covers the field for the whole time.",
        steps: [
          "Publish a schedule, move a game, or save a pickup, practice or event on a league field.",
          "If no permit with its document covers the whole time, the screen explains the gap, such as the field's permit ending before the game does.",
          "Move the game, shorten it, or add the missing permit under Books, then Permits.",
        ],
        notes: [
          "A permit marked lost doesn't count.",
          "This keeps the league from posting games on a field it doesn't hold.",
        ],
        screen: { href: "/app/books/permits", label: "Permits" },
        keywords: [
          "permit",
          "gap",
          "publish blocked",
          "pickup",
          "event",
          "lost permit",
        ],
      },
      {
        id: "ref-assigner",
        title: "Assign refs and pay them",
        summary:
          "Get a suggested ref for every game, accept or change it, then record what refs are owed and paid.",
        steps: [
          "Add refs to the league's pool. Each one ticks the times they can work.",
          'Open "Assign refs" for a game day or the whole season. Each game gets a suggested ref, or a reason why nobody fits.',
          "Accept all, accept one, or pick someone else by hand. A ref isn't suggested for their own team's game.",
          'Open the pay sheet, set the per-game fee, and tap "Mark paid" when you pay a ref in cash or Venmo.',
        ],
        notes: [
          "A game with no ref goes to the pool, and the first ref to take it gets it.",
          "Marking paid adds a Refs expense to the books.",
        ],
        screen: { href: "/app/admin", label: "Admin" },
        keywords: ["referee", "pay sheet", "assign", "pool", "fee", "venmo"],
      },
      {
        id: "league-inbox",
        title: "Answer concerns and contact messages",
        summary:
          "One queue holds private concerns from players and messages from the public contact form.",
        steps: [
          "Open the incidents screen. New concerns and messages are in the queue.",
          "Open one, read it and reply by email. Add private notes for other admins.",
          "Close it with what was done. The person is told.",
        ],
        notes: [
          "Only admins see a sender's address, and every read is logged.",
          "Messages are deleted 12 months after they close.",
          "Park-rule messages are grouped, so you can spot a pattern across a season.",
        ],
        screen: { href: "/app/admin/incidents", label: "Incidents" },
        keywords: [
          "concerns",
          "contact",
          "reply",
          "incidents",
          "inbox",
          "complaint",
        ],
      },
      {
        id: "injury-reports",
        title: "Read and manage injury reports",
        summary:
          "Review reports, download one for the insurer, and delete the details when they're no longer needed.",
        steps: [
          "You're emailed when a report is filed, with a link and no details. Open the incidents screen.",
          "Open the report to read who was hurt, what care they needed and what happened.",
          "Download it for the insurance carrier. It includes the dates of the current insurance certificate.",
          "Delete it when it's no longer needed. Details are deleted three years after the report anyway.",
        ],
        notes: [
          "Only owners and admins can read these. Every opening, export and deletion is in the audit log.",
        ],
        screen: { href: "/app/admin/incidents", label: "Incidents" },
        keywords: ["injury", "insurance", "privacy", "delete", "export"],
      },
      {
        id: "leadership-check-ins",
        title: "Run the season-end leadership check-ins",
        summary:
          "Open every team's private leadership check-in once the regular season ends, and pause or close one if it's disputed.",
        steps: [
          'Open the season, then "Leadership check-ins". It works once the season is in playoffs or completed.',
          'Choose how many days to check in (3 to 14) and tap "Open check-ins". Every roster is told.',
          'Set "Quorum": the share of a roster that must take part before a ballot, 60% unless you change it.',
          'Each team shows its step, how many took part and its deadline. "Pause" stops everything if it\'s disputed; "Resume" moves the deadline on; "Close with no change" ends it.',
        ],
        notes: [
          "You never see who suggested or voted for whom, or any vote count; only the outcome, once the team hears it.",
        ],
        keywords: ["captain", "vote", "ballot", "election", "leadership"],
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
          "Record each season's expenses in a few taps, confirm the regular costs, pay back owners and import a Venmo or bank statement.",
        steps: [
          "Open Books. It opens on the newest season.",
          'Under "Add an expense", type the amount, tap a category and tap Add expense. The date, a note, a receipt photo and who paid are under "Date, note, receipt and who paid". A receipt can come later, or choose "There isn\'t one".',
          'Set regular costs once under "Expected costs", such as ref pay each game day or the permit each season. When one is due, confirm it with one tap (change the amount first if it differs) or skip it.',
          'If an owner paid out of their own pocket, pick them under "Paid from". "Owed to owners" adds it up; press Reimbursed once they\'re paid back.',
          'To import, download a CSV from Venmo or your bank and pick it under "Import a statement". Check the guessed categories, untick anything that isn\'t a league cost, and import. Rows already in the books are skipped.',
          "The ledger shows money in (from registrations, on their own), money out by category and the net. Download it as a CSV for taxes; it has no player names.",
        ],
        screen: { href: "/app/books", label: "Books" },
        keywords: [
          "expenses",
          "receipts",
          "ledger",
          "taxes",
          "accounting",
          "csv",
          "venmo",
          "bank statement",
          "reimburse",
          "ref pay",
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
      {
        id: "season-checklist",
        title: "The season checklist",
        summary:
          "A list of jobs that keep a season running, each with an owner and a due date.",
        steps: [
          "Open the season's checklist. It starts from the league template, dated from the season's first day.",
          "Give each task an owner and a due date, and add notes.",
          "Tick tasks as they're done. The dashboard shows the next three.",
          "Edit the template to change what future seasons start with.",
        ],
        notes: [
          "Each task's owner gets an email 3 days before it's due, and once if it's overdue.",
          "Starting the next season offers to carry the checklist over.",
        ],
        screen: { href: "/app/owner", label: "Owner dashboard" },
        keywords: ["tasks", "template", "to do", "due date"],
      },
      {
        id: "report-card",
        title: "Season report card",
        summary:
          "Compare a season with the one before it, with a version to share with sponsors.",
        steps: [
          "Open a season's report card.",
          "Read each measure with both numbers and the change in plain words, such as players, money, games and survey scores.",
          "Download the CSV, or open the shareable version for sponsors.",
        ],
        notes: [
          "The shareable version leaves out money and anything about one person. Print it or save it as a PDF.",
          "Owners only.",
        ],
        screen: { href: "/app/owner", label: "Owner dashboard" },
        keywords: ["compare", "last season", "sponsors", "csv", "pdf"],
      },
      {
        id: "processing-fees",
        title: "Have payers cover processing fees",
        summary:
          "Card payers pay a card price that covers the card fee; cash, Zelle and check stay free. Off until the league turns it on.",
        steps: [
          "Confirm the legal side with the league's adviser first, and give Stripe any notice it asks for. The settings page lists what to check.",
          "Open Processing fees and enter the league's real card rate (Stripe's US rate is 2.9% + $0.30). The fee is never more than the rate entered.",
          "Add how players pay with cash, Zelle or check, using the league's own details. Players see it wherever they pay.",
          "Choose whether to offer bank transfers (turn on bank payments in Stripe first) and whether Venmo is a business profile with its own fee.",
          'Choose "On", tick the box and save. Season fees and team balances show each method\'s total before anyone pays.',
        ],
        notes: [
          "A full refund returns the fee; a partial refund returns the same share of it.",
          "The books show fees payers covered and card fees saved by free methods.",
          "Tickets, the shop and private events stay at their price.",
        ],
        screen: {
          href: "/app/owner/processing-fees",
          label: "Processing fees",
        },
        keywords: [
          "card fee",
          "surcharge",
          "stripe",
          "zelle",
          "cash",
          "check",
          "bank transfer",
          "venmo",
        ],
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

/** The roles whose help is written in each language (ADR 0094). */
export const TRANSLATED_HELP_ROLES: Readonly<
  Record<Locale, readonly HelpRole["slug"][]>
> = {
  en: HELP_ROLES.map((r) => r.slug),
  es: ["player", "captain", "ref"],
  // Written in English and Spanish so far; the other languages' footers
  // link to the English help.
  zh: [],
  ru: [],
  pl: [],
  bn: [],
  ko: [],
  ht: [],
  it: [],
  fr: [],
};

/**
 * The how-tos in a language: each translated role's articles in it, with
 * the same ids and screens as the English ones. Roles not translated are
 * left out; their pages are in English. A language with no how-tos of its
 * own gets the English ones.
 */
export function helpRolesFor(locale: Locale): readonly HelpRole[] {
  if (locale !== "es") return HELP_ROLES;
  return HELP_ROLES.flatMap((role) => {
    if (!isSpanishRole(role.slug)) return [];
    const words = HELP_ES[role.slug];
    return [
      {
        ...role,
        title: words.title,
        intro: words.intro,
        articles: role.articles.map((a) => {
          const own = words.articles[a.id];
          if (!own) return a;
          return {
            ...a,
            title: own.title,
            summary: own.summary,
            steps: own.steps,
            ...(own.notes ? { notes: own.notes } : {}),
            ...(a.screen && own.screenLabel
              ? { screen: { href: a.screen.href, label: own.screenLabel } }
              : {}),
            keywords: [...(own.keywords ?? []), ...(a.keywords ?? [])],
          };
        }),
      },
    ];
  });
}

const isSpanishRole = (slug: HelpRole["slug"]): slug is SpanishRole =>
  Object.hasOwn(HELP_ES, slug);

/** Every how-to as the search box and the sitemap see it. */
export function helpEntries(locale: Locale = "en"): HelpEntry[] {
  return helpRolesFor(locale).flatMap((role) =>
    role.articles.map((a) => ({
      href: linkIn(locale, helpHref(role.slug, a.id)),
      title: a.title,
      summary: a.summary,
      role: role.title,
      keywords: a.keywords ?? [],
    })),
  );
}
