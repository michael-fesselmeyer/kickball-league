import type { Translation } from "../catalog";
import type { EnglishMessages } from "./en";
import { emailIt } from "./email.it";
import { pagesIt } from "./pages.it";

/**
 * Italian (ADR 0094). Machine-drafted without a paid service; a
 * native-speaking player reviews it before launch (docs/i18n.md). Casual
 * "tu", and the game words in the glossary there.
 */
export const it: Translation<EnglishMessages> = {
  shell: {
    brand: "Lega di Kickball",
    skipToContent: "Vai al contenuto",
    siteNav: "Sito",
    header: {
      nav: "Principale",
      schedule: "Calendario",
      standings: "Classifica",
      events: "Eventi",
      faq: "FAQ",
      join: "Iscriviti",
      signIn: "Accedi o apri l'app",
      menu: "Menu",
      close: "Chiudi",
      more: "Altro",
    },
    footer: {
      schedules: "Calendari",
      history: "Storia",
      about: "Chi siamo",
      events: "Eventi",
      faq: "Domande",
      contact: "Contatti",
      friends: "Amici",
      help: "Aiuto",
      park: "McCarren Park",
      rules: "Regole",
      sponsors: "Sponsor",
      signIn: "Accedi o apri l'app",
    },
    theme: {
      toLight: "Passa al tema chiaro",
      toDark: "Passa al tema scuro",
    },
    language: {
      group: "Lingua",
      current: "{language} (attuale)",
      report: "Hai notato una traduzione sbagliata o goffa? Dillo alla lega",
    },
  },
  profile: {
    language: {
      label: "Lingua",
      hint: "Email e notifiche arrivano in questa lingua. Per ora le schermate dell'app sono in inglese.",
      saved: "Salvato. Email e notifiche arriveranno in: {language}.",
      save: "Salva la lingua",
    },
  },
  formats: {
    teams: { $plural: { one: "{n} squadra", other: "{n} squadre" } },
    players: { $plural: { one: "{n} giocatore", other: "{n} giocatori" } },
  },
  faq: {
    title: "Domande frequenti",
    description:
      "Ti serve una squadra? Le squadre sono miste? Quanto costa, cosa mettersi e cosa succede se piove? Risposte rapide sul kickball per adulti a Brooklyn.",
    home: "Home",
    headingStart: "Domande,",
    headingSwipe: "risposte",
    intro:
      "In breve: le squadre sono miste, puoi venire da solo e nessuno deve essere bravo a kickball.",
    sections: "Sezioni delle domande",
    readyTitle: "Quando vuoi",
    readyBody:
      "Accedi con la tua email per iscrivere una squadra, entrare in una o venire da solo.",
    signUp: "Iscriviti a una stagione",
    joining: {
      title: "Iscriversi",
      team: {
        question: "Mi serve una squadra per iscrivermi?",
        answer:
          "No. Iscriviti come giocatore libero e la lega ti mette in una squadra prima che inizi la stagione. Tanti vengono da soli, ed è il modo più rapido per conoscere gente.",
      },
      friend: {
        question: "Come entro nella squadra di un amico?",
        answer:
          "Chiedi al tuo capitano il link d'invito della squadra. Aprilo, accedi con la tua email, firma la liberatoria e paga la tua quota se la squadra divide la tariffa. Fatto, sei in rosa.",
      },
      age: {
        question: "Quanti anni devo avere?",
        answer:
          "Per giocare devi avere almeno 18 anni. Alcuni eventi nei bar sono dai 21 anni in su, e la pagina dell'evento lo dice.",
      },
      skill: {
        question: "Devo essere bravo a kickball?",
        answer:
          "Per niente. Se ti ricordi la ricreazione, va benissimo. Le partite sono amichevoli, gli arbitri spiegano le decisioni e nessuno si offende per un calcio a vuoto.",
      },
    },
    season: {
      title: "La stagione",
      when: {
        question: "Quando si gioca?",
        answer:
          "Dipende dalla stagione e dai permessi del parco: la domenica pomeriggio d'estate, la sera nei giorni feriali in primavera e in autunno. La pagina di ogni stagione indica giorno e orari esatti prima che aprano le iscrizioni.",
      },
      where: {
        question: "Dove giochiamo?",
        answer:
          "A McCarren Park, a Brooklyn, al confine tra Greenpoint e Williamsburg. La pagina della tua partita indica il campo.",
        more: "Come arrivare a McCarren Park",
      },
      cost: {
        question: "Quanto costa?",
        answer:
          "La quota si fissa a ogni stagione e la trovi sulla pagina della stagione, con quello che include, prima di pagare qualsiasi cosa. Alcune stagioni si pagano a giocatore, altre a squadra. Quando una squadra divide la quota, ognuno paga la sua parte online.",
      },
      length: {
        question: "Quanto dura una partita?",
        answer:
          "Ogni partita sta in un'ora, così finisci in tempo per cena o per un drink (o un'acqua frizzante) con la squadra.",
      },
      coed: {
        question: "La lega è mista?",
        answer:
          "Sì. Tutte le squadre giocano miste, e le formazioni seguono la regola della lega sull'equilibrio tra uomini e donne, che il capitano e l'arbitro tengono d'occhio.",
      },
      rain: {
        question: "E se piove?",
        answer:
          "Una persona della lega segue le previsioni e decide, di solito il giorno prima. Se la tua partita viene rinviata per pioggia, lo vedi sulla pagina della partita, e lì compare anche il recupero quando viene fissato.",
      },
    },
    gameDay: {
      title: "Il giorno della partita",
      wear: {
        question: "Cosa mi metto?",
        answer:
          "Scarpe da ginnastica o da calcetto, qualcosa del colore della tua squadra e uno strato in più per le partite serali. D'estate porta acqua e crema solare.",
      },
      drink: {
        question: "Devo bere per forza?",
        answer:
          "No. Restare insieme dopo la partita fa parte del divertimento, ma che sia un drink o un'acqua frizzante lo decidi tu, e in tanti se ne vanno a casa. Si beve solo dopo la partita, perché nei parchi della città l'alcol non è permesso.",
      },
      watch: {
        question: "Gli amici possono venire a guardare?",
        answer:
          "Certo. È un parco pubblico, e qualche tifoso a bordo campo non ha mai fatto male a nessuno.",
      },
    },
  },
  schedule: {
    title: "Calendario",
    seasonTitle: "Calendario: {season}",
    divisionTitle: "Calendario: {division}",
    namedTitle: "{name}: calendario {season}",
    thisWeek: "Vai a questa settimana",
    seasonNav: "Stagione",
    standings: "Classifica",
    playoffs: "Playoff",
    statusLabel: "Stato della giornata",
    divisionsNav: "Divisioni",
    allDivisions: "Tutte le divisioni",
    comingSoon: "In arrivo",
    comingSoonBody:
      "Il calendario esce circa una settimana prima della prima giornata. Iscriviti ora e ti scriviamo quando è pronto.",
    team: "Squadra",
    allTeams: "Tutte le squadre",
    show: "Mostra",
    teamPage: "Pagina e calendario di {team}",
    showingTeam: {
      $plural: {
        one: "{n} partita di {name}.",
        other: "{n} partite di {name}.",
      },
    },
    showingAll: {
      $plural: { one: "{n} partita.", other: "Tutte le {n} partite." },
    },
    themeWeek: "Settimana a tema:",
    open: "Libero",
    crossover: "Incrocio",
    makeups: "Recuperi da fissare",
    makeupsBody:
      "Queste partite hanno bisogno di una nuova data. Compaiono qui, sulle pagine delle squadre e nei calendari appena la lega la fissa.",
    kickoff: "Inizio",
    fieldTba: "Campo da definire",
    timeTba: "Orario da definire",
  },
  gameStatus: {
    cancelled: "Annullata",
    postponed: "Rinviata",
    rainedOut: "Rinviata per pioggia",
    final: "Finale",
    ruling: "Decisione",
    forfeit: "Forfait",
    live: "In diretta",
  },
  gameday: {
    updated: "Aggiornato alle {time}",
    gamesOn: "Si gioca.",
    watchingDay: "Teniamo d'occhio il meteo: decidiamo entro le {time}.",
    someLate: "Alcune partite iniziano in ritardo.",
    allLate: "Tutte le partite iniziano in ritardo.",
    someOff: "Alcune partite sono annullate.",
    allOff: "Tutte le partite sono annullate.",
    watchingGame: "Teniamo d'occhio il meteo: decisione entro le {time}",
    startsLate: "Inizia in ritardo: {time}",
    off: "Annullata",
  },
  ruleSet: {
    innings: { $plural: { one: "{n} inning", other: "{n} inning" } },
    timeLimit: "limite di {minutes} minuti",
    bunting: "bunt permesso",
    noBunting: "niente bunt",
    stealing: "rubare la base permesso",
    noStealing: "niente basi rubate",
    bestOf: "al meglio di {n} set",
    daylight: "si smette {minutes} minuti prima del tramonto",
  },
  home: {
    title: "{site} · Kickball misto per adulti a Brooklyn",
    sticker: "McCarren Park, Brooklyn ☀️",
    heroStart: "Calcia un pallone. Conosci le tue nuove",
    heroSwipe: "persone preferite.",
    intro:
      "Kickball misto per adulti a Brooklyn, per chi non gioca dai tempi della ricreazione. Porta una squadra o vieni da solo e te ne troviamo una. Poi resta per un drink (o un'acqua frizzante).",
    signUp: "Iscriviti a una stagione",
    questions: "Domande? Abbiamo le risposte",
    basics: "L'essenziale",
    facts: {
      what: {
        term: "Cosa",
        detail:
          "Kickball misto per adulti. Partite amichevoli, classifica vera.",
      },
      where: {
        term: "Dove",
        detail: "McCarren Park, tra Greenpoint e Williamsburg.",
        link: "Come arrivare",
      },
      when: {
        term: "Quando",
        detail:
          "La domenica pomeriggio d'estate; la sera nei giorni feriali in primavera e in autunno.",
        link: "Calendari e classifiche",
      },
      price: {
        term: "Prezzo",
        detail:
          "Si fissa a ogni stagione e lo vedi prima di pagare. Le squadre possono dividere la quota.",
        link: "Come funzionano le quote",
      },
    },
    waysIn: "Tre modi per entrare",
    ways: {
      team: {
        title: "Porta una squadra",
        body: "Iscriviti come capitano, condividi un link d'invito nella chat di gruppo e ognuno si iscrive e paga la sua parte.",
      },
      friend: {
        title: "Entra nella squadra di un amico",
        body: "Apri il link d'invito del tuo capitano, firma la liberatoria e sei in rosa.",
      },
      solo: {
        title: "Vieni da solo",
        body: "Iscriviti come giocatore libero e ti mettiamo in una squadra. Metà del divertimento sono le persone nuove.",
        link: "Come funziona l'iscrizione da soli",
      },
    },
    afterTitle: "La partita è solo metà",
    afterBody:
      "Le squadre restano insieme dopo le partite, ogni stagione finisce con i playoff e quasi tutti se ne vanno con qualche amico nuovo. Nessuno deve bere e nessuno deve essere bravo a kickball.",
    aboutLink: "Di più sulla lega",
    photos: "Ultimamente, in campo",
    opensPost: "(apre il post su Instagram)",
    newHere: "Nuovo al kickball, o a Brooklyn?",
    newHereLinks: {
      howToPlay: "Come si gioca a kickball",
      elsewhere: "Se vieni da un'altra zona di New York",
      solo: "Iscriversi senza squadra",
    },
    league: {
      description:
        "{league}: stagioni, calendari, classifiche, squadre ed eventi.",
      intro:
        "Stagioni, calendari, classifiche ed eventi di {league}. Iscriviti con lo stesso account che usi per qualsiasi lega di questo sito.",
      seasons: "Stagioni",
      noSeasons:
        "Il calendario della prima stagione compare qui appena viene pubblicato.",
      schedule: "Calendario",
      standings: "Classifica",
      more: "Altro da {league}",
      events: "Eventi",
      sponsors: "Sponsor",
      history: "Storia della lega",
      records: "Record",
    },
  },
  ...pagesIt,
  email: emailIt,
};
