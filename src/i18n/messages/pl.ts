import type { Translation } from "../catalog";
import type { EnglishMessages } from "./en";
import { emailPl } from "./email.pl";
import { pagesPl } from "./pages.pl";

/**
 * Polish (ADR 0065). Machine-drafted without a paid service; a
 * native-speaking player reviews it before launch (docs/i18n.md). Casual
 * "ty", and the game words in the glossary there.
 */
export const pl: Translation<EnglishMessages> = {
  shell: {
    brand: "Liga Kickballa",
    skipToContent: "Przejdź do treści",
    siteNav: "Strona",
    footer: {
      schedules: "Terminarze",
      history: "Historia",
      about: "O lidze",
      events: "Wydarzenia",
      faq: "Pytania i odpowiedzi",
      contact: "Kontakt",
      friends: "Przyjaciele",
      help: "Pomoc",
      park: "McCarren Park",
      rules: "Zasady",
      sponsors: "Sponsorzy",
      signIn: "Zaloguj się",
    },
    theme: {
      group: "Motyw kolorów",
      system: "Auto",
      light: "Jasny",
      dark: "Ciemny",
    },
    language: {
      group: "Język",
      current: "{language} (wybrany)",
      report: "Widzisz błędne lub niezgrabne tłumaczenie? Daj znać lidze",
    },
  },
  profile: {
    language: {
      label: "Język",
      hint: "E-maile i powiadomienia przychodzą w tym języku. Ekrany aplikacji są na razie po angielsku.",
      saved:
        "Zapisano. E-maile i powiadomienia będą przychodzić w języku: {language}.",
      save: "Zapisz język",
    },
  },
  formats: {
    teams: {
      $plural: {
        one: "{n} drużyna",
        few: "{n} drużyny",
        many: "{n} drużyn",
        other: "{n} drużyny",
      },
    },
    players: {
      $plural: {
        one: "{n} gracz",
        few: "{n} gracze",
        many: "{n} graczy",
        other: "{n} gracza",
      },
    },
  },
  faq: {
    title: "Pytania i odpowiedzi",
    description:
      "Czy potrzebujesz drużyny? Czy grają razem kobiety i mężczyźni? Ile to kosztuje, w co się ubrać i co się dzieje, gdy pada? Krótkie odpowiedzi o kickballu dla dorosłych na Brooklynie.",
    home: "Strona główna",
    headingStart: "Pytania?",
    headingSwipe: "Mamy odpowiedzi",
    intro:
      "W skrócie: drużyny są mieszane, możesz przyjść sam(a) i nikt nie musi świetnie grać w kickballa.",
    sections: "Działy",
    readyTitle: "Czekamy na ciebie",
    readyBody:
      "Zaloguj się e-mailem, żeby zgłosić drużynę, dołączyć do niej albo przyjść sam(a).",
    signUp: "Zapisz się na sezon",
    joining: {
      title: "Dołączanie",
      team: {
        question: "Czy potrzebuję drużyny, żeby dołączyć?",
        answer:
          "Nie. Zapisz się jako wolny zawodnik, a liga przydzieli cię do drużyny przed startem sezonu. Wiele osób przychodzi samych i to najszybszy sposób, żeby kogoś poznać.",
      },
      friend: {
        question: "Jak dołączyć do drużyny znajomego?",
        answer:
          "Poproś kapitana o link z zaproszeniem do drużyny. Otwórz go, zaloguj się e-mailem, podpisz oświadczenie (waiver) i zapłać swoją część, jeśli drużyna dzieli opłatę. To wszystko, jesteś w składzie.",
      },
      age: {
        question: "Ile trzeba mieć lat?",
        answer:
          "Grać można od 18 lat. Niektóre spotkania w barach są od 21 lat — strona wydarzenia to mówi.",
      },
      skill: {
        question: "Czy muszę dobrze grać w kickballa?",
        answer:
          "Wcale nie. Jeśli pamiętasz szkolne przerwy, masz kwalifikacje. Mecze są przyjazne, sędziowie tłumaczą decyzje i nikt się nie przejmuje pudłem.",
      },
    },
    season: {
      title: "Sezon",
      when: {
        question: "Kiedy są mecze?",
        answer:
          "To zależy od sezonu i pozwoleń parku: latem w niedzielne popołudnia, wiosną i jesienią w wieczory w tygodniu. Strona każdego sezonu podaje dokładny dzień i godziny, zanim ruszą zapisy.",
      },
      where: {
        question: "Gdzie gramy?",
        answer:
          "W McCarren Park na Brooklynie, na granicy Greenpoint i Williamsburga. Strona meczu podaje twoje boisko.",
        more: "Jak dotrzeć do McCarren Park",
      },
      cost: {
        question: "Ile to kosztuje?",
        answer:
          "Opłata jest ustalana co sezon i pokazana na stronie sezonu razem z tym, co obejmuje, zanim cokolwiek zapłacisz. Czasem płaci się za zawodnika, czasem za drużynę. Gdy drużyna dzieli opłatę, każdy płaci swoją część online.",
      },
      length: {
        question: "Ile trwa mecz?",
        answer:
          "Każdy mecz mieści się w godzinie, więc zdążysz na kolację albo na drinka (albo wodę gazowaną) z drużyną.",
      },
      coed: {
        question: "Czy liga jest mieszana?",
        answer:
          "Tak. Każda drużyna gra w składzie mieszanym, a skład meczowy spełnia ligową zasadę równowagi płci, której pilnują kapitan i sędzia.",
      },
      rain: {
        question: "Co się dzieje, gdy pada?",
        answer:
          "Ktoś z ligi śledzi prognozę i podejmuje decyzję, zwykle dzień wcześniej. Jeśli twój mecz zostanie odwołany z powodu deszczu, zobaczysz to na stronie meczu, a termin meczu zaległego pojawi się tam, gdy zostanie ustalony.",
      },
    },
    gameDay: {
      title: "Dzień meczu",
      wear: {
        question: "W co się ubrać?",
        answer:
          "Sportowe buty lub turfy, coś w kolorze twojej drużyny i bluzę na wieczorne mecze. Latem weź wodę i krem z filtrem.",
      },
      drink: {
        question: "Czy muszę pić?",
        answer:
          "Nie. Wspólne wyjście po meczu to część zabawy, ale piwo czy woda gazowana — to twój wybór, a sporo osób w ogóle zostaje w domu. Napoje dopiero po meczu, bo w miejskich parkach alkohol jest zabroniony.",
      },
      watch: {
        question: "Czy znajomi mogą przyjść kibicować?",
        answer:
          "Jasne. To publiczny park, a kilku kibiców przy linii jeszcze nikomu nie zaszkodziło w kopaniu.",
      },
    },
  },
  schedule: {
    title: "Terminarz",
    seasonTitle: "Terminarz: {season}",
    divisionTitle: "Terminarz: {division}",
    seasonNav: "Sezon",
    standings: "Tabela",
    playoffs: "Play-offy",
    statusLabel: "Status dnia meczowego",
    divisionsNav: "Dywizje",
    allDivisions: "Wszystkie dywizje",
    comingSoon: "Wkrótce",
    comingSoonBody:
      "Terminarz pojawia się mniej więcej tydzień przed pierwszym dniem meczowym. Zapisz się teraz, a napiszemy, gdy będzie gotowy.",
    team: "Drużyna",
    allTeams: "Wszystkie drużyny",
    show: "Pokaż",
    teamPage: "Strona i kalendarz drużyny {team}",
    showingTeam: {
      $plural: {
        one: "{n} mecz drużyny {name}.",
        few: "{n} mecze drużyny {name}.",
        many: "{n} meczów drużyny {name}.",
        other: "{n} meczu drużyny {name}.",
      },
    },
    showingAll: {
      $plural: {
        one: "{n} mecz.",
        few: "Wszystkie mecze: {n}.",
        many: "Wszystkie mecze: {n}.",
        other: "Wszystkie mecze: {n}.",
      },
    },
    themeWeek: "Tydzień tematyczny:",
    open: "Wolne",
    crossover: "Międzydywizyjny",
    makeups: "Mecze zaległe do ustalenia",
    makeupsBody:
      "Te mecze potrzebują nowej daty. Pojawią się tutaj, na stronach drużyn i w kalendarzach, gdy tylko liga ją ustali.",
    kickoff: "Początek",
    fieldTba: "Boisko do ustalenia",
    timeTba: "Godzina do ustalenia",
  },
  gameStatus: {
    cancelled: "Odwołany",
    postponed: "Przełożony",
    rainedOut: "Odwołany przez deszcz",
    final: "Koniec",
    forfeit: "Walkower",
    live: "Na żywo",
  },
  gameday: {
    updated: "Aktualizacja: {time}",
    gamesOn: "Mecze się odbywają.",
    watchingDay: "Śledzimy pogodę: zdecydujemy do {time}.",
    someLate: "Niektóre mecze zaczną się później.",
    allLate: "Wszystkie mecze zaczną się później.",
    someOff: "Niektóre mecze są odwołane.",
    allOff: "Wszystkie mecze są odwołane.",
    watchingGame: "Śledzimy pogodę: decyzja do {time}",
    startsLate: "Później: {time}",
    off: "Odwołany",
  },
  ruleSet: {
    innings: {
      $plural: {
        one: "{n} zmiana",
        few: "{n} zmiany",
        many: "{n} zmian",
        other: "{n} zmiany",
      },
    },
    timeLimit: "limit {minutes} min",
    bunting: "bunt dozwolony",
    noBunting: "bez buntu",
    stealing: "kradzież bazy dozwolona",
    noStealing: "bez kradzieży bazy",
  },
  home: {
    title: "{site} · Mieszany kickball dla dorosłych na Brooklynie",
    sticker: "McCarren Park, Brooklyn ☀️",
    heroStart: "Kopnij piłkę. Poznaj swoich nowych",
    heroSwipe: "ulubionych ludzi.",
    intro:
      "Mieszany kickball dla dorosłych na Brooklynie, dla tych, którzy nie grali od szkolnych przerw. Przyjdź z drużyną albo sam(a), a my znajdziemy ci drużynę. Po meczu zostań na drinka (albo wodę gazowaną).",
    signUp: "Zapisz się na sezon",
    questions: "Pytania? Mamy odpowiedzi",
    basics: "Najważniejsze",
    facts: {
      what: {
        term: "Co",
        detail:
          "Mieszany kickball dla dorosłych. Przyjazne mecze, prawdziwa tabela.",
      },
      where: {
        term: "Gdzie",
        detail: "McCarren Park, między Greenpoint a Williamsburgiem.",
        link: "Jak dojechać",
      },
      when: {
        term: "Kiedy",
        detail:
          "Latem w niedzielne popołudnia; wiosną i jesienią w wieczory w tygodniu.",
        link: "Terminarze i tabele",
      },
      price: {
        term: "Cena",
        detail:
          "Ustalana co sezon i widoczna przed płatnością. Drużyny mogą dzielić opłatę.",
        link: "Jak działają opłaty",
      },
    },
    waysIn: "Trzy sposoby, żeby dołączyć",
    ways: {
      team: {
        title: "Przyjdź z drużyną",
        body: "Zgłoś się jako kapitan, wrzuć jeden link z zaproszeniem na czat grupy, a każdy zapisze się i zapłaci swoją część.",
      },
      friend: {
        title: "Dołącz do drużyny znajomego",
        body: "Otwórz link kapitana, podpisz oświadczenie (waiver) i jesteś w składzie.",
      },
      solo: {
        title: "Przyjdź sam(a)",
        body: "Zapisz się jako wolny zawodnik, a przydzielimy cię do drużyny. Połowa zabawy to nowi ludzie.",
        link: "Jak działa zapis indywidualny",
      },
    },
    afterTitle: "Mecz to tylko połowa",
    afterBody:
      "Drużyny spędzają czas razem po meczach, każdy sezon kończy się play-offami, a większość wychodzi z kilkoma nowymi znajomymi. Nikt nie musi pić i nikt nie musi świetnie grać w kickballa.",
    aboutLink: "Więcej o lidze",
    photos: "Ostatnio na boisku",
    opensPost: "(otwiera post na Instagramie)",
    newHere: "Pierwszy raz z kickballem albo na Brooklynie?",
    newHereLinks: {
      howToPlay: "Jak grać w kickballa",
      elsewhere: "Jeśli jesteś z innej części Nowego Jorku",
      solo: "Jak dołączyć bez drużyny",
    },
    league: {
      description:
        "{league}: sezony, terminarze, tabele, drużyny i wydarzenia.",
      intro:
        "Sezony, terminarze, tabele i wydarzenia ligi {league}. Zapisz się tym samym kontem, którego używasz w każdej lidze na tej stronie.",
      seasons: "Sezony",
      noSeasons: "Terminarz pierwszego sezonu pojawi się tutaj po publikacji.",
      schedule: "Terminarz",
      standings: "Tabela",
      more: "Więcej od ligi {league}",
      events: "Wydarzenia",
      sponsors: "Sponsorzy",
      history: "Historia ligi",
      records: "Rekordy",
    },
  },
  ...pagesPl,
  email: emailPl,
};
