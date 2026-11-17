import type { Translation } from "../catalog";
import type { liveEn } from "./live.en";
import type { pagesEn } from "./pages.en";
import type { shareEn } from "./share.en";

/**
 * The public pages beyond home, FAQ and schedule, in Italian. Casual "tu",
 * and the game words in the glossary in docs/i18n.md. Ordinals come as
 * "3º", or "3ª" for an inning ("ripresa"), from `formatOrdinal`.
 */
export const pagesIt: Translation<
  typeof pagesEn & { live: typeof liveEn; share: typeof shareEn }
> = {
  about: {
    title: "Chi siamo",
    description:
      "Una lega di kickball mista e sociale per adulti a McCarren Park, Brooklyn. Come funziona una stagione, a chi è rivolta e le poche cose che chiediamo a tutti.",
    home: "Home",
    crumb: "Chi siamo",
    sticker: "Divertiti, conosci gente",
    headingStart: "Una lega di kickball per",
    headingSwipe: "conoscere gente",
    intro:
      "Siamo una lega di kickball mista per adulti a McCarren Park, Brooklyn. Si viene per la partita, si resta per le persone e si torna stagione dopo stagione. Abbastanza competitivi da tenere al punteggio, abbastanza rilassati che a nessuno importa se manchi il pallone.",
    whoTitle: "Chi gioca",
    whoBody:
      "Adulti dai 18 anni in su da tutta la città: appena arrivati, vecchi amici, colleghi, coinquilini, gente che vuole solo un motivo per stare all'aperto la domenica. Tanti non giocano a kickball dai tempi della scuola, e va benissimo. Non ti serve una squadra: i giocatori liberi vengono messi in una squadra prima che inizi la stagione.",
    seasonTitle: "Come funziona una stagione",
    steps: {
      signUp: {
        title: "Iscriviti",
        body: "Iscrivi una squadra, entra in una con il link d'invito del tuo capitano o vieni da solo come giocatore libero. Tutti firmano la liberatoria della stagione e pagano online.",
      },
      schedule: {
        title: "Ricevi il calendario",
        body: "Il calendario esce circa una settimana prima della prima giornata. Ogni squadra ha un giusto mix di partite presto e tardi.",
      },
      play: {
        title: "Gioca ogni settimana",
        body: "Un arbitro per partita, risultati pubblicati dopo ogni partita e una classifica che si aggiorna da sola.",
      },
      playoffs: {
        title: "Playoff",
        body: "La stagione finisce con i playoff e una squadra campione che può vantarsene fino alla stagione dopo.",
      },
    },
    houseRulesTitle: "Le regole della casa",
    houseRulesIntro:
      "Il regolamento copre il gioco. Queste coprono tutto il resto:",
    houseRules: {
      friendly:
        "Resta amichevole. Applaudi i bei calci, anche quelli dell'altra squadra.",
      refs: "Tratta bene gli arbitri. Quasi tutti giocano anche nella lega.",
      drink:
        "Nessuno deve bere. Un'acqua frizzante dopo la partita vale lo stesso.",
      field:
        "Lascia il campo meglio di come l'hai trovato. È un parco pubblico e siamo ospiti.",
    },
    questionsTitle: "Domande?",
    questionsBody:
      "Le domande frequenti parlano di quote, partite rinviate per pioggia, cosa mettersi e altro. Quando sei in una squadra, il tuo capitano è il modo più rapido per raggiungere la lega. Vicini, personale del parco e visitatori possono scrivere alla lega senza un account.",
    readFaq: "Leggi le domande frequenti",
    findFields: "Trova i campi",
    contact: "Contatta la lega",
  },
  park: {
    title: "Kickball a McCarren Park, Brooklyn",
    description:
      "Dove gioca la lega a McCarren Park, al confine tra Greenpoint e Williamsburg: metro, bici, cosa portare e come trovare il tuo campo.",
    home: "Home",
    sticker: "Il nostro campo di casa 🏟️",
    headingStart: "Kickball a",
    intro:
      "Ogni partita della lega si gioca a McCarren Park, il grande quadrato verde dove Greenpoint incontra Williamsburg, nel nord di Brooklyn. Ecco come arrivarci e cosa portare.",
    whereTitle: "Dove giochiamo",
    fields:
      "Il parco ha diversi campi. La pagina della tua partita indica il tuo, quindi controllala prima di uscire.",
    fieldsToday: "Guarda chi ha quale campo oggi",
    map: "Apri McCarren Park sulla mappa",
    gettingThere: "Come arrivare",
    ways: {
      g: {
        how: "Metro G",
        detail: "Stazione Nassau Av, a un isolato dal lato est del parco.",
      },
      l: {
        how: "Metro L",
        detail:
          "Stazione Bedford Av, circa dieci minuti a piedi a sud del parco.",
      },
      bike: {
        how: "Bici",
        detail:
          "Ci sono stazioni Citi Bike lungo il bordo del parco. Lega la bici fuori dal campo.",
      },
    },
    bringTitle: "Cosa portare",
    bring: {
      shoes: "Scarpe da ginnastica o da calcetto",
      color: "Qualcosa del colore della tua squadra",
      water: "Acqua, e crema solare d'estate",
      layer: "Uno strato in più per le partite serali",
    },
    drinks:
      "Si beve solo dopo la partita: nei parchi della città l'alcol non è permesso. Di solito le squadre vanno poi in un posto vicino per un drink (o un'acqua frizzante).",
    playTitle: "Gioca qui in questa stagione",
    playBody:
      "Porta una squadra o vieni da solo. Giorni e orari sono sulla pagina di ogni stagione prima che aprano le iscrizioni.",
    signUp: "Iscriviti a una stagione",
    readFaq: "Leggi le domande frequenti",
    report: "Segnala un problema al campo",
  },
  stats: {
    outcome: { W: "V", L: "S", T: "P" },
    blurb: {
      top_clash:
        "Due delle prime tre del power ranking. {a} e {b} decidono chi comanda davvero.",
      close_rematch:
        "L'ultima volta è finita sul filo. {a} e {b} ci riprovano.",
      evenly_matched:
        "{a} e {b} sono appaiate nel power ranking. Porta una sedia pieghevole.",
      best_available:
        "La sfida più equilibrata della giornata: {a} contro {b}.",
    },
    movementNew: "Nuova",
    movementNewWords: "Nuova questa settimana",
    movementSame: "Nessun cambio",
    movementUp: {
      $plural: { one: "Su di {n} posto", other: "Su di {n} posti" },
    },
    movementDown: {
      $plural: { one: "Giù di {n} posto", other: "Giù di {n} posti" },
    },
    onFire: "{name} sono in fiamme: {n} vittorie di fila.",
    wonStraight: "{name} hanno vinto {n} partite di fila.",
    droppedRow: "{name} hanno perso {n} partite di fila. Si può solo risalire.",
    lostStraight: "{name} hanno perso {n} di fila: tocca a loro.",
    tiedRow: "{name} hanno pareggiato {n} di fila. Un equilibrio notevole.",
    firstMeeting: "Primo incontro",
    seriesTied: "Serie in parità {score}",
    seriesLead: "{team} avanti nella serie {score}",
    gameOfTheWeek: "Partita della settimana",
    vs: "{a} contro {b}",
    powerTitle: "Power ranking",
    powerEmpty: "Il ranking parte dopo la prima giornata.",
    powerIntro:
      "Chi sta giocando meglio adesso: risultati, le ultime tre partite, differenza punti e quanto erano forti gli avversari.",
    records: "Record della lega",
    numbersTitle: "In numeri",
    powerRank: "Posizione nel ranking",
    streak: "Serie",
    bestRun: "Serie migliore",
    rivalries: "Rivalità",
    headToHead: "Scontri diretti",
    seasonStreaks: "Le serie di questa stagione: {list}.",
    teamStreak: "{team} {streak}",
    noneYet: "ancora nessuna",
    tiedScore: "Pari {score}",
    byForfeit: "{team} a tavolino",
    wonScore: "{team} {score}",
  },
  standings: {
    title: "Classifica",
    seasonTitle: "Classifica: {season}",
    seasonNav: "Stagione",
    schedule: "Calendario",
    playoffs: "Playoff",
    noGames:
      "Nessuna partita giocata finora. La tabella si riempie man mano che arrivano i risultati.",
    noDivision: "Nessuna divisione",
    divisionSchedule: "Calendario: {division}",
    caption:
      "Classifica {season}: vittorie, sconfitte, pareggi, percentuale di vittorie, {units} e forma recente",
    divisionCaption:
      "Classifica {season}, {division}: vittorie, sconfitte, pareggi, percentuale di vittorie, {units} e forma recente",
    tiebreakers: "Criteri di spareggio",
    placedBelow: "{team} è finita dietro la squadra sopra per {by}.",
    by: {
      head_to_head: "scontri diretti",
      coin_flip: "lancio della moneta",
    },
    howRanked:
      "Un pareggio vale mezza vittoria. A parità in classifica contano gli scontri diretti, poi la {difference}{capped}, poi i {allowed} e infine il lancio della moneta.",
    capped: " (al massimo {cap} a partita)",
    diffCapped: ", al massimo {cap} a partita",
    crossovers:
      "Ogni squadra è classificata nella sua divisione, e le partite contro l'altra divisione contano per il suo bilancio.",
    divisionOnly:
      "Ogni squadra è classificata nella sua divisione solo con le partite della divisione.",
    home: "Home",
    team: "Squadra",
    columns: {
      rank: { short: "#", long: "Posizione" },
      wins: { short: "V", long: "Vittorie" },
      losses: { short: "S", long: "Sconfitte" },
      ties: { short: "P", long: "Pareggi" },
      pct: {
        short: "PCT",
        long: "Percentuale di vittorie, con il pareggio che vale mezza vittoria",
      },
      runsFor: { short: "{letter}F", long: "{Units} fatti" },
      runsAgainst: { short: "{letter}S", long: "{Units} subiti" },
      diff: { short: "DIFF", long: "{Difference}" },
      streak: { short: "SERIE", long: "Serie in corso" },
      lastFive: {
        short: "U5",
        long: "Ultime cinque partite, dalla più vecchia",
      },
    },
  },
  sports: {
    kickball: {
      one: "punto",
      many: "punti",
      letter: "P",
      difference: "differenza punti",
      allowed: "punti subiti",
    },
    dodgeball: {
      one: "set",
      many: "set",
      letter: "S",
      difference: "differenza set",
      allowed: "set persi",
    },
  },
  team: {
    title: "Squadra",
    description:
      "{team}: calendario, risultati, rosa e calendario da abbonarsi.",
    standing: "{record}, {rank} posto",
    share: "Condividi questa squadra",
    shareText: "Calendario, risultati e calendario da abbonarsi:",
    seasons: "Stagioni",
    next: "Prossima partita",
    noGames:
      "Ancora nessuna partita in calendario. Esce circa una settimana prima della prima giornata.",
    wrap: "È finita: nessuna partita rimasta in questa stagione. Grazie per aver giocato!",
    coming: "In arrivo",
    results: "Risultati",
    noResults: "Ancora nessun risultato. Il primo lancio è il più difficile.",
    awaiting: "Risultati in arrivo",
    photos: "Foto",
    calendarTitle: "Non perderti nessuna partita",
    calendarBody:
      "Abbonati una volta e ogni partita finisce nel tuo calendario, nel fuso orario della lega. Spostamenti e rinvii per pioggia si aggiornano da soli.",
    apple: "Apple o Outlook",
    google: "Google Calendar",
    newTab: " (si apre in una nuova scheda)",
    paste: "Oppure incolla questo link in qualsiasi app di calendario",
    roster: "Rosa",
    rosterEmpty: "La rosa si riempie man mano che entrano i giocatori.",
    captain: "Capitano",
    coCaptain: "Vicecapitano",
    awards: "Premi {season}",
    fullSchedule: "{team} nel calendario completo",
    resultsCaption: "Risultati, dal più vecchio",
    date: "Data",
    opponent: "Avversario",
    result: "Risultato",
    score: "Punteggio",
    forfeit: "Forfait",
    outcome: { W: "Vittoria", L: "Sconfitta", T: "Pareggio" },
  },
  game: {
    title: "Partita",
    seasonWhen: "{season}: {when}",
    seasonTba: "{season}: orario da definire",
    breadcrumb: "Percorso",
    vs: "contro",
    when: "Quando",
    tba: "Orario da definire",
    offNote:
      "Questa partita è annullata. La lega pubblica qui e nei calendari la data del recupero appena la fissa.",
    makeupWaiting: "Questo recupero aspetta uno slot libero.",
    where: "Dove",
    openMaps: "Apri in Mappe",
    newTab: " (si apre in una nuova scheda)",
    fieldTba: "Campo da definire",
    tellChat: "Dillo alla chat di gruppo",
    share: "Condividi questa partita",
    calendarTitle: "Aggiungila al calendario",
    calendarBody:
      "La pagina di ogni squadra ha un calendario con tutte le partite, sempre aggiornato.",
    teamGames: "Partite di {team}",
    winByForfeit: "{team} vince a tavolino",
    forecast: "{temperature}°F · {chance}% di probabilità di pioggia",
    forecastSource:
      "{summary}. Previsioni del National Weather Service degli Stati Uniti.",
    noForecast: "Ancora nessuna previsione",
    noForecastNote: "Le previsioni arrivano fino a una settimana prima.",
    shareResult: "{status}: {result}",
    shareOff: "{status}: {matchup} è annullata.",
    shareOffAt: "{status}: {matchup} ({time}) è annullata.",
    shareMakeup: "Il recupero entra in calendario appena la lega lo fissa.",
    shareLive: "In diretta ora: {matchup}",
    shareOn: "Si gioca: {matchup}",
  },
  photos: {
    title: "Foto dei giocatori",
    none: "Ancora nessuna foto.",
    gotOne: "Ne hai una bella?",
    share: "Condividi una foto",
    alt: "Foto di un giocatore: {about}",
  },
  allTime: {
    title: "Di sempre",
    record: "Vittorie, sconfitte, pareggi",
    seasons: "Stagioni",
    pct: "% vittorie",
    diff: "Diff. punti",
    titles: "Titoli",
    champions: {
      $plural: { one: "Campioni", other: "Campioni {n} volte" },
    },
    note: "Partite di stagione regolare in tutte le stagioni giocate da {team}.",
    history: "Storia della lega",
  },
  awardLabels: {
    season_mvp: "MVP della stagione",
    iron_kicker: "Calciatore di ferro",
    golden_boot: "Scarpa d'oro",
    best_teammate: "Miglior compagno di squadra",
    rookie_of_the_year: "Esordiente dell'anno",
    sub_of_the_year: "Sostituto dell'anno",
  },
  eventKinds: {
    social: "Ritrovo",
    bar_night: "Serata al bar",
    bbq: "Grigliata",
    tournament: "Torneo",
    theme_week: "Settimana a tema",
    party: "Festa",
    pickup: "Partita aperta",
    practice: "Allenamento",
  },
  eventCard: {
    calledOff: "Annullato",
    rsvpOn: "Conferma su {site}",
    going: "{n} partecipanti",
    full: "Completo: lista d'attesa aperta",
    spotsLeft: {
      $plural: { one: "{n} posto libero", other: "{n} posti liberi" },
    },
    freeForMembers: "Gratis per i soci, altrimenti {price}",
    memberPrice: "{price} ({member} per i soci)",
    tagged: "{kind} · {tag}",
  },
  events: {
    title: "Eventi",
    description:
      "Serate al bar, grigliate, tornei e settimane a tema: il calendario sociale della lega, con conferme di partecipazione e un calendario da abbonarsi.",
    headingStart: "Eventi",
    headingSwipe: "della lega",
    intro:
      "Le partite sono la scusa; le persone sono il punto. Vieni a una serata al bar, a una grigliata, a un torneo o a una settimana a tema. Ogni evento è facoltativo, e non devi mai bere per partecipare.",
    loading: "Caricamento degli eventi…",
    coming: "In arrivo",
    empty:
      "Al momento non c'è niente in calendario. I nuovi eventi compaiono qui e nel calendario qui sotto appena la lega li pubblica.",
    rsvpStart: "Conferma la partecipazione dalla pagina dell'evento dopo aver",
    signIn: "effettuato l'accesso",
    rsvpEnd:
      ". Quando un evento è completo, puoi entrare in lista d'attesa; ti scriviamo se si libera un posto.",
    playerRun: "Organizzati dai nostri giocatori",
    moreFriends: "Altri amici della lega",
    calendarTitle: "Aggiungi gli eventi al calendario",
    calendarBody:
      "Abbonati una volta e nuovi eventi, modifiche e annullamenti compaiono da soli, nel fuso orario della lega.",
    apple: "Apple o Outlook",
    google: "Google Calendar",
    newTab: " (si apre in una nuova scheda)",
    ics: "Scarica .ics",
    recently: "Di recente",
    anotherSite: " (un altro sito)",
  },
  event: {
    title: "Evento",
    loading: "Caricamento dell'evento…",
    home: "Home",
    events: "Eventi",
    breadcrumb: "Percorso",
    allEvents: "Tutti gli eventi",
    calledOff: "Annullato",
    when: "Quando",
    where: "Dove",
    openMaps: "Apri in Mappe",
    newTab: " (si apre in una nuova scheda)",
    tickets: "Biglietti",
    spots: "Posti",
    noLimit: {
      $plural: {
        one: "Nessun limite. Partecipa {n} persona.",
        other: "Nessun limite. Partecipano {n} persone.",
      },
    },
    allTaken: "Tutti i {capacity} posti sono occupati.",
    allTakenWaitlist: {
      $plural: {
        one: "Tutti i {capacity} posti sono occupati, e {n} persona è in lista d'attesa.",
        other:
          "Tutti i {capacity} posti sono occupati, e {n} persone sono in lista d'attesa.",
      },
    },
    spotsLeft: "{left} posti liberi su {capacity}.",
    about: "Sull'evento",
    themeWeek:
      "Le settimane a tema valgono per ogni giornata in queste date, e il calendario le segna.",
    seeSchedule: "Vedi il calendario {season}",
    fullTitle: "È completo, ma i posti si liberano",
    coming: "Vieni?",
    fullTicket:
      "Entra in lista d'attesa e avrai un giorno per comprare il prossimo biglietto che si libera.",
    fullFree: "Entra in lista d'attesa e ti scriviamo se qualcuno rinuncia.",
    buy: "Compra il biglietto con la carta o con il credito della lega. Prima accedi.",
    rsvpBody:
      "Conferma così la lega sa per quante persone organizzarsi. Puoi cambiare idea quando vuoi.",
    joinWaitlist: "Entra in lista d'attesa",
    getTicket: "Prendi un biglietto",
    rsvp: "Conferma",
    guestList: "La lista degli invitati è su {site}.",
    noRsvp: "Nessuna conferma necessaria. Vieni e basta.",
    rsvpOn: "Conferma su {site}",
    over: "Questo evento è finito. Grazie di essere venuto!",
    cancelled: "La lega ha annullato questo evento.",
    elseComing: "Guarda cos'altro è in arrivo",
    share: "Condividi questo evento",
    saveDate: "Segna la data",
    apple: "Apple o Outlook",
    google: "Google Calendar",
    photos: "Foto",
    shareCalledOff: "Annullato: {title} ({when})",
    shareFor: "Per {audience}",
  },
  sponsors: {
    title: "Sponsor e il bar di casa",
    description:
      "Le attività dietro la lega, dove si va tutti dopo le partite, le offerte della settimana e la squadra della settimana.",
    headingStart: "I nostri",
    headingSwipe: "sponsor",
    intro:
      "I locali del quartiere che fanno andare avanti la lega. Dopo l'ultimo out, tutti al bar di casa. Fai il check-in quando arrivi e usa un'offerta se ti va. Le offerte sono un extra, mai un obbligo.",
    loading: "Caricamento degli sponsor…",
    kinds: {
      bar: "Bar",
      restaurant: "Ristorante",
      brand: "Marchio",
      other: "Sponsor",
    },
    homeBase: "Il ritrovo dopo le partite",
    also: "Sostengono la lega anche",
    backing: "Sostengono la lega",
    deals: {
      $plural: {
        one: "{n} offerta per i giocatori",
        other: "{n} offerte per i giocatori",
      },
    },
    onTheWay: "Gli sponsor stanno arrivando. Hai un locale vicino al parco?",
    getInTouch: "Scrivici",
  },
  sponsor: {
    title: "Sponsor",
    homeBarTitle: "{name}, il bar di casa della lega",
    description:
      "{name} sostiene la lega. Offerte per i giocatori e come fare il check-in.",
    loading: "Caricamento dello sponsor…",
    home: "Home",
    sponsors: "Sponsor",
    homeBar: "Il bar di casa della lega",
    map: "Mappa",
    website: "Sito web",
    deals: "Offerte per i giocatori",
    checkInTitle: "Fai il check-in quando arrivi",
    stepCode:
      "Trova il codice della lega sullo schermo vicino alla porta o alla cassa. Cambia ogni pochi minuti.",
    stepScan: "Inquadralo con la fotocamera del telefono e tocca Check-in.",
    stepDeal:
      "Scegli un'offerta se ne vuoi una e mostra lo schermo a chi ti serve.",
    checkInNote:
      "I check-in mostrano a {name} quanti di noi sono passati, e così le offerte continuano. Ne conta uno al giorno, e non devi mai ordinare niente.",
  },
  deals: {
    none: "Al momento nessuna offerta. Vieni per la compagnia.",
    everyDay: "Tutti i giorni",
    weekdays: "Nei giorni feriali",
    weekends: "Nel weekend",
    days: {
      1: "Il lunedì",
      2: "Il martedì",
      3: "Il mercoledì",
      4: "Il giovedì",
      5: "Il venerdì",
      6: "Il sabato",
      7: "La domenica",
    },
    between: "{days}, dalle {from} alle {to}",
    midnight: "mezzanotte",
    noon: "mezzogiorno",
    confirmed: "Confermato il {date}",
  },
  teamOfWeek: {
    label: "Squadra della settimana · {day}",
    tab: "Hanno un conto da {amount} da {sponsor}, offerto dalla casa.",
  },
  help: {
    title: "Centro assistenza",
    description:
      "Brevi guide per giocatori, capitani, arbitri, admin e proprietari: iscriversi, pagare, confermare, sostituti, ordine di battuta, risultati, rinvii per pioggia e altro.",
    home: "Home",
    headingStart: "Come faccio a",
    headingSwipe: "…?",
    introStart:
      "Brevi guide per tutto quello che fa l'app, in base al tuo ruolo nella lega. Sei nuovo? Le",
    faq: "domande frequenti",
    introMid: "spiegano le basi, e le",
    rules: "regole della lega",
    introEnd: "dicono come giochiamo, con cosa è cambiato e quando.",
    widgetTitle: "Hai un bar o un sito di squadra?",
    widgetBody: "Mostra le prossime partite sul tuo sito con una riga di HTML.",
    widgetLink: "Prendi il widget del calendario",
    roleTitle: "Aiuto per {role}",
    roleDescription: "{intro} Brevi guide: {list}.",
    onThisPage: "In questa pagina",
    inApp: "Nell'app:",
    others: "Aiuto per gli altri",
    inEnglishTitle: "Admin e proprietari",
    inEnglishBody:
      "Le loro guide sono in inglese, come le schermate che usano.",
    search: {
      label: "Cerca nel centro assistenza",
      placeholder: "Prova “pagare”, “pioggia” o “ordine di battuta”",
      none: "Nessun risultato. Prova un'altra parola o sfoglia gli argomenti qui sotto.",
      found: "{n} guida trovata.",
      foundMany: "{n} guide trovate.",
      results: "Risultati della ricerca",
    },
  },
  live: {
    caption: "Punti per ripresa",
    team: "Squadra",
    runs: "Punti",
    runsShort: "P",
    calledNote:
      "La partita è stata sospesa, quindi vale il risultato alla fine della {nth} ripresa. I punti dopo non contano.",
    calledAfter: "sospesa dopo la {nth} ripresa",
    finalCalled: "Finale, {called}",
    gameOver: "Partita finita: in attesa di conferma",
    gameOverCalled: "Partita finita, {called}: in attesa di conferma",
    liveAt: "In diretta: {position}",
    live: "In diretta",
    top: "Inizio della {nth} ripresa",
    bottom: "Fine della {nth} ripresa",
    heading: "Ripresa per ripresa",
    scoredLive:
      "Punteggio segnato in diretta, ripresa per ripresa. Grazie a chi l'ha tenuto!",
    unofficial: "Non ufficiale fino al risultato finale.",
    unofficialMore:
      "Il risultato finale viene comunicato dopo la partita e confermato dai capitani.",
  },
  share: {
    whatsapp: "Condividi su WhatsApp",
    opensWhatsapp: " (apre WhatsApp)",
    more: "Altri modi per condividere",
    copy: "Copia il messaggio",
    copied: "Copiato. Incollalo in qualsiasi chat.",
    manual:
      "Qui non è stato possibile copiare. Seleziona il messaggio e copialo:",
  },
};
