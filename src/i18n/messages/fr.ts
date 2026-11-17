import type { Translation } from "../catalog";
import type { EnglishMessages } from "./en";
import { emailFr } from "./email.fr";
import { pagesFr } from "./pages.fr";

/**
 * French (ADR 0094). Machine-drafted without a paid service; a
 * native-speaking player reviews it before launch (docs/i18n.md). Friendly
 * "vous", and the game words in the glossary there.
 */
export const fr: Translation<EnglishMessages> = {
  shell: {
    brand: "Ligue de kickball",
    skipToContent: "Aller au contenu",
    siteNav: "Site",
    footer: {
      schedules: "Calendriers",
      history: "Histoire",
      about: "À propos",
      events: "Événements",
      faq: "FAQ",
      contact: "Contact",
      friends: "Amis",
      help: "Aide",
      park: "McCarren Park",
      rules: "Règles",
      sponsors: "Sponsors",
      signIn: "Se connecter",
    },
    theme: {
      toLight: "Passer au thème clair",
      toDark: "Passer au thème sombre",
    },
    language: {
      group: "Langue",
      current: "{language} (actuelle)",
      report: "Une traduction fausse ou maladroite ? Dites-le à la ligue",
    },
  },
  profile: {
    language: {
      label: "Langue",
      hint: "Les e-mails et les notifications arrivent dans cette langue. Les écrans de l'appli sont en anglais pour l'instant.",
      saved:
        "Enregistré. Les e-mails et les notifications arriveront en : {language}.",
      save: "Enregistrer la langue",
    },
  },
  formats: {
    teams: { $plural: { one: "{n} équipe", other: "{n} équipes" } },
    players: { $plural: { one: "{n} joueur", other: "{n} joueurs" } },
  },
  faq: {
    title: "FAQ",
    description:
      "Faut-il une équipe ? Les équipes sont-elles mixtes ? Combien ça coûte, que porter et que se passe-t-il quand il pleut ? Des réponses rapides sur le kickball pour adultes à Brooklyn.",
    home: "Accueil",
    headingStart: "Vos questions,",
    headingSwipe: "nos réponses",
    intro:
      "En bref : c'est mixte, vous pouvez venir seul, et personne n'a besoin d'être bon au kickball.",
    sections: "Sections de la FAQ",
    readyTitle: "Quand vous voulez",
    readyBody:
      "Connectez-vous avec votre e-mail pour inscrire une équipe, en rejoindre une ou venir seul.",
    signUp: "S'inscrire à une saison",
    joining: {
      title: "S'inscrire",
      team: {
        question: "Faut-il une équipe pour s'inscrire ?",
        answer:
          "Non. Inscrivez-vous comme joueur libre et la ligue vous place dans une équipe avant le début de la saison. Beaucoup viennent seuls, et c'est le moyen le plus rapide de rencontrer du monde.",
      },
      friend: {
        question: "Comment rejoindre l'équipe d'un ami ?",
        answer:
          "Demandez à votre capitaine le lien d'invitation de l'équipe. Ouvrez-le, connectez-vous avec votre e-mail, signez la décharge et payez votre part si l'équipe partage les frais. C'est tout, vous êtes dans l'effectif.",
      },
      age: {
        question: "Quel âge faut-il avoir ?",
        answer:
          "Il faut avoir 18 ans ou plus pour jouer. Certaines soirées dans des bars sont réservées aux 21 ans et plus, et la page de l'événement le précise.",
      },
      skill: {
        question: "Faut-il être bon au kickball ?",
        answer:
          "Pas du tout. Si vous vous souvenez de la récré, ça suffit. Les matchs sont amicaux, les arbitres expliquent leurs décisions et personne ne vous en voudra d'un coup raté.",
      },
    },
    season: {
      title: "La saison",
      when: {
        question: "Quand ont lieu les matchs ?",
        answer:
          "Ça dépend de la saison et des permis du parc : le dimanche après-midi en été, en soirée en semaine au printemps et à l'automne. La page de chaque saison donne le jour et les horaires exacts avant l'ouverture des inscriptions.",
      },
      where: {
        question: "Où joue-t-on ?",
        answer:
          "À McCarren Park, à Brooklyn, entre Greenpoint et Williamsburg. La page de votre match indique votre terrain.",
        more: "Venir à McCarren Park",
      },
      cost: {
        question: "Combien ça coûte ?",
        answer:
          "Les frais sont fixés à chaque saison et affichés sur la page de la saison, avec ce qu'ils comprennent, avant que vous payiez quoi que ce soit. Certaines saisons se paient par joueur, d'autres par équipe. Quand une équipe partage ses frais, chacun paie sa part en ligne.",
      },
      length: {
        question: "Combien de temps dure un match ?",
        answer:
          "Chaque match tient dans un créneau d'une heure, pour finir à temps pour le dîner, ou pour un verre (ou une eau gazeuse) avec l'équipe.",
      },
      coed: {
        question: "La ligue est-elle mixte ?",
        answer:
          "Oui. Toutes les équipes jouent en mixte, et les compositions suivent la règle de parité de la ligue, que le capitaine et l'arbitre surveillent.",
      },
      rain: {
        question: "Et s'il pleut ?",
        answer:
          "Une personne de la ligue suit la météo et décide, en général la veille. Si votre match est annulé pour cause de pluie, sa page l'indique, et le match en retard y apparaît dès qu'il est programmé.",
      },
    },
    gameDay: {
      title: "Le jour du match",
      wear: {
        question: "Que porter ?",
        answer:
          "Des baskets ou des chaussures de terrain synthétique, quelque chose aux couleurs de votre équipe et une couche de plus pour les matchs du soir. En été, prenez de l'eau et de la crème solaire.",
      },
      drink: {
        question: "Faut-il boire ?",
        answer:
          "Non. Rester ensemble après le match fait partie du plaisir, mais un verre ou une eau gazeuse, c'est vous qui voyez, et beaucoup rentrent directement. On boit seulement après le match, car l'alcool est interdit dans les parcs de la ville.",
      },
      watch: {
        question: "Des amis peuvent-ils venir regarder ?",
        answer:
          "Bien sûr. C'est un parc public, et quelques supporters au bord du terrain n'ont jamais gêné personne.",
      },
    },
  },
  schedule: {
    title: "Calendrier",
    seasonTitle: "Calendrier : {season}",
    divisionTitle: "Calendrier : {division}",
    seasonNav: "Saison",
    standings: "Classement",
    playoffs: "Séries",
    statusLabel: "État de la journée",
    divisionsNav: "Divisions",
    allDivisions: "Toutes les divisions",
    comingSoon: "Bientôt",
    comingSoonBody:
      "Le calendrier sort environ une semaine avant la première journée. Inscrivez-vous maintenant et on vous écrit dès qu'il est en ligne.",
    team: "Équipe",
    allTeams: "Toutes les équipes",
    show: "Afficher",
    teamPage: "Page et calendrier de {team}",
    showingTeam: {
      $plural: {
        one: "{n} match pour {name}.",
        other: "{n} matchs pour {name}.",
      },
    },
    showingAll: {
      $plural: { one: "{n} match.", other: "Les {n} matchs." },
    },
    themeWeek: "Semaine à thème :",
    open: "Libre",
    crossover: "Interdivision",
    makeups: "Matchs en retard à programmer",
    makeupsBody:
      "Ces matchs ont besoin d'une nouvelle date. Ils apparaissent ici, sur les pages des équipes et dans les calendriers dès que la ligue la fixe.",
    kickoff: "Coup d'envoi",
    fieldTba: "Terrain à confirmer",
    timeTba: "Horaire à confirmer",
  },
  gameStatus: {
    cancelled: "Annulé",
    postponed: "Reporté",
    rainedOut: "Annulé (pluie)",
    final: "Terminé",
    ruling: "Décision",
    forfeit: "Forfait",
    live: "En direct",
  },
  gameday: {
    updated: "Mis à jour à {time}",
    gamesOn: "Les matchs ont lieu.",
    watchingDay: "On surveille la météo : décision d'ici {time}.",
    someLate: "Certains matchs commencent en retard.",
    allLate: "Tous les matchs commencent en retard.",
    someOff: "Certains matchs sont annulés.",
    allOff: "Tous les matchs sont annulés.",
    watchingGame: "On surveille la météo : décision d'ici {time}",
    startsLate: "Commence en retard : {time}",
    off: "Annulé",
  },
  ruleSet: {
    innings: { $plural: { one: "{n} manche", other: "{n} manches" } },
    timeLimit: "limite de {minutes} minutes",
    bunting: "amorti autorisé",
    noBunting: "pas d'amorti",
    stealing: "vol de base autorisé",
    noStealing: "pas de vol de base",
    bestOf: "en {n} sets gagnants",
    daylight: "fin du jeu {minutes} minutes avant le coucher du soleil",
  },
  home: {
    title: "{site} · Kickball mixte pour adultes à Brooklyn",
    sticker: "McCarren Park, Brooklyn ☀️",
    heroStart: "Tapez dans un ballon. Rencontrez vos nouvelles",
    heroSwipe: "personnes préférées.",
    intro:
      "Du kickball mixte pour adultes à Brooklyn, pour celles et ceux qui n'ont pas joué depuis la récré. Venez en équipe ou seul, on vous en trouve une. Et restez après pour un verre (ou une eau gazeuse).",
    signUp: "S'inscrire à une saison",
    questions: "Des questions ? On a les réponses",
    basics: "L'essentiel",
    facts: {
      what: {
        term: "Quoi",
        detail:
          "Du kickball mixte pour adultes. Des matchs amicaux, un vrai classement.",
      },
      where: {
        term: "Où",
        detail: "McCarren Park, entre Greenpoint et Williamsburg.",
        link: "Comment venir",
      },
      when: {
        term: "Quand",
        detail:
          "Le dimanche après-midi en été ; en soirée en semaine au printemps et à l'automne.",
        link: "Calendriers et classements",
      },
      price: {
        term: "Prix",
        detail:
          "Fixé à chaque saison et affiché avant de payer. Les équipes peuvent partager les frais.",
        link: "Comment fonctionnent les frais",
      },
    },
    waysIn: "Trois façons de venir",
    ways: {
      team: {
        title: "Venez en équipe",
        body: "Inscrivez-vous comme capitaine, partagez un lien d'invitation dans le groupe, et chacun s'inscrit et paie sa part.",
      },
      friend: {
        title: "Rejoignez l'équipe d'un ami",
        body: "Ouvrez le lien d'invitation de votre capitaine, signez la décharge, et vous êtes dans l'effectif.",
      },
      solo: {
        title: "Venez seul",
        body: "Inscrivez-vous comme joueur libre et on vous place dans une équipe. Les nouvelles têtes, c'est la moitié du plaisir.",
        link: "Comment s'inscrire seul",
      },
    },
    afterTitle: "Le match, c'est la moitié",
    afterBody:
      "Les équipes restent ensemble après les matchs, chaque saison se termine par des séries, et la plupart repartent avec quelques nouveaux amis. Personne n'est obligé de boire, ni d'être bon au kickball.",
    aboutLink: "En savoir plus sur la ligue",
    photos: "Récemment, sur le terrain",
    opensPost: "(ouvre la publication sur Instagram)",
    newHere: "Nouveau au kickball, ou à Brooklyn ?",
    newHereLinks: {
      howToPlay: "Comment jouer au kickball",
      elsewhere: "Venir d'ailleurs à New York",
      solo: "S'inscrire sans équipe",
    },
    league: {
      description:
        "{league} : saisons, calendriers, classements, équipes et événements.",
      intro:
        "Saisons, calendriers, classements et événements de {league}. Inscrivez-vous avec le même compte que pour toutes les ligues de ce site.",
      seasons: "Saisons",
      noSeasons:
        "Le calendrier de la première saison apparaîtra ici dès sa publication.",
      schedule: "Calendrier",
      standings: "Classement",
      more: "Plus de {league}",
      events: "Événements",
      sponsors: "Sponsors",
      history: "Histoire de la ligue",
      records: "Records",
    },
  },
  ...pagesFr,
  email: emailFr,
};
