import type { Translation } from "../catalog";
import type { EnglishMessages } from "./en";
import { emailHt } from "./email.ht";
import { pagesHt } from "./pages.ht";

/**
 * Haitian Creole (ADR 0094). Machine-drafted without a paid service; a
 * native-speaking player reviews it before launch (docs/i18n.md). Friendly
 * and direct ("ou"), with the game words in the glossary there.
 */
export const ht: Translation<EnglishMessages> = {
  shell: {
    brand: "Lig Kickball",
    skipToContent: "Ale nan kontni an",
    siteNav: "Sit",
    footer: {
      schedules: "Orè",
      history: "Istwa",
      about: "Sou nou",
      events: "Evènman",
      faq: "Kesyon yo poze souvan",
      contact: "Kontak",
      friends: "Zanmi",
      help: "Èd",
      park: "McCarren Park",
      rules: "Règ yo",
      sponsors: "Sponsò",
      signIn: "Konekte",
    },
    theme: {
      toLight: "Pase nan mòd klè",
      toDark: "Pase nan mòd fonse",
    },
    language: {
      group: "Lang",
      current: "{language} (kounye a)",
      report: "Ou wè yon tradiksyon ki pa bon oswa ki dwòl? Di lig la",
    },
  },
  profile: {
    language: {
      label: "Lang",
      hint: "Imèl ak notifikasyon yo ap vini nan lang sa a. Ekran aplikasyon an an angle pou kounye a.",
      saved: "Anrejistre. Imèl ak notifikasyon yo ap vini an {language}.",
      save: "Anrejistre lang lan",
    },
  },
  formats: {
    teams: { $plural: { one: "{n} ekip", other: "{n} ekip" } },
    players: { $plural: { one: "{n} jwè", other: "{n} jwè" } },
  },
  faq: {
    title: "Kesyon yo poze souvan",
    description:
      "Èske ou bezwen yon ekip? Èske gason ak fanm jwe ansanm? Konbyen sa koute, kisa pou mete, e kisa k ap pase si lapli tonbe? Repons rapid sou kickball pou granmoun nan Brooklyn.",
    home: "Akèy",
    headingStart: "Kesyon,",
    headingSwipe: "ak repons",
    intro:
      "An kout: gason ak fanm jwe ansanm, ou ka vini pou kont ou, e pèsonn pa bezwen konn jwe kickball byen.",
    sections: "Seksyon yo",
    readyTitle: "Nou la lè ou pare",
    readyBody:
      "Konekte ak imèl ou pou enskri yon ekip, antre nan yon ekip, oswa vini pou kont ou.",
    signUp: "Enskri pou yon sezon",
    joining: {
      title: "Antre nan lig la",
      team: {
        question: "Èske m bezwen yon ekip pou m antre?",
        answer:
          "Non. Enskri kòm jwè lib e lig la ap mete ou nan yon ekip anvan sezon an kòmanse. Anpil moun vini pou kont yo, e se fason ki pi rapid pou rankontre moun.",
      },
      friend: {
        question: "Kijan pou m antre nan ekip yon zanmi?",
        answer:
          "Mande kapitèn ou lyen envitasyon ekip la. Louvri l, konekte ak imèl ou, siyen dekarg responsablite a (waiver) e peye pa ou si ekip la ap pataje frè a. Se tout, ou sou lis jwè yo.",
      },
      age: {
        question: "Ki laj pou m genyen?",
        answer:
          "Fòk ou gen 18 an oswa plis pou jwe. Kèk evènman sosyal nan ba se pou moun 21 an oswa plis, e paj evènman an di sa.",
      },
      skill: {
        question: "Èske m bezwen konn jwe kickball byen?",
        answer:
          "Ditou. Si ou sonje rekreyasyon lekòl, ou kalifye. Match yo zanmitay, abit yo eksplike desizyon yo, e pèsonn pa pran tèt li si ou rate boul la.",
      },
    },
    season: {
      title: "Sezon an",
      when: {
        question: "Ki lè match yo ye?",
        answer:
          "Sa depann de sezon an ak pèmi pak la: dimanch apremidi nan ete, nan semèn nan aswè nan prentan ak otòn. Paj chak sezon bay jou ak lè egzak yo anvan enskripsyon louvri.",
      },
      where: {
        question: "Ki kote nou jwe?",
        answer:
          "Nan McCarren Park nan Brooklyn, sou fwontyè Greenpoint ak Williamsburg. Paj match ou a bay teren ou.",
        more: "Kijan pou rive McCarren Park",
      },
      cost: {
        question: "Konbyen sa koute?",
        answer:
          "Frè a fikse chak sezon e li parèt sou paj sezon an, ak sa li gen ladan l, anvan ou peye anyen. Kèk sezon peye pa jwè, kèk pa ekip. Lè yon ekip pataje frè a, chak jwè peye pa yo sou entènèt.",
      },
      length: {
        question: "Konbyen tan yon match dire?",
        answer:
          "Chak match antre nan yon èdtan, kidonk ou fini a tan pou soupe, oswa pou yon bwason (oswa yon dlo gaz) ak ekip ou.",
      },
      coed: {
        question: "Èske lig la melanje gason ak fanm?",
        answer:
          "Wi. Chak ekip jwe melanje, e lis pou match la swiv règ lig la sou ekilib ant gason ak fanm, kapitèn ou ak abit la veye sa.",
      },
      rain: {
        question: "Kisa k ap pase si lapli tonbe?",
        answer:
          "Yon moun nan lig la ap swiv meteyo a e pran desizyon an, anjeneral jou anvan an. Si match ou anile akoz lapli, paj match ou a ap montre sa, e lè match ranplasman an gen lè, l ap parèt la tou.",
      },
    },
    gameDay: {
      title: "Jou match",
      wear: {
        question: "Kisa pou m mete?",
        answer:
          "Tenis oswa soulye pou gazon, yon bagay nan koulè ekip ou, ak yon ti vès pou match aswè yo. Pote dlo ak krèm solèy nan ete.",
      },
      drink: {
        question: "Èske m oblije bwè?",
        answer:
          "Non. Rete ansanm apre match la fè pati plezi a, men se ou ki deside si se yon bwason oswa yon dlo gaz, e anpil moun pa rete. Bwason tann apre match la, paske alkòl entèdi nan pak vil la.",
      },
      watch: {
        question: "Èske zanmi m ka vin gade?",
        answer:
          "Byen sèten. Se yon pak piblik, e kèk fanatik sou bò teren an pa janm fè pèsonn choute pi mal.",
      },
    },
  },
  schedule: {
    title: "Orè",
    seasonTitle: "Orè {season}",
    divisionTitle: "Orè {division}",
    seasonNav: "Sezon",
    standings: "Klasman",
    playoffs: "Playoff",
    statusLabel: "Sitiyasyon jou match la",
    divisionsNav: "Divizyon",
    allDivisions: "Tout divizyon yo",
    comingSoon: "Talè konsa",
    comingSoonBody:
      "Orè a soti anviwon yon semèn anvan premye jou a. Enskri kounye a, n ap voye yon imèl ba ou lè li pare.",
    team: "Ekip",
    allTeams: "Tout ekip yo",
    show: "Montre",
    teamPage: "Paj ak kalandriye ekip {team}",
    showingTeam: {
      $plural: {
        one: "N ap montre {n} match pou {name}.",
        other: "N ap montre {n} match pou {name}.",
      },
    },
    showingAll: {
      $plural: {
        one: "N ap montre {n} match.",
        other: "N ap montre tout {n} match yo.",
      },
    },
    themeWeek: "Semèn tèm:",
    open: "Lib",
    crossover: "Ant divizyon",
    makeups: "Match ranplasman ki poko gen dat",
    makeupsBody:
      "Match sa yo bezwen yon nouvo dat. Yo ap parèt la a, sou paj ekip yo ak nan kalandriye yo depi lig la fikse youn.",
    kickoff: "Kòmansman",
    fieldTba: "Teren an poko anonse",
    timeTba: "Lè a poko anonse",
  },
  gameStatus: {
    ruling: "Desizyon",
    cancelled: "Anile",
    postponed: "Ranvwaye",
    rainedOut: "Anile akoz lapli",
    final: "Fini",
    forfeit: "Forfè",
    live: "An dirèk",
  },
  gameday: {
    updated: "Mizajou {time}",
    gamesOn: "Match yo ap jwe.",
    watchingDay: "N ap swiv meteyo a: n ap deside anvan {time}.",
    someLate: "Kèk match ap kòmanse an reta.",
    allLate: "Tout match yo ap kòmanse an reta.",
    someOff: "Kèk match anile.",
    allOff: "Tout match yo anile.",
    watchingGame: "N ap swiv meteyo a: desizyon anvan {time}",
    startsLate: "Kòmanse an reta: {time}",
    off: "Anile",
  },
  ruleSet: {
    bestOf: "pi bon nan {n} sèt",
    daylight: "jwèt la fini {minutes} minit anvan solèy kouche",
    innings: { $plural: { one: "{n} manch", other: "{n} manch" } },
    timeLimit: "limit {minutes} minit",
    bunting: "bunt pèmèt",
    noBunting: "pa gen bunt",
    stealing: "vòlè baz pèmèt",
    noStealing: "pa gen vòlè baz",
  },
  home: {
    title: "{site} · Kickball pou granmoun, gason ak fanm ansanm, nan Brooklyn",
    sticker: "McCarren Park, Brooklyn ☀️",
    heroStart: "Choute yon boul. Rankontre nouvo",
    heroSwipe: "moun ou pi renmen yo.",
    intro:
      "Kickball pou granmoun, gason ak fanm ansanm, nan Brooklyn, pou moun ki pa jwe depi rekreyasyon lekòl. Vini ak yon ekip oswa vini pou kont ou, n ap jwenn yon ekip pou ou. Rete apre pou yon bwason (oswa yon dlo gaz).",
    signUp: "Enskri pou yon sezon",
    questions: "Ou gen kesyon? Nou gen repons",
    basics: "Sa pou w konnen",
    facts: {
      what: {
        term: "Kisa",
        detail:
          "Kickball pou granmoun, gason ak fanm ansanm. Match zanmitay, vrè klasman.",
      },
      where: {
        term: "Ki kote",
        detail: "McCarren Park, ant Greenpoint ak Williamsburg.",
        link: "Kijan pou rive",
      },
      when: {
        term: "Ki lè",
        detail:
          "Dimanch apremidi nan ete; nan semèn nan aswè nan prentan ak otòn.",
        link: "Orè ak klasman",
      },
      price: {
        term: "Pri",
        detail:
          "Fikse chak sezon e ou wè l anvan ou peye. Ekip yo ka pataje frè a.",
        link: "Kijan frè yo mache",
      },
    },
    waysIn: "Twa fason pou antre",
    ways: {
      team: {
        title: "Vini ak yon ekip",
        body: "Enskri kòm kapitèn, pataje yon sèl lyen envitasyon nan chat gwoup la, e chak moun enskri e peye pa yo.",
      },
      friend: {
        title: "Antre nan ekip yon zanmi",
        body: "Louvri lyen envitasyon kapitèn ou, siyen dekarg responsablite a, e ou sou lis jwè yo.",
      },
      solo: {
        title: "Vini pou kont ou",
        body: "Enskri kòm jwè lib e n ap mete ou nan yon ekip. Mwatye plezi a se nouvo moun yo.",
        link: "Kijan enskripsyon pou kont ou mache",
      },
    },
    afterTitle: "Match la se mwatye a sèlman",
    afterBody:
      "Ekip yo rete ansanm apre match, chak sezon fini ak playoff, e pifò moun ale ak kèk nouvo zanmi. Pèsonn pa oblije bwè, e pèsonn pa oblije konn jwe kickball byen.",
    aboutLink: "Plis sou lig la",
    photos: "Dènyèman, sou teren an",
    opensPost: "(louvri pòs la sou Instagram)",
    newHere: "Ou nouvo nan kickball, oswa nan Brooklyn?",
    newHereLinks: {
      howToPlay: "Kijan pou jwe kickball",
      elsewhere: "Si ou soti yon lòt kote nan New York",
      solo: "Kijan pou antre san ekip",
    },
    league: {
      description: "{league}: sezon, orè, klasman, ekip ak evènman.",
      intro:
        "Sezon, orè, klasman ak evènman {league}. Enskri ak menm kont ou itilize pou nenpòt lig sou sit sa a.",
      seasons: "Sezon",
      noSeasons: "Orè premye sezon an ap parèt la a depi li pibliye.",
      schedule: "Orè",
      standings: "Klasman",
      more: "Plis nan {league}",
      events: "Evènman",
      sponsors: "Sponsò",
      history: "Istwa lig la",
      records: "Rekò",
    },
  },
  ...pagesHt,
  email: emailHt,
};
