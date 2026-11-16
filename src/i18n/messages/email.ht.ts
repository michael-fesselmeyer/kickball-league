import type { Translation } from "../catalog";
import type { emailEn } from "./email.en";

/**
 * The emails and push notifications in Haitian Creole (`ht.email`).
 * Friendly "ou", and the game words in the glossary in docs/i18n.md.
 */
export const emailHt: Translation<typeof emailEn> = {
  layout: {
    fewer: "Ou pito resevwa mwens imèl?",
    turnDown: {
      team: "Sèlman ekip mwen",
      weekly: "Rezime chak semèn pito",
      snooze: "Kanpe pou 2 semèn",
    },
    because: "Ou resevwa imèl sa a paske {reason}.",
    settings: "Chwazi ki imèl ou resevwa ak ki lè",
    stopAbout: "Sispann imèl sou {topic}",
    pushBecause: "Paske {reason}.",
  },
  topics: {
    lost_found: "bagay pèdi ak jwenn",
    rules: "règ ak orè",
    rainout: "match anile akoz lapli",
    schedule_change: "chanjman nan orè a",
    game_reminder: "rapèl match",
    payment: "peman ak enskripsyon",
    sub_request: "demann ranplasan",
    announcement: "nouvèl lig la",
    score: "nòt",
    events: "evènman",
    marketing: "nouvèl ak òf lig la",
    new_team: "demann nouvo ekip",
    discipline: "sispansyon",
    digest: "rezime a",
    operations: "operasyon lig la",
    photos: "foto ou yo",
    team_roles: "kapitèn ak ko-kapitèn",
    game_day_watch: "siveyans meteyo",
  },
  common: {
    seeGame: "Gade match la",
    seeTeam: "Gade ekip ou",
    seeEvent: "Gade evènman an",
    seeOrders: "Gade kòmand ou yo",
    seeCredit: "Gade kredi ou",
    seeOtherRequests: "Gade lòt demann",
    openApp: "Louvri aplikasyon an",
    fromLeague: "Mesaj lig la: {text}",
    cardRefund: "{returned}. Yon ranbousman sou kat konn parèt nan 5 a 10 jou.",
    youPaid: "Ou te peye {paid}.",
    nextFee: "L ap retire otomatikman sou pwochen frè ou lè ou peye.",
  },
  announcement: {
    action: "Louvri aplikasyon lig la",
    reasonTeam: "ou jwe nan {team} pou {season}",
    reasonLeague: "ou enskri pou {season}",
  },
  awayShort: {
    subject: "{team} ka manke moun semèn {week} la",
    heading: "Manke moun semèn {week} la?",
    lead: "{player} pap la semèn sa a, kidonk {available} nan jwè ou yo disponib pou {games}.",
    game: "{when} kont {opponent}",
    and: " ak ",
    subsOpen: "Mande yon ranplasan kounye a e jwè ki lib aswè sa a ap konnen.",
    subsClosed: "Pa gen demann ranplasan pou match playoff; tcheke ak lig la.",
    askSub: "Mande yon ranplasan",
    reason: "ou se kapitèn {team} pou {season}",
  },
  concern: {
    received:
      "{league} resevwa mesaj ou. Se sèlman administratè lig la ki li l, e youn nan yo ap reponn ou.",
    followInApp: "Ou ka swiv li nan aplikasyon an.",
    answerByEmail: "Si ou te kite yon adrès, repons lan ap vini nan imèl sa a.",
    replied: "{league} reponn:",
    closed: "{league} fèmen mesaj ou. Sa yo te fè:",
    receivedTitle: "Nou resevwa mesaj ou",
    replyTitle: "Yon repons lig la",
    closedTitle: "Mesaj ou fèmen",
    reason: "ou te voye yon mesaj bay lig la",
  },
  digest: {
    updates: { $plural: { one: "{n} nouvèl", other: "{n} nouvèl" } },
    subject: "Nouvèl lig la: {updates}",
    headingDaily: "Nouvèl lig la jodi a",
    headingWeekly: "Nouvèl lig la semèn sa a",
    lead: {
      $plural: {
        one: "Men {n} nouvèl nou te kenbe pou bwat imèl ou rete kalm.",
        other: "Men {n} nouvèl nou te kenbe pou bwat imèl ou rete kalm.",
      },
    },
    reasonDaily:
      "ou chwazi resevwa nouvèl ki ka tann nan yon sèl imèl chak jou",
    reasonWeekly:
      "ou chwazi resevwa nouvèl ki ka tann nan yon sèl imèl chak semèn",
    reasonCap: {
      $plural: {
        one: "ou resevwa {n} imèl lig ki ka tann pa jou pi plis, e sa yo te vini apre sa",
        other:
          "ou resevwa {n} imèl lig ki ka tann pa jou pi plis, e sa yo te vini apre sa",
      },
    },
    settings: "Chanje limit chak jou, rezime oswa lè silans ou",
  },
  event: {
    rsvpOn: "Konfime sou {site}: {url}",
    announcedSubject: "Nouvo evènman: {title}",
    updatedSubject: "Mizajou: {title}",
    announcedHeading: "Ou envite: {title}",
    updatedHeading: "{title} chanje",
    announcedLead: "{title} ap fèt: {where}.",
    updatedLead: "Lig la chanje detay {title}. Kounye a se {where}.",
    postedReason: "lig la pibliye yon evènman pou ou",
    spotSubject: "Ou ladan l: {title}",
    spotHeading: "Yon plas louvri pou {title}",
    spotLead:
      "Ou te sou lis datant pou {title} ({where}), e kounye a ou gen yon plas.",
    spotDrop:
      "Plan ou chanje? Lage plas ou sou paj evènman an pou pwochen moun sou lis la jwenn li.",
    waitlistReason: "ou te mete non ou sou lis datant evènman sa a",
    offSubject: "Anile: {title}",
    offHeading: "{title} anile",
    offLead:
      "Lig la anile {title} ({where}). Nou regrèt sa. Konfimasyon ou efase e ou pa bezwen fè anyen.",
    otherEvents: "Gade lòt evènman",
    rsvpReason: "ou te konfime pou evènman sa a",
  },
  ticket: {
    receiptSubject: "Tikè ou: {title}",
    receiptHeading: "Ou prale nan {title}",
    receiptLead: "Tikè ou pou {title} ({where}) konfime.",
    code: "Kòd check-in ou se {code}. Montre l nan pòt la.",
    seeTicket: "Gade tikè ou",
    boughtReason: "ou te achte yon tikè",
    refundedSubject: "Ranbouse: {title}",
    refundedHeading: "Tikè ou pou {title} ranbouse",
    refundedLead:
      "Lig la ranbouse tikè ou pou {title} ({where}), kidonk li pa fè ou antre ankò.",
    offeredSubject: "Yon plas louvri: {title}",
    offeredHeading: "Yon plas louvri pou {title}",
    offeredLead:
      "Ou te sou lis datant pou {title} ({where}), e kounye a nou kenbe yon plas pou ou.",
    buyBy:
      "Achte tikè ou anvan {expires}. Apre sa, li ale bay pwochen moun nan liy lan.",
    buy: "Achte tikè ou. Apre sa, li ale bay pwochen moun nan liy lan.",
    buyAction: "Achte tikè ou",
  },
  gameDay: {
    laterTime: "pi ta",
    delayedSubject: "Kòmanse an reta: {teams}, {day}",
    delayedHeading: "Match ou kòmanse a {time} kounye a",
    delayedLead:
      "{teams} {day} te dwe kòmanse a {was} e kounye a l ap kòmanse a {time}.{why}",
    offSubject: "Anile: {teams}, {day}",
    offHeading: "Match ou anile",
    offLead:
      "{teams} {day} a {was} anile.{why} W ap konnen lè match ranplasman an depi lig la fikse l.",
    backSubject: "L ap jwe ankò: {teams}, {day}",
    backHeading: "Match ou ap jwe ankò",
    backLead: "{teams} {day} ap jwe ankò a {was}.{why}",
    playReason: "ou jwe nan {season}",
    watchSubject: "N ap swiv meteyo a: desizyon anvan {time}, {day}",
    watchHeading: "N ap deside anvan {time}",
    watchLead:
      "Lig la ap swiv meteyo a pou {teams} {day} e l ap deside anvan {time} si match yo ap jwe.{why}",
    watchMore:
      "Si match ou kòmanse an reta oswa anile, w ap resevwa yon lòt mesaj.",
    watchReason: "ou te mande avètisman meteyo anvan match ou yo",
  },
  gear: {
    holding: "Ou gen {kit}.",
    onItsWay:
      "{kit} sou wout pou rive kote ou: konfime l nan aplikasyon an lè ou genyen l.",
    with: "{name} gen {kit} kounye a; pran l nan men l, e konfime nan aplikasyon an lè l ba ou l.",
    atHome:
      '{kit} nan {place}; peze "I picked up {kit}" nan aplikasyon an lè ou pran l.',
    subject: "Pote {kit} nan {place} anvan {by} {day}",
    heading: "{kit} pou {teams}",
    bring:
      "Pote l nan {place} anvan {by} {day}, demi èdtan anvan {teams} kòmanse.",
    missing:
      "Si yon bagay manke nan twous la, rapòte l nan aplikasyon an pou lig la ka ranplase l.",
    action: "Louvri materyèl ou",
    reason: "ou ap pote materyèl lig la nan match sa a",
  },
  giveaway: {
    subject: "Ou genyen tiraj {event} la",
    heading: "Ou genyen!",
    lead: "Non ou soti nan tiraj {event} la: {prize}.",
    leadFrom: "Non ou soti nan tiraj {event} la: {prize}, gras a {donor}.",
    claim:
      "Paj tiraj la di kijan pou w resevwa l. Tiraj la te fèt o aza, pami tout moun ki te fè check-in.",
    action: "Gade pri ou",
    reason: "ou te patisipe nan tiraj {event} la",
  },
  merch: {
    teamColors: "{description}, koulè {team}",
    receiptSubject: "Kòmand ou: {description}",
    receiptHeading: "Mèsi pou kòmand ou",
    receiptLead: "Kòmand ou pou {what} pase.",
    letYouKnow: "N ap fè ou konnen lè li pare.",
    reason: "ou te kòmande nan boutik lig la",
    readySubject: "Pare: {description}",
    readyHeading: "Kòmand ou pare",
    readyLead: "{what} ou pare. Chèche l nan men lig la nan pwochen match ou.",
    refundedSubject: "Ranbouse: {description}",
    refundedHeading: "Kòmand ou ranbouse",
    refundedLead: "Lig la ranbouse kòmand ou pou {what}.",
  },
  money: {
    warningLeadCharge:
      "Frè ekip ou a pou {season} gen {balance} ki poko peye toujou. Kòm garan ekip la, {on} y ap retire {charge} sou {card} ou: rès la nan pri kat la, ki kouvri frè kat la.",
    warningSubject: "{team} toujou dwe {balance}: kat ou ap peye {on}",
    warningHeading: "Atansyon: {team} toujou dwe {balance}",
    warningLead:
      "Frè ekip ou pou {season} toujou gen {balance} ki pa peye. Kòm garanti ekip la, {card} ou ap peye kantite sa a {on}.",
    warningMore:
      "Tout sa koekipye ou yo peye anvan sa ap diminye montan an. Apre sa, rekipere rès la nan men yo, oswa retire kat la si ou pito peye yon lòt jan.",
    whoPaid: "Gade kiyès ki peye",
    guaranteeReason: "ou te anrejistre yon kat pou garanti frè {team}",
    failedSubject: "Nou pa t ka fè kat ou peye pou {team}",
    failedHeading: "Kat ou refize",
    failedLead:
      "Nou te eseye fè kat ou anrejistre a peye {balance} pou rès frè {team} pou {season}, e bank lan di non.",
    failedMore:
      "Ekip ou pa konfime toutotan frè a pa peye. Peye rès la sou paj ekip la, oswa anrejistre yon lòt kat.",
    payBalance: "Peye rès la",
    waitlistSubject:
      "Yon plas pou ekip louvri nan {season}. Li pou ou jouk {expires}",
    waitlistHeading: "Se tou pa ou! Yon plas fèk louvri",
    waitlistLead:
      "Yon plas pou ekip louvri nan {season} e se ou ki pwochen sou lis datant lan. N ap kenbe l pou ou jouk {expires}.",
    waitlistMore:
      "Enskri ekip ou anvan sa pou pran l. Apre sa, li ale bay pwochen ekip nan liy lan.",
    registerTeam: "Enskri ekip ou",
    waitlistReason: "ou te mete non ou sou lis datant {season}",
    referralSubject: "Ou genyen {amount} kredi lig la",
    referralHeading: "Mèsi paske ou mennen yon zanmi",
    referralLead:
      "Yon moun ou te envite fèk peye pou {season}, kidonk {amount} kredi lig la nan kont ou.",
    referralReason: "yon moun enskri ak lyen referans ou",
    rebateSubject: "{amount} kredi lig la pou match ki te anile akoz lapli",
    rebateHeading: "Yon pati nan frè ou ap tounen",
    rebateLead:
      "{team} pèdi {lost} sou {count} match nan {season} akoz move tan e yo pa t ka reprann yo. Pa ou nan ranbousman an, {amount}, se kredi lig la kounye a.",
    rebateReason: "ou te peye pou frè {team} pou {season}",
  },
  newTeam: {
    approvedSubject: "{team} ladan l pou {season}",
    approvedHeading: "Ekip ou apwouve",
    approvedLead: "Lig la di wi: {team} pare pou {season}, e se ou ki kapitèn.",
    approvedMore:
      "Kounye a, pataje lyen envitasyon ekip ou pou jwè ou yo ka antre, e siyen dekarg responsablite a. Ekip la konfime lè li gen ase jwè e frè a peye.",
    invite: "Envite jwè ou yo",
    askedReason: "ou te mande pou kòmanse {team}",
    declinedSubject: "Sou demann ou pou kòmanse {team}",
    declinedHeading: "Demann nouvo ekip ou",
    declinedLead: "Lig la pa ka ajoute {team} nan {season}.",
    declinedMore:
      "Ou ka toujou antre nan yon ekip ak envitasyon oswa kòm jwè lib.",
    seeSeason: "Gade sezon ou",
    leftSubject: "{player} ap kòmanse yon nouvo ekip",
    leftHeading: "{player} kite {left}",
    leftLead:
      "Lig la apwouve demann {player} pou kòmanse {team} nan {season}, kidonk li pa sou lis jwè ou ankò.",
    leftMore:
      "Si ou bezwen yon lòt jwè, envite youn oswa mande lig la yon jwè lib.",
    seeRoster: "Gade lis jwè ou",
    captainReason: "ou se kapitèn {team}",
  },
  payment: {
    today: "jodi a",
    tomorrow: "demen",
    inDays: { $plural: { one: "nan {n} jou", other: "nan {n} jou" } },
    subject: "Frè {season} ou dwe peye {when}",
    heading: "Plas ou bezwen peye {when}",
    lead: "Dat limit pou peye pou {season} se {deadline}. Peye anvan sa pou kenbe plas ou.",
    waiverFirst:
      "Siyen dekarg responsablite sezon an anvan; etap pou peye a vini tousuit apre.",
    byCard:
      "Ak kat, sa pran yon minit. Si ou te deja peye kapitèn ou an kach oswa ak Venmo, mande l make sa nan aplikasyon an.",
    action: "Peye kounye a",
    reason: "ou enskri pou {season} e ou poko peye",
  },
  photo: {
    approvedSubject: "Yo chwazi foto ou",
    approvedHeading: "Foto ou parèt",
    approvedLead:
      "Mèsi paske ou pataje! Lig la apwouve foto ou, e kounye a li parèt sou {where}. Li ka parèt sou rezo sosyal lig la tou.",
    deleteAnytime: "Ou ka efase l nan foto ou yo nenpòt ki lè.",
    seeIt: "Gade l sou sit la",
    rejectedSubject: "Sou foto ou te voye a",
    rejectedHeading: "Lig la pa t itilize foto ou",
    rejectedLead:
      "Mèsi paske ou voye l. Lig la pap pibliye sa a, kidonk yo efase l sou sit la.",
    keepThem:
      "Kontinye voye: foto klè, ak bon limyè, nan jou match ak evènman yo gen pi bon chans.",
    yourPhotos: "Foto ou yo",
    reason: "ou te voye yon foto pou lig la",
  },
  privateEvent: {
    tournament: "tounwa",
    league: "lig prive",
    reason: "ou te mande lig la yon {what} pou {organization}",
    receivedSubject: "Nou resevwa demann {what} ou",
    receivedHeading: "Mèsi, nou resevwa demann ou",
    receivedLead:
      "Lig la resevwa demann ou pou yon {what} pou {organization}. Yon administratè ap gade teren ak dat yo e reponn ou, anjeneral nan yon semèn.",
    receivedMore: "Ou ka wè ki kote li ye nenpòt ki lè.",
    seeRequest: "Gade demann ou",
    acceptedSubject: "{season} ap fèt",
    acceptedHeading: "{what} ou pare",
    acceptedLead:
      "Lig la pare {season} pou {organization}. Li prive: se sèlman ekip ou yo ki ka antre, e anyen sou li pa parèt sou paj piblik lig la.",
    acceptedMore:
      "Pataje lyen envitasyon an ak kapitèn chak ekip. Paj ou montre ekip yo pandan y ap antre, orè a depi li soti, ak rezilta yo.",
    organizerPage: "Louvri paj òganizatè ou",
    declinedSubject: "Sou demann {what} ou",
    declinedHeading: "Demann ou",
    declinedLead: "Lig la pa ka fè yon {what} pou {organization} fwa sa a.",
    declinedMore: "Ou byenveni pou mande ankò pou lòt dat.",
    askAgain: "Mande ankò",
  },
  rainout: {
    movesSubject: "Anile akoz lapli: {teams} deplase pou {makeup}",
    postponedSubject: "Anile akoz lapli: {teams} ranvwaye",
    newTimeHeading: "Match ou gen yon nouvo lè",
    postponedHeading: "Match ou ranvwaye",
    lead: "{teams} ({was}) anile akoz lapli.",
    makeup: "Match ranplasman an se {makeup}. Di kapitèn ou si ou pa ka vini.",
    noMakeup:
      "Li poko gen lè pou match ranplasman. Nouvo lè a ap parèt sou orè a depi lig la fikse l.",
    action: "Gade orè a",
    reason: "ou jwe nan match sa a nan {season}",
  },
  referee: {
    subject: "Bezwen yon abit: {teams}, {when}",
    heading: "Èske ou ka abitre match sa a?",
    dropped: "{teams}, {when}, pèdi abit li.",
    none: "{teams}, {when}, poko gen abit.",
    first:
      'Premye abit ki peze "Take it" jwenn match la. Si yon moun te pi rapid, paj la ap di sa.',
    action: "M pran l",
    reason: "ou abitre nan {season} e ou pa jwe ni abitre nan lè sa a",
  },
  ruleChange: {
    subject: "Chanjman règ depi {on}: {summary}",
    heading: "Règ lig la ap chanje",
    effective: "Li antre an vigè {on}.",
    sections: {
      $plural: {
        one: "Seksyon ki chanje: {sections}.",
        other: "Seksyon ki chanje: {sections}.",
      },
    },
    read: "Li nouvo tèks la sou paj règ yo, e mande kapitèn ou oswa lig la si yon bagay pa klè.",
    action: "Li règ yo",
    reason: "ou jwe nan yon sezon lig la",
  },
  scoreConfirm: {
    subject: "Konfime nòt la: {result}",
    heading: "Èske nòt sa a kòrèk?",
    lead: "{reportedBy} rapòte {result} pou {teams} ({when}).",
    more: "Konfime l, oswa konteste l si li pa bon. Si pèsonn pa konteste l, li vin final apre 24 èdtan.",
    action: "Konfime oswa konteste",
    reason: "ou se kapitèn youn nan ekip yo nan match sa a",
  },
  scoreReminder: {
    subject: "Bezwen nòt la: {teams}",
    heading: "Ki nòt final la te ye?",
    lead: "{teams} ({when}) poko gen nòt.",
    referee:
      "Kòm abit, antre l kounye a pou klasman an ka mete ajou aswè a. Sa pran kèk segonn.",
    captain:
      "Abit ou poko antre l. Nenpòt kapitèn ka fè l, e lòt ekip la konfime.",
    action: "Antre nòt la",
    refereeReason: "ou te abitre match sa a",
    captainReason: "ou se kapitèn youn nan ekip yo nan match sa a",
  },
  seasonCard: {
    subject: "Sezon kickball {season} ou",
    heading: "Sezon kickball ou",
    lead: "{season} fini. Kat ou gen match ou yo, pwen ak rezilta ekip ou, pri ou yo ak pi bon match ou.",
    private: "Se sèlman ou ki ka wè l jouk ou deside pataje lyen an.",
    action: "Gade sezon ou",
    reason: "ou te jwe nan {season}",
  },
  shirt: {
    subject: "Gwosè mayo ou pou {season}",
    heading: "Ki gwosè mayo ou mete?",
    lead: "Lig la ap kòmande mayo pou {season}, e nou poko gen gwosè pa ou.",
    pick: "Chwazi l sou pwofil ou: {sizes}. Sa pran kèk segonn.",
    action: "Chwazi gwosè m",
    reason: "ou enskri pou {season}",
  },
  sub: {
    requestSubject: "{team} bezwen {spots}: {when}",
    requestHeading: "{team} bezwen yon ranplasan",
    requestLead: "{teams}, {when}. {team} ap chèche {spots}.",
    fromCaptain: "Mesaj kapitèn nan: {note}",
    hold: 'Peze "I\'m in" pou kenbe yon plas. Kapitèn nan konfime, e w ap resevwa repons pa imèl.',
    seeRequests: "Gade demann ranplasan yo",
    freeAgentReason: "ou se jwè lib nan {season} e ou lib nan lè sa a",
    playerReason: "ou jwe nan {season} e ekip ou pa jwe nan lè sa a",
    claimedSubject: "{player} vle ranplase: {when}",
    claimedHeading: "{player} ka ranplase",
    claimedLead: "{player} ap kenbe yon plas pou {teams}, {when}.",
    claimedMore:
      "Apwouve l pou l konnen l ap jwe, oswa refize pou libere plas la.",
    approveOrDecline: "Apwouve oswa refize",
    captainReason: "ou se kapitèn {team}, ki te mande ranplasan",
    withdrawnSubject: "{player} pa ka ranplase finalman: {when}",
    withdrawnHeading: "Yon ranplasan soti",
    withdrawnLead:
      "{player} pa ka jwe nan {teams}, {when} ankò. Plas li louvri ankò.",
    seeYourRequest: "Gade demann ou",
    approvedSubject: "W ap ranplase pou {team}: {when}",
    approvedHeading: "W ap jwe!",
    approvedLead: "Kapitèn {team} di wi. Ou ladan l pou {teams}, {when}.",
    approvedMore:
      "Mete koulè ekip la si ou kapab. Si plan ou chanje, soti sou paj ranplasan an pou yo ka jwenn yon lòt moun.",
    seeDetails: "Gade detay yo",
    offeredReason: "ou te ofri pou ranplase pou {team}",
    declinedSubject: "{team} gen ase moun: {when}",
    declinedHeading: "Mèsi paske ou ofri",
    declinedLead:
      "Kapitèn {team} gen sa li bezwen pou {teams}, {when}. Mèsi paske ou te la.",
    cancelledSubject: "{team} pa bezwen ranplasan ankò: {when}",
    cancelledHeading: "Demann lan retire",
    cancelledLead:
      "{team} retire demann ranplasan li pou {teams}, {when}, kidonk ou pap jwe ladan l. Mèsi paske ou ofri.",
  },
  survey: {
    subject: "Kijan {season} te ye?",
    lead: "Senk ti kesyon sou sezon an, anviwon de minit. Repons ou anonim: lig la wè total ak kòmantè yo, men pa janm kiyès ki ekri yo.",
    action: "Reponn sondaj la",
    reason: "ou te jwe nan {season}",
  },
  suspension: {
    subject: "Ou sispann: {length}",
    heading: "Ou sispann",
    banned: "Apre yon rapò ensidan, {league} entèdi ou jwe pou tout tan.",
    suspended:
      "Apre yon rapò ensidan, {league} sispann ou pou {length} nan {season}.",
    lastsGames:
      "Li diminye pandan match ekip ou yo vin final, e li fini poukont li lè yo fin jwe.",
    lastsSeason: "Li fini lè sezon an fini.",
    lastsPermanent: "Li dire jouk lig la leve l.",
    meaning:
      "Pandan ou sispann, ou pa ka konfime ou ap jwe nan yon match, pran yon plas ranplasan oswa antre nan yon ekip nan gwoup jwè lib yo. Kapitèn ou wè ou sispann, men li pa wè poukisa.",
    appealTo:
      "Pou fè apèl, reponn imèl sa a oswa ekri {email}, e di sa ou ta renmen lig la konnen.",
    appeal: "Pou fè apèl, reponn imèl sa a e di sa ou ta renmen lig la konnen.",
    reason: "lig la sispann ou apre yon rapò ensidan",
  },
  teamRole: {
    offeredSubject: "{captain} mande ou vin kapitèn {team}",
    offeredHeading: "Vin kapitèn {team}?",
    offeredLead:
      "{captain} ta renmen ou pran plas kapitèn {team} pou {season}.",
    offeredMore:
      "Anyen pa chanje toutotan ou pa di wi. Kòm kapitèn, ou jere lis jwè yo, envitasyon, peman ak ko-kapitèn yo; kapitèn kounye a rete kòm ko-kapitèn.",
    answer: "Reponn sou paj ekip ou",
    playReason: "ou jwe pou {team}",
    acceptedSubject: "{player} se kapitèn {team} kounye a",
    acceptedHeading: "Ekip ou gen yon nouvo kapitèn",
    acceptedLead:
      "{player} aksepte: se li ki kapitèn {team} pou {season} depi kounye a.",
    acceptedMore:
      "Ou rete kòm ko-kapitèn, ak lis pou match yo, demann ranplasan ak nòt ekip la. Nouvo kapitèn nan ka chanje sa.",
    offeredReason: "ou te ofri {player} pou l vin kapitèn",
    declinedSubject: "{player} pap pran {team}",
    declinedHeading: "Se ou ki toujou kapitèn",
    declinedLead:
      "{player} di non pou l vin kapitèn {team}, kidonk ou rete kapitèn pou {season}.",
    declinedMore: "Ou ka ofri l yon lòt koekipye sou paj ekip ou.",
    coSubject: "Ou se ko-kapitèn {team}",
    coHeading: "Ou se ko-kapitèn",
    coLead:
      "Kounye a ou ede jere {team} pou {season}: fè lòd pou choute, mande ranplasan, antre ak konfime nòt, e wè kiyès ki peye.",
    coMore: "Ou ka kite pozisyon an sou paj ekip ou nenpòt ki lè.",
    playerSubject: "Ou pa ko-kapitèn {team} ankò",
    playerHeading: "Retounen jwè",
    playerLead:
      "Ou nan {team} pou {season} kòm jwè kounye a, san zouti ko-kapitèn yo.",
  },
  volunteer: {
    subject: "Demen: tou volontè ou ({role})",
    heading: "Mèsi paske ou volontè!",
    lead: "Ou enskri pou {role} nan {occasion}: {when}.",
    leadAt: "Ou enskri pou {role} nan {occasion}: {when}, {place}.",
    drop: "Ou pa ka vini finalman? Lage tou a nan aplikasyon an pou yon lòt moun ka pran l.",
    action: "Gade tou volontè ou yo",
    reason: "ou te enskri pou yon tou volontè",
  },
  winBack: {
    reason: "ou te jwe nan lig la deja e enskripsyon pou {season} louvri",
  },
};
