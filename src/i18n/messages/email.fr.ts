import type { Translation } from "../catalog";
import type { emailEn } from "./email.en";

/**
 * The emails and push notifications in French (`fr.email`). Friendly
 * "vous", and the game words in the glossary in docs/i18n.md.
 */
export const emailFr: Translation<typeof emailEn> = {
  layout: {
    because: "Vous recevez cet e-mail parce que {reason}.",
    settings: "Choisir quels e-mails recevoir et quand",
    stopAbout: "Ne plus recevoir d'e-mails sur : {topic}",
    pushBecause: "Parce que {reason}.",
    fewer: "Moins d'e-mails, plutôt ?",
    turnDown: {
      team: "Seulement mon équipe",
      weekly: "Plutôt un résumé hebdomadaire",
      snooze: "Pause de 2 semaines",
    },
  },
  topics: {
    rainout: "matchs annulés pour cause de pluie",
    schedule_change: "changements de calendrier",
    game_reminder: "rappels de match",
    payment: "paiements et inscriptions",
    sub_request: "demandes de remplaçants",
    announcement: "nouvelles de la ligue",
    score: "scores",
    events: "événements",
    marketing: "nouvelles et offres de la ligue",
    new_team: "demandes de nouvelles équipes",
    discipline: "suspensions",
    digest: "le résumé",
    operations: "fonctionnement de la ligue",
    photos: "vos photos",
    team_roles: "capitaine et cocapitaines",
    game_day_watch: "alertes météo",
    lost_found: "objets trouvés",
    rules: "règles et calendrier",
  },
  common: {
    seeGame: "Voir le match",
    seeTeam: "Voir votre équipe",
    seeEvent: "Voir l'événement",
    seeOrders: "Voir vos commandes",
    seeCredit: "Voir votre crédit",
    seeOtherRequests: "Voir les autres demandes",
    openApp: "Ouvrir l'appli",
    fromLeague: "De la part de la ligue : {text}",
    cardRefund:
      "{returned}. Un remboursement sur carte apparaît en général sous 5 à 10 jours.",
    youPaid: "Vous avez payé {paid}.",
    nextFee:
      "Il est déduit automatiquement de vos prochains frais quand vous payez.",
  },
  announcement: {
    action: "Ouvrir l'appli de la ligue",
    reasonTeam: "vous jouez avec {team} en {season}",
    reasonLeague: "vous êtes inscrit à {season}",
  },
  awayShort: {
    subject: "{team} risque de manquer de joueurs la semaine du {week}",
    heading: "Pas assez de joueurs la semaine du {week} ?",
    lead: "{player} sera absent cette semaine-là. Joueurs disponibles pour {games} : {available}.",
    game: "{when} contre {opponent}",
    and: " et ",
    subsOpen:
      "Demandez un remplaçant maintenant et les joueurs libres ce soir-là seront prévenus.",
    subsClosed:
      "Les demandes de remplaçants ne sont pas ouvertes pour les séries ; voyez avec la ligue.",
    askSub: "Demander un remplaçant",
    reason: "vous êtes capitaine de {team} en {season}",
  },
  concern: {
    received:
      "{league} a bien reçu votre message. Seuls les admins de la ligue le lisent, et l'un d'eux vous répondra.",
    followInApp: "Vous pouvez le suivre dans l'appli.",
    answerByEmail:
      "Si vous avez laissé une adresse, la réponse arrivera à cet e-mail.",
    replied: "{league} a répondu :",
    closed: "{league} a clos votre message. Ce qui a été fait :",
    receivedTitle: "Nous avons reçu votre message",
    replyTitle: "Une réponse de la ligue",
    closedTitle: "Votre message est clos",
    reason: "vous avez écrit à la ligue",
  },
  digest: {
    updates: { $plural: { one: "1 nouvelle", other: "{n} nouvelles" } },
    subject: "Nouvelles de la ligue : {updates}",
    headingDaily: "Les nouvelles de la ligue aujourd'hui",
    headingWeekly: "Les nouvelles de la ligue cette semaine",
    lead: {
      $plural: {
        one: "Voici la nouvelle que nous avons gardée pour ne pas encombrer votre boîte.",
        other:
          "Voici les {n} nouvelles que nous avons gardées pour ne pas encombrer votre boîte.",
      },
    },
    reasonDaily:
      "vous avez choisi de recevoir les nouvelles non urgentes en un seul e-mail par jour",
    reasonWeekly:
      "vous avez choisi de recevoir les nouvelles non urgentes en un seul e-mail par semaine",
    reasonCap: {
      $plural: {
        one: "vous recevez au plus {n} e-mail non urgent de la ligue par jour, et celles-ci sont arrivées après",
        other:
          "vous recevez au plus {n} e-mails non urgents de la ligue par jour, et celles-ci sont arrivées après",
      },
    },
    settings:
      "Modifier votre limite quotidienne, le résumé ou les heures calmes",
  },
  event: {
    rsvpOn: "Répondre sur {site} : {url}",
    announcedSubject: "Nouvel événement : {title}",
    updatedSubject: "Mise à jour : {title}",
    announcedHeading: "Vous êtes invité : {title}",
    updatedHeading: "{title} a changé",
    announcedLead: "{title} a lieu : {where}.",
    updatedLead:
      "La ligue a modifié les détails de {title}. C'est désormais : {where}.",
    postedReason: "la ligue a publié un événement pour vous",
    spotSubject: "C'est bon : {title}",
    spotHeading: "Une place s'est libérée pour {title}",
    spotLead:
      "Vous étiez sur la liste d'attente pour {title} ({where}), et vous avez maintenant une place.",
    spotDrop:
      "Changement de programme ? Libérez votre place sur la page de l'événement pour que la personne suivante l'obtienne.",
    waitlistReason:
      "vous vous êtes inscrit sur la liste d'attente de cet événement",
    offSubject: "Annulé : {title}",
    offHeading: "{title} est annulé",
    offLead:
      "La ligue a annulé {title} ({where}). Désolés. Votre réponse est effacée et vous n'avez rien à faire.",
    otherEvents: "Voir les autres événements",
    rsvpReason: "vous avez répondu à cet événement",
  },
  ticket: {
    receiptSubject: "Votre billet : {title}",
    receiptHeading: "Vous allez à {title}",
    receiptLead: "Votre billet pour {title} ({where}) est confirmé.",
    code: "Votre code d'entrée est {code}. Montrez-le à l'entrée.",
    seeTicket: "Voir votre billet",
    boughtReason: "vous avez acheté un billet",
    refundedSubject: "Remboursé : {title}",
    refundedHeading: "Votre billet pour {title} est remboursé",
    refundedLead:
      "La ligue a remboursé votre billet pour {title} ({where}), il ne permet donc plus d'entrer.",
    offeredSubject: "Une place s'est libérée : {title}",
    offeredHeading: "Une place s'est libérée pour {title}",
    offeredLead:
      "Vous étiez sur la liste d'attente pour {title} ({where}), et une place vous est réservée.",
    buyBy:
      "Achetez votre billet avant {expires}. Ensuite, il passe à la personne suivante.",
    buy: "Achetez votre billet. Ensuite, il passe à la personne suivante.",
    buyAction: "Acheter votre billet",
  },
  gameDay: {
    laterTime: "un horaire plus tardif",
    delayedSubject: "Commence en retard : {teams}, {day}",
    delayedHeading: "Votre match commence maintenant à {time}",
    delayedLead:
      "{teams} le {day} était prévu à {was} et commence maintenant à {time}.{why}",
    offSubject: "Annulé : {teams}, {day}",
    offHeading: "Votre match est annulé",
    offLead:
      "{teams} le {day} à {was} est annulé.{why} Vous connaîtrez l'horaire du match en retard dès que la ligue l'aura reprogrammé.",
    backSubject: "Maintenu : {teams}, {day}",
    backHeading: "Votre match a de nouveau lieu",
    backLead: "{teams} le {day} a de nouveau lieu à {was}.{why}",
    playReason: "vous jouez en {season}",
    watchSubject: "On surveille la météo : décision d'ici {time}, {day}",
    watchHeading: "Décision d'ici {time}",
    watchLead:
      "La ligue surveille la météo pour {teams} le {day} et décidera d'ici {time} si les matchs ont lieu.{why}",
    watchMore:
      "Si votre match commence en retard ou est annulé, vous recevrez un autre message.",
    watchReason: "vous avez demandé les alertes météo avant vos matchs",
  },
  gear: {
    holding: "Vous avez {kit}.",
    onItsWay:
      "{kit} est en route vers vous : confirmez-le dans l'appli quand vous l'avez.",
    with: "{name} a {kit} en ce moment ; récupérez-le auprès de cette personne, et confirmez dans l'appli quand elle vous le remet.",
    atHome:
      "{kit} est à {place} ; touchez « J'ai récupéré {kit} » dans l'appli quand vous l'avez.",
    subject: "Apportez {kit} à {place} avant {by} le {day}",
    heading: "{kit} pour {teams}",
    bring:
      "Apportez-le à {place} avant {by} le {day}, une demi-heure avant le début de {teams}.",
    missing:
      "S'il manque quelque chose dans le kit, signalez-le dans l'appli pour que la ligue le complète.",
    action: "Ouvrir votre matériel",
    reason: "vous apportez le matériel de la ligue à ce match",
  },
  giveaway: {
    subject: "Vous avez gagné le tirage de {event}",
    heading: "Vous avez gagné !",
    lead: "Votre nom est sorti au tirage de {event} : {prize}.",
    leadFrom:
      "Votre nom est sorti au tirage de {event} : {prize}, offert par {donor}.",
    claim:
      "La page du tirage explique comment récupérer votre lot. Le tirage s'est fait au hasard, parmi toutes les personnes enregistrées.",
    action: "Voir votre lot",
    reason: "vous avez participé au tirage de {event}",
  },
  merch: {
    teamColors: "{description}, couleurs de {team}",
    receiptSubject: "Votre commande : {description}",
    receiptHeading: "Merci pour votre commande",
    receiptLead: "Votre commande de {what} est bien enregistrée.",
    letYouKnow: "On vous prévient quand elle est prête.",
    reason: "vous avez commandé à la boutique de la ligue",
    readySubject: "Prêt : {description}",
    readyHeading: "Votre commande est prête",
    readyLead:
      "Votre commande est prête : {what}. Récupérez-la auprès de la ligue à votre prochain match.",
    refundedSubject: "Remboursé : {description}",
    refundedHeading: "Votre commande a été remboursée",
    refundedLead: "La ligue a remboursé votre commande de {what}.",
  },
  money: {
    warningSubject:
      "{team} doit encore {balance} : votre carte sera débitée le {on}",
    warningHeading: "Attention : il reste {balance} pour {team}",
    warningLead:
      "Il reste {balance} à payer sur les frais {season} de votre équipe. Comme garant de l'équipe, ce montant sera débité de votre {card} le {on}.",
    warningLeadCharge:
      "Il reste {balance} à payer sur les frais {season} de votre équipe. Comme garant de l'équipe, {charge} seront débités de votre {card} le {on} : le solde au tarif carte, qui couvre les frais de carte.",
    warningMore:
      "Ce que vos coéquipiers paient d'ici là est déduit du débit. Récupérez le reste auprès d'eux ensuite, ou retirez la carte si vous préférez payer autrement.",
    whoPaid: "Voir qui a payé",
    guaranteeReason:
      "vous avez enregistré une carte pour garantir les frais de {team}",
    failedSubject: "Nous n'avons pas pu débiter votre carte pour {team}",
    failedHeading: "Votre carte a été refusée",
    failedLead:
      "Nous avons essayé de débiter {balance} de votre carte enregistrée pour le reste des frais {season} de {team}, et la banque a refusé.",
    failedMore:
      "Votre équipe n'est pas confirmée tant que les frais ne sont pas payés. Payez le solde depuis la page de l'équipe, ou enregistrez une autre carte.",
    payBalance: "Payer le solde",
    waitlistSubject:
      "Une place d'équipe s'est libérée en {season}. Elle est à vous jusqu'au {expires}",
    waitlistHeading: "C'est votre tour ! Une place vient de se libérer",
    waitlistLead:
      "Une place d'équipe s'est libérée en {season} et vous êtes le prochain sur la liste d'attente. Nous vous la gardons jusqu'au {expires}.",
    waitlistMore:
      "Inscrivez votre équipe d'ici là pour la prendre. Ensuite, elle passe à l'équipe suivante.",
    registerTeam: "Inscrire votre équipe",
    waitlistReason: "vous vous êtes inscrit sur la liste d'attente de {season}",
    referralSubject: "Vous avez gagné {amount} de crédit de la ligue",
    referralHeading: "Merci d'avoir amené un ami",
    referralLead:
      "Une personne que vous avez invitée vient de payer {season} : {amount} de crédit de la ligue sont sur votre compte.",
    referralReason: "quelqu'un s'est inscrit avec votre lien de parrainage",
    rebateSubject:
      "{amount} de crédit de la ligue pour les matchs annulés à cause de la pluie",
    rebateHeading: "Une partie de vos frais vous revient",
    rebateLead:
      "{team} a perdu {lost} matchs sur {count} en {season} à cause d'une météo qui n'a pas permis de les rattraper. Votre part du remboursement, {amount}, est maintenant du crédit de la ligue.",
    rebateReason: "vous avez participé aux frais {season} de {team}",
  },
  newTeam: {
    approvedSubject: "{team} est retenue pour {season}",
    approvedHeading: "Votre équipe est acceptée",
    approvedLead:
      "La ligue a dit oui : {team} est prête pour {season}, avec vous comme capitaine.",
    approvedMore:
      "Ensuite, partagez le lien d'invitation de l'équipe pour que vos joueurs la rejoignent, et signez la décharge. L'équipe est confirmée quand elle a assez de joueurs et que les frais sont couverts.",
    invite: "Inviter vos joueurs",
    askedReason: "vous avez demandé à créer {team}",
    declinedSubject: "À propos de votre demande de créer {team}",
    declinedHeading: "Votre demande de nouvelle équipe",
    declinedLead: "La ligue ne peut pas ajouter {team} à {season}.",
    declinedMore:
      "Vous pouvez toujours rejoindre une équipe sur invitation ou comme joueur libre.",
    seeSeason: "Voir votre saison",
    leftSubject: "{player} crée une nouvelle équipe",
    leftHeading: "{player} a quitté {left}",
    leftLead:
      "La ligue a accepté la demande de {player} de créer {team} en {season} : cette personne ne fait donc plus partie de votre effectif.",
    leftMore:
      "S'il vous faut un autre joueur, invitez-en un ou demandez un joueur libre à la ligue.",
    seeRoster: "Voir votre effectif",
    captainReason: "vous êtes capitaine de {team}",
  },
  payment: {
    today: "aujourd'hui",
    tomorrow: "demain",
    inDays: { $plural: { one: "dans {n} jour", other: "dans {n} jours" } },
    subject: "Vos frais {season} sont à régler {when}",
    heading: "Votre place est à payer {when}",
    lead: "La date limite de paiement pour {season} est le {deadline}. Payez avant pour garder votre place.",
    waiverFirst:
      "Signez d'abord la décharge de la saison ; le paiement vient juste après.",
    byCard:
      "Par carte, c'est l'affaire d'une minute. Si vous avez déjà payé votre capitaine en espèces ou par Venmo, demandez-lui de l'indiquer dans l'appli.",
    action: "Payer maintenant",
    reason: "vous êtes inscrit à {season} et n'avez pas encore payé",
  },
  photo: {
    approvedSubject: "Votre photo a été retenue",
    approvedHeading: "Votre photo est en ligne",
    approvedLead:
      "Merci de l'avoir partagée ! La ligue a accepté votre photo, qui apparaît maintenant sur {where}. Elle pourrait aussi apparaître sur les réseaux sociaux de la ligue.",
    deleteAnytime: "Vous pouvez la supprimer de vos photos à tout moment.",
    seeIt: "La voir sur le site",
    rejectedSubject: "À propos de la photo que vous avez envoyée",
    rejectedHeading: "La ligue n'a pas retenu votre photo",
    rejectedLead:
      "Merci de l'avoir envoyée. La ligue ne publiera pas celle-ci, elle a donc été supprimée du site.",
    keepThem:
      "Continuez à en envoyer : les photos nettes et bien éclairées des journées et des événements ont le plus de chances.",
    yourPhotos: "Vos photos",
    reason: "vous avez envoyé une photo à la ligue",
  },
  privateEvent: {
    tournament: "tournoi",
    league: "ligue privée",
    reason: "vous avez demandé à la ligue : {what} pour {organization}",
    receivedSubject: "Nous avons reçu votre demande : {what}",
    receivedHeading: "Merci, nous avons votre demande",
    receivedLead:
      "La ligue a votre demande ({what}) pour {organization}. Un admin va regarder les terrains et les dates et vous répondre, en général sous une semaine.",
    receivedMore: "Vous pouvez suivre où elle en est à tout moment.",
    seeRequest: "Voir votre demande",
    acceptedSubject: "{season} est lancé",
    acceptedHeading: "Tout est prêt : {what}",
    acceptedLead:
      "La ligue a créé {season} pour {organization}. C'est privé : seules vos équipes peuvent s'inscrire, et rien n'apparaît sur les pages publiques de la ligue.",
    acceptedMore:
      "Partagez le lien d'invitation avec le capitaine de chaque équipe. Votre page affiche les équipes à mesure qu'elles s'inscrivent, le calendrier dès sa sortie, et les résultats.",
    organizerPage: "Ouvrir votre page d'organisateur",
    declinedSubject: "À propos de votre demande : {what}",
    declinedHeading: "Votre demande",
    declinedLead:
      "La ligue ne peut pas accueillir votre demande ({what}) pour {organization} cette fois.",
    declinedMore: "N'hésitez pas à redemander pour d'autres dates.",
    askAgain: "Redemander",
  },
  rainout: {
    movesSubject: "Annulé pour cause de pluie : {teams} passe à {makeup}",
    postponedSubject: "Annulé pour cause de pluie : {teams} est reporté",
    newTimeHeading: "Votre match a un nouvel horaire",
    postponedHeading: "Votre match est reporté",
    lead: "{teams} ({was}) est annulé pour cause de pluie.",
    makeup:
      "Le match en retard est prévu {makeup}. Prévenez votre capitaine si vous ne pouvez pas venir.",
    noMakeup:
      "Il n'a pas encore de nouvel horaire. Il sera au calendrier dès que la ligue l'aura fixé.",
    action: "Voir le calendrier",
    reason: "vous jouez ce match en {season}",
  },
  referee: {
    subject: "Arbitre recherché : {teams}, {when}",
    heading: "Pouvez-vous arbitrer ce match ?",
    dropped: "{teams}, {when}, n'a plus d'arbitre.",
    none: "{teams}, {when}, n'a pas encore d'arbitre.",
    first:
      "Le premier arbitre qui touche « Je le prends » obtient le match. Si quelqu'un a été plus rapide, la page le dira.",
    action: "Je le prends",
    reason: "vous arbitrez en {season} et ne jouez ni n'arbitrez à cet horaire",
  },
  ruleChange: {
    subject: "Changement de règle à partir du {on} : {summary}",
    heading: "Les règles de la ligue changent",
    effective: "Il prend effet le {on}.",
    sections: {
      $plural: {
        one: "Section modifiée : {sections}.",
        other: "Sections modifiées : {sections}.",
      },
    },
    read: "Lisez le nouveau texte sur la page des règles, et demandez à votre capitaine ou à la ligue si quelque chose n'est pas clair.",
    action: "Lire les règles",
    reason: "vous jouez dans une saison de la ligue",
  },
  scoreConfirm: {
    subject: "Confirmez le score : {result}",
    heading: "Ce score est-il juste ?",
    lead: "{reportedBy} a saisi {result} pour {teams} ({when}).",
    more: "Confirmez-le, ou contestez-le s'il est faux. Si personne ne le conteste, il devient définitif au bout de 24 heures.",
    action: "Confirmer ou contester",
    reason: "vous êtes capitaine d'une des équipes de ce match",
  },
  scoreReminder: {
    subject: "Score manquant : {teams}",
    heading: "Quel est le score final ?",
    lead: "{teams} ({when}) n'a pas encore de score.",
    referee:
      "En tant qu'arbitre, saisissez-le maintenant pour que le classement se mette à jour ce soir. Ça prend quelques secondes.",
    captain:
      "Votre arbitre ne l'a pas saisi. L'un ou l'autre capitaine peut le faire, et l'autre équipe confirme.",
    action: "Saisir le score",
    refereeReason: "vous avez arbitré ce match",
    captainReason: "vous êtes capitaine d'une des équipes de ce match",
  },
  seasonCard: {
    subject: "Votre saison de kickball : {season}",
    heading: "Votre saison de kickball",
    lead: "{season} est terminée. Votre carte réunit vos matchs, les points et le bilan de votre équipe, vos récompenses et votre meilleur match.",
    private:
      "Vous seul pouvez la voir tant que vous ne choisissez pas d'en partager le lien.",
    action: "Voir votre saison",
    reason: "vous avez joué en {season}",
  },
  shirt: {
    subject: "Votre taille de t-shirt pour {season}",
    heading: "Quelle taille de t-shirt portez-vous ?",
    lead: "La ligue commande les t-shirts pour {season}, et nous n'avons pas encore votre taille.",
    pick: "Choisissez-la sur votre profil : {sizes}. Ça prend quelques secondes.",
    action: "Choisir ma taille",
    reason: "vous êtes inscrit à {season}",
  },
  sub: {
    requestSubject: "{team} cherche des remplaçants ({spots}) : {when}",
    requestHeading: "{team} cherche un remplaçant",
    requestLead: "{teams}, {when}. {team} cherche : {spots}.",
    fromCaptain: "Du capitaine : {note}",
    hold: "Touchez « J'en suis » pour garder une place. Le capitaine confirme, et vous recevez la réponse par e-mail.",
    seeRequests: "Voir les demandes de remplaçants",
    freeAgentReason:
      "vous êtes joueur libre en {season} et disponible à cet horaire",
    playerReason:
      "vous jouez en {season} et votre équipe ne joue pas à cet horaire",
    claimedSubject: "{player} veut remplacer : {when}",
    claimedHeading: "{player} peut remplacer",
    claimedLead: "{player} garde une place pour {teams}, {when}.",
    claimedMore:
      "Acceptez pour que cette personne sache qu'elle joue, ou refusez pour libérer la place.",
    approveOrDecline: "Accepter ou refuser",
    captainReason:
      "vous êtes capitaine de {team}, qui a demandé des remplaçants",
    withdrawnSubject: "{player} ne peut finalement pas remplacer : {when}",
    withdrawnHeading: "Un remplaçant s'est désisté",
    withdrawnLead:
      "{player} ne peut plus jouer {teams}, {when}. Sa place est de nouveau libre.",
    seeYourRequest: "Voir votre demande",
    approvedSubject: "Vous remplacez chez {team} : {when}",
    approvedHeading: "Vous jouez !",
    approvedLead:
      "Le capitaine de {team} a dit oui. Vous jouez {teams}, {when}.",
    approvedMore:
      "Portez la couleur de l'équipe si vous pouvez. Si vos plans changent, désistez-vous depuis la page des remplaçants pour qu'ils trouvent quelqu'un d'autre.",
    seeDetails: "Voir les détails",
    offeredReason: "vous vous êtes proposé comme remplaçant pour {team}",
    declinedSubject: "{team} est au complet : {when}",
    declinedHeading: "Merci de vous être proposé",
    declinedLead:
      "Le capitaine de {team} a ce qu'il faut pour {teams}, {when}. Merci de vous être manifesté.",
    cancelledSubject: "{team} ne cherche plus de remplaçants : {when}",
    cancelledHeading: "Demande retirée",
    cancelledLead:
      "{team} a retiré sa demande de remplaçants pour {teams}, {when} : vous ne jouez donc pas. Merci de vous être proposé.",
  },
  survey: {
    subject: "Comment s'est passée {season} ?",
    lead: "Cinq questions rapides sur la saison, environ deux minutes. Vos réponses sont anonymes : la ligue voit les totaux et les commentaires, jamais qui les a écrits.",
    action: "Répondre au questionnaire",
    reason: "vous avez joué en {season}",
  },
  suspension: {
    subject: "Vous êtes suspendu : {length}",
    heading: "Vous êtes suspendu",
    banned:
      "Après un signalement d'incident, {league} vous a exclu définitivement du jeu.",
    suspended:
      "Après un signalement d'incident, {league} vous a suspendu pour {length} en {season}.",
    lastsGames:
      "Elle se décompte à mesure que les matchs de votre équipe deviennent définitifs, et prend fin d'elle-même une fois qu'ils sont joués.",
    lastsSeason: "Elle prend fin avec la saison.",
    lastsPermanent: "Elle dure jusqu'à ce que la ligue la lève.",
    meaning:
      "Pendant votre suspension, vous ne pouvez pas indiquer que vous jouez un match, prendre une place de remplaçant ni être placé dans une équipe depuis la liste des joueurs libres. Votre capitaine voit que vous êtes suspendu, pas pourquoi.",
    appealTo:
      "Pour faire appel, répondez à cet e-mail ou écrivez à {email}, en disant ce que vous aimeriez que la ligue sache.",
    appeal:
      "Pour faire appel, répondez à cet e-mail en disant ce que vous aimeriez que la ligue sache.",
    reason: "la ligue vous a suspendu après un signalement d'incident",
  },
  teamRole: {
    offeredSubject: "{captain} vous propose d'être capitaine de {team}",
    offeredHeading: "Capitaine de {team} ?",
    offeredLead:
      "{captain} aimerait que vous deveniez capitaine de {team} pour {season}.",
    offeredMore:
      "Rien ne change tant que vous n'avez pas dit oui. Comme capitaine, vous gérez l'effectif, les invitations, les paiements et les cocapitaines ; la personne qui vous le propose reste cocapitaine.",
    answer: "Répondre sur la page de votre équipe",
    playReason: "vous jouez avec {team}",
    acceptedSubject: "{player} est maintenant capitaine de {team}",
    acceptedHeading: "Votre équipe a un nouveau capitaine",
    acceptedLead:
      "{player} a accepté : cette personne est désormais capitaine de {team} pour {season}.",
    acceptedMore:
      "Vous restez cocapitaine, avec les compositions, les demandes de remplaçants et les scores de l'équipe. Le nouveau capitaine peut changer cela.",
    offeredReason: "vous avez proposé le rôle de capitaine à {player}",
    declinedSubject: "{player} ne reprend pas {team}",
    declinedHeading: "Vous restez capitaine",
    declinedLead:
      "{player} a refusé d'être capitaine de {team} : vous restez donc capitaine pour {season}.",
    declinedMore:
      "Vous pouvez le proposer à un autre coéquipier depuis la page de votre équipe.",
    coSubject: "Vous êtes cocapitaine de {team}",
    coHeading: "Vous êtes cocapitaine",
    coLead:
      "Vous aidez désormais à gérer {team} pour {season} : établir l'ordre de frappe, demander des remplaçants, saisir et confirmer les scores, et voir qui a payé.",
    coMore:
      "Vous pouvez quitter ce rôle depuis la page de votre équipe quand vous voulez.",
    playerSubject: "Vous n'êtes plus cocapitaine de {team}",
    playerHeading: "Retour au jeu",
    playerLead:
      "Vous êtes maintenant dans {team} pour {season} comme joueur, sans les outils de cocapitaine.",
  },
  volunteer: {
    subject: "Demain : votre créneau de {role}",
    heading: "Merci pour votre aide !",
    lead: "Vous êtes inscrit comme {role} à {occasion} : {when}.",
    leadAt: "Vous êtes inscrit comme {role} à {occasion} : {when}, {place}.",
    drop: "Finalement, vous ne pouvez pas ? Libérez le créneau dans l'appli pour que quelqu'un d'autre le prenne.",
    action: "Voir vos créneaux",
    reason: "vous vous êtes inscrit à un créneau de bénévole",
  },
  winBack: {
    reason:
      "vous avez déjà joué dans la ligue et les inscriptions à {season} sont ouvertes",
  },
};
