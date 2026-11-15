import { emailEn } from "./email.en";
import { liveEn } from "./live.en";
import { pagesEn } from "./pages.en";
import { shareEn } from "./share.en";

/**
 * The English messages: the source every other language translates
 * (ADR 0094). Add a message here first; `npm test` then lists it as
 * missing from each other catalog until it is translated there.
 *
 * Write for a phone: short, plain words. A message with a count is a
 * `$plural` with at least `one` and `other`; `{n}` is the count.
 */
export const en = {
  shell: {
    brand: "Kickball League",
    skipToContent: "Skip to content",
    siteNav: "Site",
    footer: {
      schedules: "Schedules",
      history: "History",
      about: "About",
      events: "Events",
      faq: "FAQ",
      contact: "Contact",
      friends: "Friends",
      help: "Help",
      park: "McCarren Park",
      rules: "Rules",
      sponsors: "Sponsors",
      signIn: "Sign in",
    },
    theme: {
      toLight: "Switch to light mode",
      toDark: "Switch to dark mode",
    },
    language: {
      group: "Language",
      current: "{language} (current)",
    },
  },
  profile: {
    language: {
      label: "Language",
      hint: "Emails and notifications come in this language. The app's screens are in English for now.",
      saved: "Saved. Emails and notifications will come in {language}.",
      save: "Save language",
    },
  },
  formats: {
    teams: { $plural: { one: "{n} team", other: "{n} teams" } },
    players: { $plural: { one: "{n} player", other: "{n} players" } },
  },
  faq: {
    title: "FAQ",
    description:
      "Do you need a team? Is it coed? What does it cost, what should you wear, and what happens when it rains? Quick answers about adult kickball in Brooklyn.",
    home: "Home",
    headingStart: "Questions,",
    headingSwipe: "answered",
    intro:
      "The short version: it's coed, you can come solo, and nobody needs to be good at kickball.",
    sections: "FAQ sections",
    readyTitle: "Ready when you are",
    readyBody:
      "Sign in with your email to register a team, join one, or come solo.",
    signUp: "Sign up for a season",
    joining: {
      title: "Joining",
      team: {
        question: "Do I need a team to join?",
        answer:
          "No. Sign up as a free agent and the league places you on a team before the season starts. Lots of players come solo, and it's the quickest way to meet people.",
      },
      friend: {
        question: "How do I join a friend's team?",
        answer:
          "Ask your captain for the team's invite link. Open it, sign in with your email, sign the waiver and pay your share if the team is splitting the fee. That's it, you're on the roster.",
      },
      age: {
        question: "How old do I have to be?",
        answer:
          "You need to be 18 or older to play. Some social events at bars are 21 and over, and their event pages say so.",
      },
      skill: {
        question: "Do I need to be good at kickball?",
        answer:
          "Not at all. If you remember recess, you're qualified. Games are friendly, the refs explain calls, and nobody minds a whiff.",
      },
    },
    season: {
      title: "The season",
      when: {
        question: "When are games?",
        answer:
          "It depends on the season and the park permits: Sunday afternoons in summer, weeknight evenings in spring and fall. Each season's page lists its exact day and times before registration opens.",
      },
      where: {
        question: "Where do we play?",
        answer:
          "McCarren Park in Brooklyn, on the border of Greenpoint and Williamsburg. Your game page names your field.",
        more: "Getting to McCarren Park",
      },
      cost: {
        question: "How much does it cost?",
        answer:
          "The fee is set each season and shown on the season's page, with what it includes, before you pay anything. Some seasons charge per player and some per team. When a team splits its fee, each player pays their own share online.",
      },
      length: {
        question: "How long is a game?",
        answer:
          "Each game fits in a one-hour slot, so you're done in time for dinner, or a drink (or a seltzer) with your team.",
      },
      coed: {
        question: "Is the league coed?",
        answer:
          "Yes. Every team plays mixed, and lineups follow the league's gender-balance rule, which your captain and the ref keep an eye on.",
      },
      rain: {
        question: "What happens if it rains?",
        answer:
          "A person at the league watches the forecast and makes the call, usually the day before. If your game is rained out, your game page shows it, and the makeup time appears there once it's set.",
      },
    },
    gameDay: {
      title: "Game day",
      wear: {
        question: "What should I wear?",
        answer:
          "Sneakers or turf shoes, something in your team's color, and a layer for evening games. Bring water and sunscreen in summer.",
      },
      drink: {
        question: "Do I have to drink?",
        answer:
          "Nope. Hanging out after the game is part of the fun, but it's a drink or a seltzer, your call, and plenty of people skip it. Drinks wait until after the game, since alcohol isn't allowed in city parks.",
      },
      watch: {
        question: "Can friends come and watch?",
        answer:
          "Of course. It's a public park, and a few fans on the sideline never hurt anyone's kicking.",
      },
    },
  },
  schedule: {
    title: "Schedule",
    seasonTitle: "{season} schedule",
    divisionTitle: "{division} schedule",
    seasonNav: "Season",
    standings: "Standings",
    playoffs: "Playoffs",
    statusLabel: "Game-day status",
    divisionsNav: "Divisions",
    allDivisions: "All divisions",
    comingSoon: "Coming soon",
    comingSoonBody:
      "The schedule comes out about a week before opening day. Register now and we'll email you when it's up.",
    team: "Team",
    allTeams: "All teams",
    show: "Show",
    teamPage: "{team} team page and calendar",
    showingTeam: {
      $plural: {
        one: "Showing {n} game for {name}.",
        other: "Showing {n} games for {name}.",
      },
    },
    showingAll: {
      $plural: { one: "Showing {n} game.", other: "Showing all {n} games." },
    },
    themeWeek: "Theme week:",
    open: "Open",
    crossover: "Crossover",
    makeups: "Makeups to be scheduled",
    makeupsBody:
      "These games need a new date. They show up here, on the team pages and in calendar feeds as soon as the league sets one.",
    kickoff: "Kickoff",
    fieldTba: "Field TBA",
    timeTba: "Time TBA",
  },
  gameStatus: {
    cancelled: "Cancelled",
    postponed: "Postponed",
    rainedOut: "Rained out",
    final: "Final",
    ruling: "Ruling",
    forfeit: "Forfeit",
    live: "Live",
  },
  gameday: {
    updated: "Updated {time}",
    gamesOn: "Games are on.",
    watchingDay: "Watching the weather: we'll decide by {time}.",
    someLate: "Some games start late.",
    allLate: "All games start late.",
    someOff: "Some games are off.",
    allOff: "All games are off.",
    watchingGame: "Watching the weather: decision by {time}",
    startsLate: "Starts late: {time}",
    off: "Off",
  },
  ruleSet: {
    innings: { $plural: { one: "{n} inning", other: "{n} innings" } },
    timeLimit: "{minutes}-minute limit",
    bunting: "bunting allowed",
    noBunting: "no bunting",
    stealing: "stealing allowed",
    noStealing: "no stealing",
    bestOf: "best of {n} sets",
    daylight: "play ends {minutes} minutes before sunset",
  },
  home: {
    title: "{site} · Coed adult kickball in Brooklyn",
    sticker: "McCarren Park, Brooklyn ☀️",
    heroStart: "Kick a ball. Meet your new",
    heroSwipe: "favorite people.",
    intro:
      "Grown-up, coed kickball in Brooklyn for people who haven't played since recess. Bring a team or come solo and we'll find you one. Stick around after for a drink (or a seltzer).",
    signUp: "Sign up for a season",
    questions: "Questions? We've got answers",
    basics: "The basics",
    facts: {
      what: {
        term: "What",
        detail: "Coed kickball for adults. Friendly games, real standings.",
      },
      where: {
        term: "Where",
        detail: "McCarren Park, between Greenpoint and Williamsburg.",
        link: "Getting there",
      },
      when: {
        term: "When",
        detail:
          "Sunday afternoons in summer; weeknight evenings in spring and fall.",
        link: "Schedules and standings",
      },
      price: {
        term: "Price",
        detail:
          "Set each season and shown before you pay. Teams can split the fee.",
        link: "How fees work",
      },
    },
    waysIn: "Three ways in",
    ways: {
      team: {
        title: "Bring a team",
        body: "Register as captain, share one invite link in the group chat, and everyone signs up and pays their own share.",
      },
      friend: {
        title: "Join a friend's team",
        body: "Open your captain's invite link, sign the waiver, and you're on the roster.",
      },
      solo: {
        title: "Come solo",
        body: "Sign up as a free agent and we'll place you on a team. Half the fun is the new people.",
        link: "How solo signup works",
      },
    },
    afterTitle: "The game is half of it",
    afterBody:
      "Teams hang out after games, every season ends in playoffs, and most people leave with a few new friends. Nobody has to drink, and nobody has to be good at kickball.",
    aboutLink: "More about the league",
    photos: "Lately, on the field",
    opensPost: "(opens the post on Instagram)",
    newHere: "New to kickball, or to Brooklyn?",
    newHereLinks: {
      howToPlay: "How to play kickball",
      elsewhere: "Playing from elsewhere in NYC",
      solo: "Joining without a team",
    },
    league: {
      description: "{league}: seasons, schedules, standings, teams and events.",
      intro:
        "Seasons, schedules, standings and events for the {league}. Sign up with the same account you use for any league on this site.",
      seasons: "Seasons",
      noSeasons: "The first season's schedule shows here once it is published.",
      schedule: "Schedule",
      standings: "Standings",
      more: "More from the {league}",
      events: "Events",
      sponsors: "Sponsors",
      history: "League history",
      records: "Records",
    },
  },
  ...pagesEn,
  live: liveEn,
  share: shareEn,
  email: emailEn,
} as const;

export type EnglishMessages = typeof en;
