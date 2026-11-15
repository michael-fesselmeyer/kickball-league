/**
 * The English messages: the source every other language translates
 * (ADR 0065). Add a message here first; `npm test` then lists it as
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
      group: "Color theme",
      system: "Auto",
      light: "Light",
      dark: "Dark",
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
} as const;

export type EnglishMessages = typeof en;
