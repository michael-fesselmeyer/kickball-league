import type { Translation } from "../catalog";
import type { emailEn } from "./email.en";

/**
 * The emails and push notifications in Italian (`it.email`). Casual "tu",
 * and the game words in the glossary in docs/i18n.md.
 */
export const emailIt: Translation<typeof emailEn> = {
  layout: {
    because: "Hai ricevuto questa email perché {reason}.",
    settings: "Scegli quali email ricevere e quando",
    stopAbout: "Basta email su: {topic}",
    pushBecause: "Perché {reason}.",
    fewer: "Preferisci meno email?",
    turnDown: {
      team: "Solo la mia squadra",
      weekly: "Meglio un riepilogo settimanale",
      snooze: "Pausa di 2 settimane",
    },
  },
  topics: {
    rainout: "partite rinviate per pioggia",
    schedule_change: "cambi di calendario",
    game_reminder: "promemoria delle partite",
    payment: "pagamenti e iscrizioni",
    sub_request: "richieste di sostituti",
    announcement: "notizie della lega",
    score: "risultati",
    events: "eventi",
    marketing: "notizie e offerte della lega",
    new_team: "richieste di nuove squadre",
    discipline: "squalifiche",
    digest: "il riepilogo",
    operations: "gestione della lega",
    photos: "le tue foto",
    team_roles: "capitano e vicecapitani",
    game_day_watch: "allerte meteo",
    lost_found: "oggetti smarriti",
    rules: "regole e calendario",
  },
  common: {
    seeGame: "Vedi la partita",
    seeTeam: "Vedi la tua squadra",
    seeEvent: "Vedi l'evento",
    seeOrders: "Vedi i tuoi ordini",
    seeCredit: "Vedi il tuo credito",
    seeOtherRequests: "Vedi le altre richieste",
    openApp: "Apri l'app",
    fromLeague: "Dalla lega: {text}",
    cardRefund:
      "{returned}. Di solito il rimborso sulla carta arriva entro 5-10 giorni.",
    youPaid: "Hai pagato {paid}.",
    nextFee:
      "Viene scalato in automatico dalla tua prossima quota quando paghi.",
  },
  announcement: {
    action: "Apri l'app della lega",
    reasonTeam: "giochi con {team} in {season}",
    reasonLeague: "sei iscritto a {season}",
  },
  awayShort: {
    subject: "{team} potrebbe essere a corto nella settimana del {week}",
    heading: "A corto nella settimana del {week}?",
    lead: "{player} sarà via quella settimana, quindi giocatori disponibili per {games}: {available}.",
    game: "{when} contro {opponent}",
    and: " e ",
    subsOpen: "Chiedi subito un sostituto e lo saprà chi è libero quella sera.",
    subsClosed:
      "Le richieste di sostituti non sono aperte per i playoff; chiedi alla lega.",
    askSub: "Chiedi un sostituto",
    reason: "sei capitano di {team} in {season}",
  },
  concern: {
    received:
      "{league} ha ricevuto il tuo messaggio. Lo leggono solo gli admin della lega, e uno di loro ti risponderà.",
    followInApp: "Puoi seguirlo nell'app.",
    answerByEmail:
      "Se hai lasciato un indirizzo, la risposta arriva a questa email.",
    replied: "{league} ha risposto:",
    closed: "{league} ha chiuso il tuo messaggio. Cosa è stato fatto:",
    receivedTitle: "Abbiamo ricevuto il tuo messaggio",
    replyTitle: "Una risposta dalla lega",
    closedTitle: "Il tuo messaggio è chiuso",
    reason: "hai scritto alla lega",
  },
  digest: {
    updates: { $plural: { one: "1 novità", other: "{n} novità" } },
    subject: "Notizie della lega: {updates}",
    headingDaily: "Le notizie della lega di oggi",
    headingWeekly: "Le notizie della lega di questa settimana",
    lead: {
      $plural: {
        one: "Ecco la novità che abbiamo tenuto da parte per non riempirti la casella.",
        other:
          "Ecco le {n} novità che abbiamo tenuto da parte per non riempirti la casella.",
      },
    },
    reasonDaily:
      "hai scelto di ricevere le notizie non urgenti in un'unica email al giorno",
    reasonWeekly:
      "hai scelto di ricevere le notizie non urgenti in un'unica email a settimana",
    reasonCap: {
      $plural: {
        one: "ricevi al massimo {n} email non urgente della lega al giorno, e queste sono arrivate dopo",
        other:
          "ricevi al massimo {n} email non urgenti della lega al giorno, e queste sono arrivate dopo",
      },
    },
    settings: "Cambia il limite giornaliero, il riepilogo o le ore di silenzio",
  },
  event: {
    rsvpOn: "Conferma su {site}: {url}",
    announcedSubject: "Nuovo evento: {title}",
    updatedSubject: "Aggiornamento: {title}",
    announcedHeading: "Sei invitato: {title}",
    updatedHeading: "{title} è cambiato",
    announcedLead: "{title} si fa: {where}.",
    updatedLead: "La lega ha cambiato i dettagli di {title}. Ora è: {where}.",
    postedReason: "la lega ha pubblicato un evento per te",
    spotSubject: "Ci sei: {title}",
    spotHeading: "Si è liberato un posto per {title}",
    spotLead:
      "Eri in lista d'attesa per {title} ({where}), e ora hai un posto.",
    spotDrop:
      "Cambio di programma? Lascia il posto dalla pagina dell'evento, così passa al prossimo in lista.",
    waitlistReason: "sei entrato nella lista d'attesa di questo evento",
    offSubject: "Annullato: {title}",
    offHeading: "{title} è annullato",
    offLead:
      "La lega ha annullato {title} ({where}). Ci dispiace. La tua conferma è cancellata e non devi fare niente.",
    otherEvents: "Vedi gli altri eventi",
    rsvpReason: "hai confermato la partecipazione a questo evento",
  },
  ticket: {
    receiptSubject: "Il tuo biglietto: {title}",
    receiptHeading: "Vai a {title}",
    receiptLead: "Il tuo biglietto per {title} ({where}) è confermato.",
    code: "Il tuo codice d'ingresso è {code}. Mostralo all'ingresso.",
    seeTicket: "Vedi il tuo biglietto",
    boughtReason: "hai comprato un biglietto",
    refundedSubject: "Rimborsato: {title}",
    refundedHeading: "Il tuo biglietto per {title} è stato rimborsato",
    refundedLead:
      "La lega ha rimborsato il tuo biglietto per {title} ({where}), quindi non vale più per entrare.",
    offeredSubject: "Si è liberato un posto: {title}",
    offeredHeading: "Si è liberato un posto per {title}",
    offeredLead:
      "Eri in lista d'attesa per {title} ({where}), e ora c'è un posto tenuto per te.",
    buyBy:
      "Compra il biglietto entro {expires}. Dopo passa al prossimo in fila.",
    buy: "Compra il biglietto. Dopo passa al prossimo in fila.",
    buyAction: "Compra il biglietto",
  },
  gameDay: {
    laterTime: "un orario più tardo",
    delayedSubject: "Inizia in ritardo: {teams}, {day}",
    delayedHeading: "La tua partita ora inizia alle {time}",
    delayedLead:
      "{teams} di {day} era prevista alle {was} e ora inizia alle {time}.{why}",
    offSubject: "Annullata: {teams}, {day}",
    offHeading: "La tua partita è annullata",
    offLead:
      "{teams} di {day} alle {was} è annullata.{why} Saprai l'orario del recupero quando la lega lo fissa.",
    backSubject: "Si torna a giocare: {teams}, {day}",
    backHeading: "La tua partita si gioca di nuovo",
    backLead: "{teams} di {day} si gioca di nuovo alle {was}.{why}",
    playReason: "giochi in {season}",
    watchSubject: "Teniamo d'occhio il meteo: decisione entro le {time}, {day}",
    watchHeading: "Decidiamo entro le {time}",
    watchLead:
      "La lega tiene d'occhio il meteo per {teams} di {day} e decide entro le {time} se si gioca.{why}",
    watchMore:
      "Se la tua partita inizia in ritardo o viene annullata, riceverai un altro messaggio.",
    watchReason: "hai chiesto le allerte meteo prima delle tue partite",
  },
  gear: {
    holding: "Hai tu {kit}.",
    onItsWay: "{kit} sta arrivando da te: confermalo nell'app quando ce l'hai.",
    with: "{kit} ce l'ha {name} in questo momento; prendilo da lui o da lei e conferma nell'app quando te lo consegna.",
    atHome:
      "{kit} è a {place}; tocca \"Ho preso {kit}\" nell'app quando ce l'hai.",
    subject: "Porta {kit} a {place} entro le {by} di {day}",
    heading: "{kit} per {teams}",
    bring:
      "Portalo a {place} entro le {by} di {day}, mezz'ora prima dell'inizio di {teams}.",
    missing:
      "Se manca qualcosa nel kit, segnalalo nell'app così la lega lo reintegra.",
    action: "Apri la tua attrezzatura",
    reason: "porti l'attrezzatura della lega a questa partita",
  },
  giveaway: {
    subject: "Hai vinto l'estrazione di {event}",
    heading: "Hai vinto!",
    lead: "Il tuo nome è uscito all'estrazione di {event}: {prize}.",
    leadFrom:
      "Il tuo nome è uscito all'estrazione di {event}: {prize}, offerto da {donor}.",
    claim:
      "La pagina dell'estrazione spiega come ritirarlo. L'estrazione era a caso, tra tutti quelli che hanno fatto il check-in.",
    action: "Vedi il tuo premio",
    reason: "hai partecipato all'estrazione di {event}",
  },
  merch: {
    teamColors: "{description}, colori di {team}",
    receiptSubject: "Il tuo ordine: {description}",
    receiptHeading: "Grazie per il tuo ordine",
    receiptLead: "Il tuo ordine per {what} è arrivato.",
    letYouKnow: "Ti avvisiamo quando è pronto.",
    reason: "hai ordinato dal negozio della lega",
    readySubject: "Pronto: {description}",
    readyHeading: "Il tuo ordine è pronto",
    readyLead:
      "{what}: è pronto. Lo trovi dalla lega alla tua prossima partita.",
    refundedSubject: "Rimborsato: {description}",
    refundedHeading: "Il tuo ordine è stato rimborsato",
    refundedLead: "La lega ha rimborsato il tuo ordine per {what}.",
  },
  money: {
    warningSubject:
      "{team} deve ancora {balance}: la tua carta viene addebitata il {on}",
    warningHeading: "Attenzione: {team} deve ancora {balance}",
    warningLead:
      "Alla quota {season} della tua squadra mancano ancora {balance}. Come garante della squadra, quella somma verrà addebitata sulla tua {card} il {on}.",
    warningLeadCharge:
      "Alla quota {season} della tua squadra mancano ancora {balance}. Come garante della squadra, sulla tua {card} verranno addebitati {charge} il {on}: il saldo al prezzo con carta, che copre la commissione della carta.",
    warningMore:
      "Quello che pagano i tuoi compagni prima di allora viene tolto dall'addebito. Poi fatti dare il resto da loro, oppure rimuovi la carta se preferisci pagare in un altro modo.",
    whoPaid: "Vedi chi ha pagato",
    guaranteeReason:
      "hai salvato una carta come garanzia per la quota di {team}",
    failedSubject: "Non siamo riusciti ad addebitare la tua carta per {team}",
    failedHeading: "La tua carta è stata rifiutata",
    failedLead:
      "Abbiamo provato ad addebitare {balance} sulla carta salvata per il resto della quota {season} di {team}, e la banca ha detto no.",
    failedMore:
      "La squadra non è confermata finché la quota non è pagata. Paga il saldo dalla pagina della squadra o salva un'altra carta.",
    payBalance: "Paga il saldo",
    waitlistSubject:
      "Si è liberato un posto per una squadra in {season}. È tuo fino a {expires}",
    waitlistHeading: "Tocca a te! Si è appena liberato un posto",
    waitlistLead:
      "Si è liberato un posto per una squadra in {season} e sei il prossimo in lista d'attesa. Te lo teniamo fino a {expires}.",
    waitlistMore:
      "Iscrivi la tua squadra entro allora per prenderlo. Dopo passa alla prossima squadra in fila.",
    registerTeam: "Iscrivi la tua squadra",
    waitlistReason: "sei entrato nella lista d'attesa di {season}",
    referralSubject: "Hai guadagnato {amount} di credito della lega",
    referralHeading: "Grazie per aver portato un amico",
    referralLead:
      "Una persona che hai invitato ha appena pagato {season}, quindi hai {amount} di credito della lega sul tuo account.",
    referralReason: "qualcuno si è iscritto con il tuo link d'invito",
    rebateSubject: "{amount} di credito della lega per le partite rinviate",
    rebateHeading: "Una parte della quota ti torna indietro",
    rebateLead:
      "{team} ha perso {lost} partite su {count} in {season} per il maltempo, senza recupero. La tua parte del rimborso, {amount}, è ora credito della lega.",
    rebateReason: "hai contribuito alla quota {season} di {team}",
  },
  newTeam: {
    approvedSubject: "{team} è dentro per {season}",
    approvedHeading: "La tua squadra è approvata",
    approvedLead:
      "La lega ha detto sì: {team} è pronta per {season}, con te come capitano.",
    approvedMore:
      "Ora condividi il link d'invito della squadra così i tuoi giocatori possono entrare, e firma la liberatoria. La squadra è confermata quando ha abbastanza giocatori e la quota è coperta.",
    invite: "Invita i tuoi giocatori",
    askedReason: "hai chiesto di creare {team}",
    declinedSubject: "Sulla tua richiesta di creare {team}",
    declinedHeading: "La tua richiesta di nuova squadra",
    declinedLead: "La lega non può aggiungere {team} a {season}.",
    declinedMore:
      "Puoi comunque entrare in una squadra con un invito o come giocatore libero.",
    seeSeason: "Vedi la tua stagione",
    leftSubject: "{player} crea una nuova squadra",
    leftHeading: "{player} ha lasciato {left}",
    leftLead:
      "La lega ha approvato la richiesta di {player} di creare {team} in {season}, quindi non è più nella tua rosa.",
    leftMore:
      "Se ti serve un altro giocatore, invitane uno o chiedi alla lega un giocatore libero.",
    seeRoster: "Vedi la tua rosa",
    captainReason: "sei capitano di {team}",
  },
  payment: {
    today: "oggi",
    tomorrow: "domani",
    inDays: { $plural: { one: "tra {n} giorno", other: "tra {n} giorni" } },
    subject: "La tua quota {season} scade {when}",
    heading: "Il tuo posto va pagato {when}",
    lead: "La scadenza del pagamento per {season} è il {deadline}. Paga prima per tenerti il posto.",
    waiverFirst:
      "Prima firma la liberatoria della stagione; il pagamento viene subito dopo.",
    byCard:
      "Con la carta ci vuole un minuto. Se hai già pagato il capitano in contanti o con Venmo, chiedigli di segnarlo nell'app.",
    action: "Paga ora",
    reason: "sei iscritto a {season} e non hai ancora pagato",
  },
  photo: {
    approvedSubject: "La tua foto è stata scelta",
    approvedHeading: "La tua foto è online",
    approvedLead:
      "Grazie per averla condivisa! La lega ha approvato la tua foto, e ora compare su {where}. Potrebbe finire anche sui social della lega.",
    deleteAnytime: "Puoi eliminarla dalle tue foto quando vuoi.",
    seeIt: "Vedila sul sito",
    rejectedSubject: "Sulla foto che hai caricato",
    rejectedHeading: "La lega non ha usato la tua foto",
    rejectedLead:
      "Grazie per avercela mandata. La lega non pubblicherà questa, quindi è stata eliminata dal sito.",
    keepThem:
      "Continua a mandarle: le foto nitide e ben illuminate delle giornate e degli eventi hanno più possibilità.",
    yourPhotos: "Le tue foto",
    reason: "hai caricato una foto per la lega",
  },
  privateEvent: {
    tournament: "torneo",
    league: "lega privata",
    reason: "hai chiesto alla lega: {what} per {organization}",
    receivedSubject: "Abbiamo ricevuto la tua richiesta: {what}",
    receivedHeading: "Grazie, abbiamo la tua richiesta",
    receivedLead:
      "La lega ha la tua richiesta ({what}) per {organization}. Un admin guarderà campi e date e ti risponderà, di solito entro una settimana.",
    receivedMore: "Puoi vedere a che punto è quando vuoi.",
    seeRequest: "Vedi la tua richiesta",
    acceptedSubject: "{season} si fa",
    acceptedHeading: "È tutto pronto: {what}",
    acceptedLead:
      "La lega ha preparato {season} per {organization}. È privato: possono entrare solo le tue squadre, e niente compare sulle pagine pubbliche della lega.",
    acceptedMore:
      "Condividi il link d'invito con il capitano di ogni squadra. La tua pagina mostra le squadre man mano che entrano, il calendario quando esce e i risultati.",
    organizerPage: "Apri la tua pagina da organizzatore",
    declinedSubject: "Sulla tua richiesta: {what}",
    declinedHeading: "La tua richiesta",
    declinedLead:
      "Questa volta la lega non può ospitare la tua richiesta ({what}) per {organization}.",
    declinedMore: "Puoi riprovare per altre date.",
    askAgain: "Chiedi di nuovo",
  },
  rainout: {
    movesSubject: "Rinviata per pioggia: {teams} passa a {makeup}",
    postponedSubject: "Rinviata per pioggia: {teams} è rinviata",
    newTimeHeading: "La tua partita ha un nuovo orario",
    postponedHeading: "La tua partita è rinviata",
    lead: "{teams} ({was}) è rinviata per pioggia.",
    makeup:
      "Il recupero è {makeup}. Avvisa il tuo capitano se non puoi esserci.",
    noMakeup:
      "Non ha ancora un orario di recupero. Il nuovo orario sarà in calendario appena la lega lo fissa.",
    action: "Vedi il calendario",
    reason: "giochi questa partita in {season}",
  },
  referee: {
    subject: "Serve un arbitro: {teams}, {when}",
    heading: "Puoi arbitrare questa partita?",
    dropped: "{teams}, {when}, è rimasta senza arbitro.",
    none: "{teams}, {when}, non ha ancora un arbitro.",
    first:
      'Il primo arbitro che tocca "La prendo" ha la partita. Se qualcuno ti ha preceduto, la pagina lo dice.',
    action: "La prendo",
    reason: "arbitri in {season} e a quell'ora non giochi e non arbitri",
  },
  ruleChange: {
    subject: "Cambio di regola dal {on}: {summary}",
    heading: "Le regole della lega cambiano",
    effective: "Vale dal {on}.",
    sections: {
      $plural: {
        one: "Sezione cambiata: {sections}.",
        other: "Sezioni cambiate: {sections}.",
      },
    },
    read: "Leggi il nuovo testo sulla pagina delle regole, e chiedi al tuo capitano o alla lega se qualcosa non è chiaro.",
    action: "Leggi le regole",
    reason: "giochi in una stagione della lega",
  },
  scoreConfirm: {
    subject: "Conferma il risultato: {result}",
    heading: "Questo risultato è giusto?",
    lead: "{reportedBy} ha comunicato {result} per {teams} ({when}).",
    more: "Confermalo, o contestalo se è sbagliato. Se nessuno lo contesta, diventa definitivo dopo 24 ore.",
    action: "Conferma o contesta",
    reason: "sei capitano di una delle squadre di questa partita",
  },
  scoreReminder: {
    subject: "Manca il risultato: {teams}",
    heading: "Com'è finita?",
    lead: "{teams} ({when}) non ha ancora un risultato.",
    referee:
      "Come arbitro, inseriscilo ora così la classifica si aggiorna stasera. Ci vogliono pochi secondi.",
    captain:
      "L'arbitro non l'ha inserito. Può farlo uno dei due capitani, e l'altra squadra conferma.",
    action: "Inserisci il risultato",
    refereeReason: "hai arbitrato questa partita",
    captainReason: "sei capitano di una delle squadre di questa partita",
  },
  seasonCard: {
    subject: "La tua stagione di kickball: {season}",
    heading: "La tua stagione di kickball",
    lead: "{season} è archiviata. La tua scheda ha le tue partite, i punti e il bilancio della tua squadra, i tuoi premi e la tua partita migliore.",
    private: "La vedi solo tu finché non decidi di condividerne il link.",
    action: "Vedi la tua stagione",
    reason: "hai giocato in {season}",
  },
  shirt: {
    subject: "La tua taglia di maglietta per {season}",
    heading: "Che taglia di maglietta porti?",
    lead: "La lega ordina le magliette per {season}, e non abbiamo ancora la tua taglia.",
    pick: "Sceglila sul tuo profilo: {sizes}. Ci vogliono pochi secondi.",
    action: "Scegli la mia taglia",
    reason: "sei iscritto a {season}",
  },
  sub: {
    requestSubject: "{team} cerca sostituti ({spots}): {when}",
    requestHeading: "{team} cerca un sostituto",
    requestLead: "{teams}, {when}. {team} cerca: {spots}.",
    fromCaptain: "Dal capitano: {note}",
    hold: 'Tocca "Ci sono" per tenerti un posto. Il capitano conferma, e ricevi una risposta via email.',
    seeRequests: "Vedi le richieste di sostituti",
    freeAgentReason:
      "sei un giocatore libero in {season} e a quell'ora sei libero",
    playerReason: "giochi in {season} e la tua squadra a quell'ora non gioca",
    claimedSubject: "{player} vuole fare il sostituto: {when}",
    claimedHeading: "{player} può fare il sostituto",
    claimedLead: "{player} tiene un posto per {teams}, {when}.",
    claimedMore:
      "Approvalo così sa che gioca, o rifiuta per liberare il posto.",
    approveOrDecline: "Approva o rifiuta",
    captainReason: "sei capitano di {team}, che ha chiesto dei sostituti",
    withdrawnSubject: "{player} alla fine non può fare il sostituto: {when}",
    withdrawnHeading: "Un sostituto si è ritirato",
    withdrawnLead:
      "{player} non può più giocare in {teams}, {when}. Il suo posto è di nuovo libero.",
    seeYourRequest: "Vedi la tua richiesta",
    approvedSubject: "Sostituisci in {team}: {when}",
    approvedHeading: "Giochi!",
    approvedLead:
      "Il capitano di {team} ha detto sì. Ci sei per {teams}, {when}.",
    approvedMore:
      "Se puoi, metti il colore della squadra. Se cambi programma, ritirati dalla pagina dei sostituti così trovano qualcun altro.",
    seeDetails: "Vedi i dettagli",
    offeredReason: "ti sei offerto come sostituto per {team}",
    declinedSubject: "{team} è a posto: {when}",
    declinedHeading: "Grazie per esserti offerto",
    declinedLead:
      "Il capitano di {team} ha quello che serve per {teams}, {when}. Grazie per esserti fatto avanti.",
    cancelledSubject: "{team} non cerca più sostituti: {when}",
    cancelledHeading: "Richiesta ritirata",
    cancelledLead:
      "{team} ha ritirato la richiesta di sostituti per {teams}, {when}, quindi non giochi. Grazie per esserti offerto.",
  },
  survey: {
    subject: "Com'è andata {season}?",
    lead: "Cinque domande veloci sulla stagione, circa due minuti. Le risposte sono anonime: la lega vede totali e commenti, mai chi li ha scritti.",
    action: "Rispondi al sondaggio",
    reason: "hai giocato in {season}",
  },
  suspension: {
    subject: "Sei squalificato: {length}",
    heading: "Sei squalificato",
    banned:
      "Dopo una segnalazione di incidente, {league} ti ha escluso dal gioco per sempre.",
    suspended:
      "Dopo una segnalazione di incidente, {league} ti ha squalificato per {length} in {season}.",
    lastsGames:
      "Scala man mano che le partite della tua squadra diventano definitive, e finisce da sola quando sono state giocate.",
    lastsSeason: "Finisce quando finisce la stagione.",
    lastsPermanent: "Dura finché la lega non la toglie.",
    meaning:
      "Mentre sei squalificato non puoi confermare che giochi una partita, prendere un posto da sostituto né essere messo in una squadra dalla lista dei giocatori liberi. Il tuo capitano vede che sei squalificato, non il perché.",
    appealTo:
      "Per fare ricorso, rispondi a questa email o scrivi a {email}, e di' cosa vuoi che la lega sappia.",
    appeal:
      "Per fare ricorso, rispondi a questa email e di' cosa vuoi che la lega sappia.",
    reason: "la lega ti ha squalificato dopo una segnalazione di incidente",
  },
  teamRole: {
    offeredSubject: "{captain} ti ha chiesto di fare il capitano di {team}",
    offeredHeading: "Capitano di {team}?",
    offeredLead:
      "{captain} vorrebbe che diventassi capitano di {team} per {season}.",
    offeredMore:
      "Non cambia niente finché non dici sì. Come capitano gestisci rosa, inviti, pagamenti e vicecapitani; chi te lo chiede resta come vicecapitano.",
    answer: "Rispondi sulla pagina della squadra",
    playReason: "giochi con {team}",
    acceptedSubject: "{player} ora è capitano di {team}",
    acceptedHeading: "La tua squadra ha un nuovo capitano",
    acceptedLead:
      "{player} ha accettato: da ora è capitano di {team} per {season}.",
    acceptedMore:
      "Resti come vicecapitano, con formazioni, richieste di sostituti e risultati della squadra. Il nuovo capitano può cambiarlo.",
    offeredReason: "hai offerto il ruolo di capitano a {player}",
    declinedSubject: "{player} non prende il posto di capitano di {team}",
    declinedHeading: "Sei ancora il capitano",
    declinedLead:
      "{player} ha detto no a fare il capitano di {team}, quindi resti capitano per {season}.",
    declinedMore:
      "Puoi offrirlo a un altro compagno dalla pagina della squadra.",
    coSubject: "Sei vicecapitano di {team}",
    coHeading: "Sei vicecapitano",
    coLead:
      "Ora aiuti a gestire {team} per {season}: decidi l'ordine di battuta, chiedi sostituti, inserisci e conferma i risultati e vedi chi ha pagato.",
    coMore: "Puoi lasciare il ruolo dalla pagina della squadra quando vuoi.",
    playerSubject: "Non sei più vicecapitano di {team}",
    playerHeading: "Di nuovo solo a giocare",
    playerLead:
      "Ora sei in {team} per {season} come giocatore, senza gli strumenti da vicecapitano.",
  },
  volunteer: {
    subject: "Domani: il tuo turno da {role}",
    heading: "Grazie per il tuo aiuto!",
    lead: "Sei segnato come {role} a {occasion}: {when}.",
    leadAt: "Sei segnato come {role} a {occasion}: {when}, {place}.",
    drop: "Alla fine non puoi? Lascia il turno nell'app così qualcun altro può prenderlo.",
    action: "Vedi i tuoi turni",
    reason: "ti sei iscritto a un turno da volontario",
  },
  winBack: {
    reason:
      "hai già giocato nella lega e le iscrizioni per {season} sono aperte",
  },
};
