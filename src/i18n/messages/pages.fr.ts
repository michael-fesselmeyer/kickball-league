import type { Translation } from "../catalog";
import type { liveEn } from "./live.en";
import type { pagesEn } from "./pages.en";
import type { shareEn } from "./share.en";

/**
 * The public pages beyond home, FAQ and schedule, in French. Friendly
 * "vous", and the game words in the glossary in docs/i18n.md. Ordinals come
 * as "3e", "1er", or "1re" for a "manche", from `formatOrdinal`.
 */
export const pagesFr: Translation<
  typeof pagesEn & { live: typeof liveEn; share: typeof shareEn }
> = {
  about: {
    title: "À propos de la ligue",
    description:
      "Une ligue de kickball mixte et conviviale pour adultes à McCarren Park, Brooklyn. Comment se passe une saison, à qui elle s'adresse et les quelques règles que nous demandons à tous.",
    home: "Accueil",
    crumb: "À propos",
    sticker: "Amusez-vous, faites des rencontres",
    headingStart: "Une ligue de kickball pour",
    headingSwipe: "faire des rencontres",
    intro:
      "Nous sommes une ligue de kickball mixte pour adultes à McCarren Park, Brooklyn. On vient pour le jeu, on reste pour les gens, et on revient saison après saison. Assez compétitifs pour tenir au score, assez détendus pour que personne ne vous en veuille d'un coup raté.",
    whoTitle: "Qui joue",
    whoBody:
      "Des adultes de 18 ans et plus venus de toute la ville : nouveaux arrivants, vieux amis, collègues, colocataires, gens qui veulent juste une raison d'être dehors le dimanche. Beaucoup n'ont pas joué au kickball depuis l'école, et c'est très bien. Pas besoin d'équipe pour vous inscrire : les joueurs libres sont placés dans une équipe avant le début de la saison.",
    seasonTitle: "Comment se passe une saison",
    steps: {
      signUp: {
        title: "Inscrivez-vous",
        body: "Inscrivez une équipe, rejoignez-en une avec le lien d'invitation de votre capitaine, ou venez seul comme joueur libre. Chacun signe la décharge de la saison et paie en ligne.",
      },
      schedule: {
        title: "Recevez le calendrier",
        body: "Le calendrier sort environ une semaine avant la première journée. Chaque équipe a un bon mélange de matchs tôt et tard.",
      },
      play: {
        title: "Jouez chaque semaine",
        body: "Un arbitre par match, les scores publiés après chaque match et un classement qui se met à jour tout seul.",
      },
      playoffs: {
        title: "Les séries",
        body: "La saison se termine par des séries et une équipe championne qui peut s'en vanter jusqu'à la saison suivante.",
      },
    },
    houseRulesTitle: "Les règles de la maison",
    houseRulesIntro:
      "Le règlement couvre le jeu. Celles-ci couvrent tout le reste :",
    houseRules: {
      friendly:
        "Restez sympas. Applaudissez les beaux coups, y compris ceux de l'autre équipe.",
      refs: "Soyez cool avec les arbitres. La plupart jouent aussi dans la ligue.",
      drink:
        "Personne n'est obligé de boire. Une eau gazeuse après le match compte tout autant.",
      field:
        "Laissez le terrain plus propre que vous ne l'avez trouvé. C'est un parc public et nous y sommes invités.",
    },
    questionsTitle: "Des questions ?",
    questionsBody:
      "La FAQ parle des frais, des matchs annulés pour cause de pluie, de quoi porter et plus encore. Une fois dans une équipe, votre capitaine est le moyen le plus rapide de joindre la ligue. Voisins, personnel du parc et visiteurs peuvent écrire à la ligue sans compte.",
    readFaq: "Lire la FAQ",
    findFields: "Trouver les terrains",
    contact: "Contacter la ligue",
  },
  park: {
    title: "Le kickball à McCarren Park, Brooklyn",
    description:
      "Où joue la ligue à McCarren Park, entre Greenpoint et Williamsburg : métro, vélo, quoi apporter et comment trouver votre terrain.",
    home: "Accueil",
    sticker: "Notre terrain 🏟️",
    headingStart: "Le kickball à",
    intro:
      "Tous les matchs de la ligue se jouent à McCarren Park, le grand carré vert où Greenpoint rejoint Williamsburg, au nord de Brooklyn. Voici comment y venir et quoi apporter.",
    whereTitle: "Où nous jouons",
    fields:
      "Le parc compte plusieurs terrains. La page de votre match indique le vôtre : vérifiez-la avant de partir.",
    fieldsToday: "Voir qui a quel terrain aujourd'hui",
    map: "Ouvrir McCarren Park sur une carte",
    gettingThere: "Comment venir",
    ways: {
      g: {
        how: "Métro G",
        detail: "Station Nassau Av, à une rue du côté est du parc.",
      },
      l: {
        how: "Métro L",
        detail:
          "Station Bedford Av, à une dizaine de minutes à pied au sud du parc.",
      },
      bike: {
        how: "Vélo",
        detail:
          "Des stations Citi Bike entourent le parc. Attachez votre vélo hors du terrain.",
      },
    },
    bringTitle: "Quoi apporter",
    bring: {
      shoes: "Des baskets ou des chaussures de terrain synthétique",
      color: "Quelque chose aux couleurs de votre équipe",
      water: "De l'eau, et de la crème solaire en été",
      layer: "Une couche de plus pour les matchs du soir",
    },
    drinks:
      "On boit seulement après le match : l'alcool est interdit dans les parcs de la ville. Les équipes vont souvent ensuite dans un bar du coin pour un verre (ou une eau gazeuse).",
    playTitle: "Jouez ici cette saison",
    playBody:
      "Venez en équipe ou seul. Les jours et horaires sont sur la page de chaque saison avant l'ouverture des inscriptions.",
    signUp: "S'inscrire à une saison",
    readFaq: "Lire la FAQ",
    report: "Signaler un problème sur le terrain",
  },
  stats: {
    outcome: { W: "V", L: "D", T: "N" },
    blurb: {
      top_clash:
        "Deux des trois premiers du classement de forme. {a} et {b} vont régler la question de qui domine vraiment.",
      close_rematch:
        "Leur dernier match s'est joué dans les derniers instants. {a} et {b} remettent ça.",
      evenly_matched:
        "{a} et {b} sont au coude-à-coude au classement de forme. Prenez une chaise pliante.",
      best_available: "L'affiche la plus serrée : {a} contre {b}.",
    },
    movementNew: "Nouveau",
    movementNewWords: "Nouveau cette semaine",
    movementSame: "Sans changement",
    movementUp: {
      $plural: { one: "Gagne {n} place", other: "Gagne {n} places" },
    },
    movementDown: {
      $plural: { one: "Perd {n} place", other: "Perd {n} places" },
    },
    onFire: "{name} sont en feu : {n} victoires d'affilée.",
    wonStraight: "{name} ont gagné {n} matchs d'affilée.",
    droppedRow:
      "{name} ont perdu {n} matchs d'affilée. Ça ne peut que remonter.",
    lostStraight: "{name} ont perdu {n} fois d'affilée : leur tour va venir.",
    tiedRow: "{name} ont fait {n} nuls d'affilée. Remarquablement équilibrés.",
    firstMeeting: "Première rencontre",
    seriesTied: "Série à égalité {score}",
    seriesLead: "{team} mènent la série {score}",
    gameOfTheWeek: "Le match de la semaine",
    vs: "{a} contre {b}",
    powerTitle: "Classement de forme",
    powerEmpty: "Le classement commence après la première journée.",
    powerIntro:
      "Qui joue le mieux en ce moment : bilan, les trois derniers matchs, différence de points et force des adversaires.",
    records: "Records de la ligue",
    numbersTitle: "En chiffres",
    powerRank: "Rang de forme",
    streak: "Série",
    bestRun: "Meilleure série",
    rivalries: "Rivalités",
    headToHead: "Face-à-face",
    seasonStreaks: "Les séries de cette saison : {list}.",
    teamStreak: "{team} {streak}",
    noneYet: "aucune pour l'instant",
    tiedScore: "Égalité {score}",
    byForfeit: "{team} par forfait",
    wonScore: "{team} {score}",
  },
  standings: {
    title: "Classement",
    seasonTitle: "Classement : {season}",
    seasonNav: "Saison",
    schedule: "Calendrier",
    playoffs: "Séries",
    noGames:
      "Aucun match joué pour l'instant. Le tableau se remplit à mesure que les scores arrivent.",
    noDivision: "Sans division",
    divisionSchedule: "Calendrier : {division}",
    caption:
      "Classement {season} : victoires, défaites, nuls, pourcentage de victoires, {units} et forme récente",
    divisionCaption:
      "Classement {season}, {division} : victoires, défaites, nuls, pourcentage de victoires, {units} et forme récente",
    tiebreakers: "Départages",
    placedBelow:
      "{team} est classée sous l'équipe au-dessus. Départage : {by}.",
    by: {
      head_to_head: "face-à-face",
      coin_flip: "tirage au sort",
    },
    howRanked:
      "Un nul compte pour une demi-victoire. Les égalités au classement se départagent au face-à-face, puis à la {difference}{capped}, puis aux {allowed}, puis par tirage au sort.",
    capped: " (plafonnée à {cap} par match)",
    diffCapped: ", plafonnée à {cap} par match",
    crossovers:
      "Chaque équipe est classée dans sa division, et les matchs contre l'autre division comptent dans son bilan.",
    divisionOnly:
      "Chaque équipe est classée dans sa division sur ses seuls matchs de division.",
    home: "Accueil",
    team: "Équipe",
    columns: {
      rank: { short: "#", long: "Rang" },
      wins: { short: "V", long: "Victoires" },
      losses: { short: "D", long: "Défaites" },
      ties: { short: "N", long: "Nuls" },
      pct: {
        short: "%",
        long: "Pourcentage de victoires, un nul comptant pour une demi-victoire",
      },
      runsFor: { short: "{letter}M", long: "{Units} marqués" },
      runsAgainst: { short: "{letter}E", long: "{Units} encaissés" },
      diff: { short: "DIFF", long: "{Difference}" },
      streak: { short: "SÉRIE", long: "Série en cours" },
      lastFive: {
        short: "5D",
        long: "Cinq derniers matchs, du plus ancien au plus récent",
      },
    },
  },
  sports: {
    kickball: {
      one: "point",
      many: "points",
      letter: "P",
      difference: "différence de points",
      allowed: "points encaissés",
    },
    dodgeball: {
      one: "set",
      many: "sets",
      letter: "S",
      difference: "différence de sets",
      allowed: "sets perdus",
    },
  },
  team: {
    title: "Équipe",
    description:
      "{team} : calendrier, résultats, effectif et calendrier à suivre.",
    standing: "{record}, {rank} au classement",
    share: "Partager cette équipe",
    shareText: "Calendrier, résultats et calendrier à suivre :",
    seasons: "Saisons",
    next: "Prochain match",
    noGames:
      "Pas encore de match au calendrier. Il sort environ une semaine avant la première journée.",
    wrap: "C'est fini : plus de match cette saison. Merci d'avoir joué !",
    coming: "À venir",
    results: "Résultats",
    noResults: "Pas encore de résultat. Le premier lancer est le plus dur.",
    awaiting: "Scores à venir",
    photos: "Photos",
    calendarTitle: "Ne ratez aucun match",
    calendarBody:
      "Abonnez-vous une fois et chaque match arrive dans votre calendrier, à l'heure de la ligue. Les changements et les annulations pour cause de pluie se mettent à jour tout seuls.",
    apple: "Apple ou Outlook",
    google: "Google Agenda",
    newTab: " (s'ouvre dans un nouvel onglet)",
    paste: "Ou collez ce lien dans n'importe quelle appli de calendrier",
    roster: "Effectif",
    rosterEmpty: "L'effectif se remplit à mesure que les joueurs arrivent.",
    captain: "Capitaine",
    coCaptain: "Cocapitaine",
    awards: "Récompenses {season}",
    fullSchedule: "{team} dans le calendrier complet",
    resultsCaption: "Résultats, du plus ancien au plus récent",
    date: "Date",
    opponent: "Adversaire",
    result: "Résultat",
    score: "Score",
    forfeit: "Forfait",
    outcome: { W: "Victoire", L: "Défaite", T: "Nul" },
  },
  game: {
    title: "Match",
    seasonWhen: "{season} : {when}",
    seasonTba: "{season} : horaire à confirmer",
    breadcrumb: "Fil d'Ariane",
    vs: "contre",
    when: "Quand",
    tba: "Horaire à confirmer",
    offNote:
      "Ce match est annulé. La ligue publie ici et dans les calendriers la date du match en retard dès qu'elle est fixée.",
    makeupWaiting: "Ce match en retard attend un créneau libre.",
    where: "Où",
    openMaps: "Ouvrir dans Plans",
    newTab: " (s'ouvre dans un nouvel onglet)",
    fieldTba: "Terrain à confirmer",
    tellChat: "Prévenir le groupe",
    share: "Partager ce match",
    calendarTitle: "Ajoutez-le à votre calendrier",
    calendarBody:
      "La page de chaque équipe a un calendrier avec tous ses matchs, toujours à jour.",
    teamGames: "Matchs de {team}",
    winByForfeit: "{team} gagnent par forfait",
    forecast: "{temperature} °F · {chance} % de risque de pluie",
    forecastSource:
      "{summary}. Prévisions du National Weather Service américain.",
    noForecast: "Pas encore de prévisions",
    noForecastNote: "Les prévisions portent sur une semaine.",
    shareResult: "{status} : {result}",
    shareOff: "{status} : {matchup} est annulé.",
    shareOffAt: "{status} : {matchup} ({time}) est annulé.",
    shareMakeup:
      "Le match en retard sera au calendrier dès que la ligue l'aura fixé.",
    shareLive: "En direct : {matchup}",
    shareOn: "Le match a lieu : {matchup}",
  },
  photos: {
    title: "Photos des joueurs",
    none: "Pas encore de photo.",
    gotOne: "Vous en avez une belle ?",
    share: "Partager une photo",
    alt: "Photo d'un joueur : {about}",
  },
  allTime: {
    title: "Depuis toujours",
    record: "Victoires, défaites, nuls",
    seasons: "Saisons",
    pct: "% victoires",
    diff: "Diff. points",
    titles: "Titres",
    champions: {
      $plural: { one: "Champions", other: "{n} fois champions" },
    },
    note: "Matchs de saison régulière de toutes les saisons jouées par {team}.",
    history: "Histoire de la ligue",
  },
  awardLabels: {
    season_mvp: "MVP de la saison",
    iron_kicker: "Botteur de fer",
    golden_boot: "Soulier d'or",
    best_teammate: "Meilleur coéquipier",
    rookie_of_the_year: "Recrue de l'année",
    sub_of_the_year: "Remplaçant de l'année",
  },
  eventKinds: {
    social: "Rencontre",
    bar_night: "Soirée au bar",
    bbq: "Barbecue",
    tournament: "Tournoi",
    theme_week: "Semaine à thème",
    party: "Fête",
    pickup: "Match ouvert",
    practice: "Entraînement",
  },
  eventCard: {
    calledOff: "Annulé",
    rsvpOn: "Répondre sur {site}",
    going: "{n} participants",
    full: "Complet : liste d'attente ouverte",
    spotsLeft: {
      $plural: { one: "{n} place restante", other: "{n} places restantes" },
    },
    freeForMembers: "Gratuit pour les membres, {price} sinon",
    memberPrice: "{price} ({member} pour les membres)",
    tagged: "{kind} · {tag}",
  },
  events: {
    title: "Événements",
    description:
      "Soirées au bar, barbecues, tournois et semaines à thème : l'agenda de la ligue, avec réponses et calendrier à suivre.",
    headingStart: "Les événements",
    headingSwipe: "de la ligue",
    intro:
      "Les matchs sont le prétexte ; les gens sont l'essentiel. Venez à une soirée au bar, un barbecue, un tournoi ou une semaine à thème. Chaque événement est facultatif, et vous n'avez jamais besoin de boire pour participer.",
    loading: "Chargement des événements…",
    coming: "À venir",
    empty:
      "Rien au calendrier pour l'instant. Les nouveaux événements apparaissent ici et dans le calendrier ci-dessous dès que la ligue les publie.",
    rsvpStart: "Répondez depuis la page d'un événement une fois",
    signIn: "connecté",
    rsvpEnd:
      ". Quand un événement est complet, vous pouvez vous inscrire sur la liste d'attente ; on vous écrit si une place se libère.",
    playerRun: "Organisés par nos joueurs",
    moreFriends: "D'autres amis de la ligue",
    calendarTitle: "Ajoutez les événements à votre calendrier",
    calendarBody:
      "Abonnez-vous une fois et les nouveaux événements, changements et annulations apparaissent tout seuls, à l'heure de la ligue.",
    apple: "Apple ou Outlook",
    google: "Google Agenda",
    newTab: " (s'ouvre dans un nouvel onglet)",
    ics: "Télécharger le .ics",
    recently: "Récemment",
    anotherSite: " (un autre site)",
  },
  event: {
    title: "Événement",
    loading: "Chargement de l'événement…",
    home: "Accueil",
    events: "Événements",
    breadcrumb: "Fil d'Ariane",
    allEvents: "Tous les événements",
    calledOff: "Annulé",
    when: "Quand",
    where: "Où",
    openMaps: "Ouvrir dans Plans",
    newTab: " (s'ouvre dans un nouvel onglet)",
    tickets: "Billets",
    spots: "Places",
    noLimit: {
      $plural: {
        one: "Pas de limite. {n} personne vient.",
        other: "Pas de limite. {n} personnes viennent.",
      },
    },
    allTaken: "Les {capacity} places sont prises.",
    allTakenWaitlist: {
      $plural: {
        one: "Les {capacity} places sont prises, et {n} personne est sur la liste d'attente.",
        other:
          "Les {capacity} places sont prises, et {n} personnes sont sur la liste d'attente.",
      },
    },
    spotsLeft: "Il reste {left} places sur {capacity}.",
    about: "À propos de l'événement",
    themeWeek:
      "Les semaines à thème valent pour chaque journée entre ces dates, et le calendrier les signale.",
    seeSchedule: "Voir le calendrier {season}",
    fullTitle: "C'est complet, mais des places se libèrent",
    coming: "Vous venez ?",
    fullTicket:
      "Inscrivez-vous sur la liste d'attente et vous aurez une journée pour acheter le prochain billet qui se libère.",
    fullFree:
      "Inscrivez-vous sur la liste d'attente et on vous écrit si quelqu'un se désiste.",
    buy: "Achetez votre billet par carte ou avec votre crédit de la ligue. Connectez-vous d'abord.",
    rsvpBody:
      "Répondez pour que la ligue sache pour combien de personnes prévoir. Vous pouvez changer d'avis à tout moment.",
    joinWaitlist: "S'inscrire sur la liste d'attente",
    getTicket: "Prendre un billet",
    rsvp: "Répondre",
    guestList: "La liste des invités est sur {site}.",
    noRsvp: "Pas besoin de répondre. Venez, tout simplement.",
    rsvpOn: "Répondre sur {site}",
    over: "Cet événement est terminé. Merci d'être venu !",
    cancelled: "La ligue a annulé cet événement.",
    elseComing: "Voir ce qui arrive ensuite",
    share: "Partager cet événement",
    saveDate: "Réservez la date",
    apple: "Apple ou Outlook",
    google: "Google Agenda",
    photos: "Photos",
    shareCalledOff: "Annulé : {title} ({when})",
    shareFor: "Pour {audience}",
  },
  sponsors: {
    title: "Les sponsors et le bar de la ligue",
    description:
      "Les commerces qui soutiennent la ligue, où tout le monde va après les matchs, les offres de la semaine et l'équipe de la semaine.",
    headingStart: "Nos",
    headingSwipe: "sponsors",
    intro:
      "Les adresses du quartier qui font vivre la ligue. Après le dernier retrait, tout le monde au bar de la ligue. Enregistrez votre passage en arrivant, et profitez d'une offre si elle vous plaît. Les offres sont un bonus, jamais une obligation.",
    loading: "Chargement des sponsors…",
    kinds: {
      bar: "Bar",
      restaurant: "Restaurant",
      brand: "Marque",
      other: "Sponsor",
    },
    homeBase: "Le point de ralliement après les matchs",
    also: "Ils soutiennent aussi la ligue",
    backing: "Ils soutiennent la ligue",
    deals: {
      $plural: {
        one: "{n} offre pour les joueurs",
        other: "{n} offres pour les joueurs",
      },
    },
    onTheWay:
      "Les sponsors arrivent. Vous tenez un établissement près du parc ?",
    getInTouch: "Écrivez-nous",
  },
  sponsor: {
    title: "Sponsor",
    homeBarTitle: "{name}, le bar de la ligue",
    description:
      "{name} soutient la ligue. Les offres pour les joueurs et comment enregistrer votre passage.",
    loading: "Chargement du sponsor…",
    home: "Accueil",
    sponsors: "Sponsors",
    homeBar: "Le bar de la ligue",
    map: "Carte",
    website: "Site web",
    deals: "Offres pour les joueurs",
    checkInTitle: "Enregistrez votre passage en arrivant",
    stepCode:
      "Trouvez le code de la ligue sur l'écran près de la porte ou de la caisse. Il change toutes les quelques minutes.",
    stepScan:
      "Scannez-le avec l'appareil photo de votre téléphone et touchez Enregistrer.",
    stepDeal:
      "Choisissez une offre si vous en voulez une et montrez l'écran à la personne qui vous sert.",
    checkInNote:
      "Les passages montrent à {name} combien d'entre nous sont venus, ce qui fait durer les offres. Un par jour compte, et vous n'êtes jamais obligé de commander.",
  },
  deals: {
    none: "Pas d'offre en ce moment. Venez pour la compagnie.",
    everyDay: "Tous les jours",
    weekdays: "En semaine",
    weekends: "Le week-end",
    days: {
      1: "Le lundi",
      2: "Le mardi",
      3: "Le mercredi",
      4: "Le jeudi",
      5: "Le vendredi",
      6: "Le samedi",
      7: "Le dimanche",
    },
    between: "{days}, de {from} à {to}",
    midnight: "minuit",
    noon: "midi",
    confirmed: "Confirmé le {date}",
  },
  teamOfWeek: {
    label: "Équipe de la semaine · {day}",
    tab: "Elle a une ardoise de {amount} chez {sponsor}, offerte par la maison.",
  },
  help: {
    title: "Centre d'aide",
    description:
      "De courts guides pour les joueurs, capitaines, arbitres, admins et propriétaires : s'inscrire, payer, répondre, remplaçants, ordre de frappe, scores, annulations pour cause de pluie et plus encore.",
    home: "Accueil",
    headingStart: "Comment",
    headingSwipe: "faire… ?",
    introStart:
      "De courts guides pour tout ce que fait l'appli, selon votre rôle dans la ligue. Nouveau ? La",
    faq: "FAQ",
    introMid: "couvre l'essentiel, et les",
    rules: "règles de la ligue",
    introEnd: "disent comment on joue, avec ce qui a changé et quand.",
    widgetTitle: "Vous tenez un bar ou le site d'une équipe ?",
    widgetBody:
      "Affichez les prochains matchs sur votre site avec une ligne de HTML.",
    widgetLink: "Obtenir le widget du calendrier",
    roleTitle: "Aide pour {role}",
    roleDescription: "{intro} De courts guides : {list}.",
    onThisPage: "Sur cette page",
    inApp: "Dans l'appli :",
    others: "Aide pour les autres",
    inEnglishTitle: "Admins et propriétaires",
    inEnglishBody:
      "Leurs guides sont en anglais, comme les écrans qu'ils utilisent.",
    search: {
      label: "Rechercher dans le centre d'aide",
      placeholder: "Essayez « payer », « pluie » ou « ordre de frappe »",
      none: "Aucun résultat. Essayez un autre mot, ou parcourez les sujets ci-dessous.",
      found: "{n} guide trouvé.",
      foundMany: "{n} guides trouvés.",
      results: "Résultats de la recherche",
    },
  },
  live: {
    caption: "Points par manche",
    team: "Équipe",
    runs: "Points",
    runsShort: "P",
    calledNote:
      "Le match a été arrêté, le score reste donc celui de la fin de la {nth} manche. Les points marqués ensuite ne comptent pas.",
    calledAfter: "arrêté après la {nth} manche",
    finalCalled: "Terminé, {called}",
    gameOver: "Match terminé : en attente de confirmation",
    gameOverCalled: "Match terminé, {called} : en attente de confirmation",
    liveAt: "En direct : {position}",
    live: "En direct",
    top: "Début de la {nth} manche",
    bottom: "Fin de la {nth} manche",
    heading: "Manche par manche",
    scoredLive:
      "Score saisi en direct, manche par manche. Merci à qui a tenu la feuille !",
    unofficial: "Non officiel jusqu'au résultat final.",
    unofficialMore:
      "Le score final est saisi après le match et confirmé par les capitaines.",
  },
  share: {
    whatsapp: "Partager sur WhatsApp",
    opensWhatsapp: " (ouvre WhatsApp)",
    more: "Autres façons de partager",
    copy: "Copier le message",
    copied: "Copié. Collez-le dans n'importe quelle discussion.",
    manual:
      "La copie n'a pas marché ici. Sélectionnez le message et copiez-le :",
  },
};
