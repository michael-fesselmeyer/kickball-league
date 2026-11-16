import type { Translation } from "../catalog";
import type { liveEn } from "./live.en";
import type { pagesEn } from "./pages.en";
import type { shareEn } from "./share.en";

/**
 * The public pages beyond home, FAQ and schedule, in Spanish. "Tú", casual,
 * and the game words in the glossary in docs/i18n.md.
 */
export const pagesEs: Translation<
  typeof pagesEn & { live: typeof liveEn; share: typeof shareEn }
> = {
  about: {
    title: "Sobre la liga",
    description:
      "Una liga social y mixta de kickball para adultos en McCarren Park, Brooklyn. Cómo funciona una temporada, para quién es y lo poco que le pedimos a todos.",
    home: "Inicio",
    crumb: "Quiénes somos",
    sticker: "Diviértete, conoce gente",
    headingStart: "Una liga de kickball para",
    headingSwipe: "conocer gente",
    intro:
      "Somos una liga mixta de kickball para adultos en McCarren Park, Brooklyn. La gente viene por el partido, se queda por los demás y vuelve temporada tras temporada. Lo bastante competitiva para que importe el marcador, y lo bastante relajada para que a nadie le importe si fallas una patada.",
    whoTitle: "Quién juega",
    whoBody:
      "Adultos de 18 años o más de toda la ciudad: recién llegados, viejos amigos, compañeros de trabajo, roommates, gente que solo quiere una excusa para estar al aire libre un domingo. Muchos no juegan kickball desde la escuela, y está bien. No necesitas equipo para unirte: a los agentes libres los ponemos en uno antes de que empiece la temporada.",
    seasonTitle: "Cómo funciona una temporada",
    steps: {
      signUp: {
        title: "Inscríbete",
        body: "Inscribe a un equipo, únete a uno con el enlace de invitación de tu capitán, o ven solo como agente libre. Todos firman el descargo de responsabilidad de la temporada y pagan en línea.",
      },
      schedule: {
        title: "Recibe el calendario",
        body: "El calendario sale más o menos una semana antes del primer día. Cada equipo tiene una mezcla justa de partidos temprano y tarde.",
      },
      play: {
        title: "Juega cada semana",
        body: "Un árbitro por partido, marcadores publicados después de cada partido y una clasificación que se actualiza sola.",
      },
      playoffs: {
        title: "Playoffs",
        body: "La temporada termina con playoffs y un campeón que presume hasta la próxima temporada.",
      },
    },
    houseRulesTitle: "Las reglas de la casa",
    houseRulesIntro:
      "El reglamento cubre el juego. Estas cubren todo lo demás:",
    houseRules: {
      friendly:
        "Buena onda siempre. Aplaude las buenas patadas, también las del otro equipo.",
      refs: "Trata bien a los árbitros. La mayoría también juega en la liga.",
      drink:
        "Nadie tiene que beber. Un agua con gas después del partido cuenta igual.",
      field:
        "Deja el campo mejor de lo que lo encontraste. Es un parque público y somos invitados.",
    },
    questionsTitle: "¿Preguntas?",
    questionsBody:
      "Las preguntas frecuentes cubren las cuotas, las suspensiones por lluvia, qué ponerte y más. Cuando ya estés en un equipo, tu capitán es la forma más rápida de contactar a la liga. Vecinos, personal del parque y visitantes pueden escribirle a la liga sin cuenta.",
    readFaq: "Leer las preguntas frecuentes",
    findFields: "Encontrar los campos",
    contact: "Contactar a la liga",
  },
  park: {
    title: "Kickball en McCarren Park, Brooklyn",
    description:
      "Dónde juega la liga en McCarren Park, entre Greenpoint y Williamsburg: líneas de metro, bicis, qué llevar y cómo encontrar tu campo.",
    home: "Inicio",
    sticker: "Nuestra cancha 🏟️",
    headingStart: "Kickball en",
    intro:
      "Todos los partidos de la liga se juegan en McCarren Park, el gran cuadro verde donde se juntan Greenpoint y Williamsburg, en el norte de Brooklyn. Así se llega y esto es lo que tienes que llevar.",
    whereTitle: "Dónde jugamos",
    fields:
      "El parque tiene varios campos. La página de tu partido dice cuál es el tuyo, así que revísala antes de salir.",
    fieldsToday: "Mira qué equipo tiene cada campo hoy",
    map: "Abrir McCarren Park en un mapa",
    gettingThere: "Cómo llegar",
    ways: {
      g: {
        how: "Tren G",
        detail: "Estación Nassau Av, a una cuadra del lado este del parque.",
      },
      l: {
        how: "Tren L",
        detail:
          "Estación Bedford Av, a unos diez minutos caminando al sur del parque.",
      },
      bike: {
        how: "Bici",
        detail:
          "Hay estaciones de Citi Bike alrededor del parque. Estaciona fuera del campo.",
      },
    },
    bringTitle: "Qué llevar",
    bring: {
      shoes: "Tenis o zapatos para césped",
      color: "Algo del color de tu equipo",
      water: "Agua, y protector solar en verano",
      layer: "Un abrigo ligero para los partidos de noche",
    },
    drinks:
      "Las bebidas esperan hasta después del partido: no se permite alcohol en los parques de la ciudad. Los equipos suelen ir a algún lugar cerca después a tomar algo (o un agua con gas).",
    playTitle: "Juega aquí esta temporada",
    playBody:
      "Trae a tu equipo o ven solo. Los días y horarios están en la página de cada temporada antes de que abran las inscripciones.",
    signUp: "Inscríbete en una temporada",
    readFaq: "Leer las preguntas frecuentes",
    report: "Reportar un problema en el campo",
  },
  stats: {
    outcome: { W: "G", L: "P", T: "E" },
    blurb: {
      top_clash:
        "Dos de los tres primeros del ranking. {a} y {b} definen quién manda de verdad.",
      close_rematch:
        "Su último partido se definió al final. {a} y {b} van por la revancha.",
      evenly_matched:
        "{a} y {b} están parejos en el ranking. Trae una silla plegable.",
      best_available: "El duelo más parejo de la jornada: {a} contra {b}.",
    },
    movementNew: "Nuevo",
    movementNewWords: "Nuevo esta semana",
    movementSame: "Sin cambios",
    movementUp: {
      $plural: { one: "Sube {n} puesto", other: "Sube {n} puestos" },
    },
    movementDown: {
      $plural: { one: "Baja {n} puesto", other: "Baja {n} puestos" },
    },
    onFire: "{name} está en racha: {n} victorias seguidas.",
    wonStraight: "{name} ganó {n} seguidos.",
    droppedRow: "{name} perdió {n} seguidos. Solo queda subir.",
    lostStraight: "{name} perdió {n} seguidos y ya le toca ganar.",
    tiedRow: "{name} empató {n} seguidos. Equilibrio total.",
    firstMeeting: "Primer enfrentamiento",
    seriesTied: "Serie empatada {score}",
    seriesLead: "{team} gana la serie {score}",
    gameOfTheWeek: "Partido de la semana",
    vs: "{a} vs. {b}",
    powerTitle: "Ranking de poder",
    powerEmpty: "El ranking empieza después de la primera jornada.",
    powerIntro:
      "Quién está jugando mejor ahora: récord, los últimos tres partidos, diferencia de carreras y qué tan duros son sus rivales.",
    records: "Récords de la liga",
    numbersTitle: "En números",
    powerRank: "Ranking",
    streak: "Racha",
    bestRun: "Mejor racha",
    rivalries: "Rivalidades",
    headToHead: "Cara a cara",
    seasonStreaks: "Rachas de esta temporada: {list}.",
    teamStreak: "{team} {streak}",
    noneYet: "ninguna todavía",
    tiedScore: "Empate {score}",
    byForfeit: "{team} por abandono",
    wonScore: "{team} {score}",
  },
  standings: {
    title: "Clasificación",
    seasonNav: "Temporada",
    schedule: "Calendario",
    playoffs: "Playoffs",
    noGames:
      "Todavía no se jugó ningún partido. La tabla se llena a medida que llegan los marcadores.",
    noDivision: "Sin división",
    divisionSchedule: "Calendario de {division}",
    caption:
      "Clasificación de {season}: ganados, perdidos, empatados, porcentaje de victorias, {units} y forma reciente",
    divisionCaption:
      "Clasificación de {season}, {division}: ganados, perdidos, empatados, porcentaje de victorias, {units} y forma reciente",
    tiebreakers: "Desempates",
    placedBelow: "{team} quedó debajo del equipo de arriba por {by}.",
    by: {
      head_to_head: "enfrentamiento directo",
      coin_flip: "sorteo con moneda",
    },
    howRanked:
      "Un empate cuenta como media victoria. Los empates en la tabla se definen por enfrentamiento directo, después por {difference}{capped}, después por {allowed} y, al final, con una moneda.",
    capped: " (con un tope de {cap} por partido)",
    diffCapped: ", con un tope de {cap} por partido",
    crossovers:
      "Cada equipo se clasifica dentro de su división, y los partidos contra la otra división cuentan para su récord.",
    divisionOnly:
      "Cada equipo se clasifica dentro de su división solo con sus partidos de división.",
    home: "Inicio",
    team: "Equipo",
    columns: {
      rank: { short: "#", long: "Posición" },
      wins: { short: "G", long: "Ganados" },
      losses: { short: "P", long: "Perdidos" },
      ties: { short: "E", long: "Empatados" },
      pct: {
        short: "PCT",
        long: "Porcentaje de victorias, con el empate como media victoria",
      },
      runsFor: { short: "{letter}F", long: "{Units} a favor" },
      runsAgainst: { short: "{letter}C", long: "{Units} en contra" },
      diff: { short: "DIF", long: "{Difference}" },
      streak: { short: "RACHA", long: "Racha actual" },
      lastFive: {
        short: "Ú5",
        long: "Últimos cinco partidos, del más viejo al más nuevo",
      },
    },
  },
  sports: {
    kickball: {
      one: "carrera",
      many: "carreras",
      letter: "C",
      difference: "diferencia de carreras",
      allowed: "carreras permitidas",
    },
    dodgeball: {
      one: "set",
      many: "sets",
      letter: "S",
      difference: "diferencia de sets",
      allowed: "sets permitidos",
    },
  },
  team: {
    title: "Equipo",
    description:
      "{team}: calendario, resultados, lista de jugadores y calendario para suscribirte.",
    standing: "{record}, {rank} lugar",
    share: "Compartir este equipo",
    shareText: "Calendario, resultados y calendario para suscribirte:",
    seasons: "Temporadas",
    next: "Próximo partido",
    noGames:
      "Todavía no hay partidos en el calendario. Sale más o menos una semana antes del primer día.",
    wrap: "¡Se acabó! No quedan partidos esta temporada. Gracias por jugar.",
    coming: "Lo que viene",
    results: "Resultados",
    noResults:
      "Todavía no hay resultados. El primer lanzamiento es el más difícil.",
    awaiting: "Marcadores por llegar",
    photos: "Fotos",
    calendarTitle: "No te pierdas ningún partido",
    calendarBody:
      "Suscríbete una vez y cada partido aparece en tu calendario, en la zona horaria de la liga. Los cambios y las suspensiones por lluvia se actualizan solos.",
    apple: "Apple u Outlook",
    google: "Google Calendar",
    newTab: " (se abre en una pestaña nueva)",
    paste: "O pega este enlace en cualquier app de calendario",
    roster: "Lista de jugadores",
    rosterEmpty: "La lista se llena a medida que se unen jugadores.",
    captain: "Capitán",
    coCaptain: "Cocapitán",
    awards: "Premios de {season}",
    fullSchedule: "{team} en el calendario completo",
    resultsCaption: "Resultados, del más viejo al más nuevo",
    date: "Fecha",
    opponent: "Rival",
    result: "Resultado",
    score: "Marcador",
    forfeit: "Abandono",
    outcome: { W: "Victoria", L: "Derrota", T: "Empate" },
  },
  game: {
    title: "Partido",
    seasonWhen: "{season}: {when}",
    seasonTba: "{season}: hora por confirmar",
    breadcrumb: "Ruta de navegación",
    vs: "vs.",
    when: "Cuándo",
    tba: "Hora por confirmar",
    offNote:
      "Este partido se suspende. La liga publica la fecha de reposición aquí y en los calendarios cuando la fije.",
    makeupWaiting:
      "Este partido de reposición está esperando un horario libre.",
    where: "Dónde",
    openMaps: "Abrir en Maps",
    newTab: " (se abre en una pestaña nueva)",
    fieldTba: "Campo por confirmar",
    tellChat: "Cuéntaselo al chat del grupo",
    share: "Compartir este partido",
    calendarTitle: "Agrégalo a tu calendario",
    calendarBody:
      "La página de cada equipo tiene un calendario con todos sus partidos, siempre al día.",
    teamGames: "Partidos de {team}",
    winByForfeit: "{team} gana por abandono",
    forecast: "{temperature}°F · {chance}% de probabilidad de lluvia",
    forecastSource:
      "{summary}. Pronóstico del Servicio Meteorológico Nacional (en inglés).",
    noForecast: "Todavía no hay pronóstico",
    noForecastNote: "Los pronósticos llegan hasta una semana antes.",
    shareResult: "{status}: {result}",
    shareOff: "{status}: {matchup} se suspende.",
    shareOffAt: "{status}: {matchup} ({time}) se suspende.",
    shareMakeup:
      "El partido de reposición aparece en el calendario en cuanto la liga lo fije.",
    shareLive: "En vivo ahora: {matchup}",
    shareOn: "Se juega: {matchup}",
  },
  photos: {
    title: "Fotos de los jugadores",
    none: "Todavía no hay fotos.",
    gotOne: "¿Tienes una buena?",
    share: "Compartir una foto",
    alt: "Foto de un jugador de {about}",
  },
  allTime: {
    title: "Histórico",
    record: "Ganados, perdidos, empatados",
    seasons: "Temporadas",
    pct: "% de victorias",
    diff: "Dif. de carreras",
    titles: "Títulos",
    champions: {
      $plural: { one: "Campeones", other: "{n} veces campeones" },
    },
    note: "Partidos de temporada regular de cada temporada que jugó {team}.",
    history: "Historia de la liga",
  },
  awardLabels: {
    season_mvp: "MVP de la temporada",
    iron_kicker: "Pateador de Hierro",
    golden_boot: "Bota de Oro",
    best_teammate: "Mejor Compañero",
    rookie_of_the_year: "Novato del Año",
    sub_of_the_year: "Suplente del Año",
  },
  live: {
    caption: "Carreras por entrada",
    team: "Equipo",
    runs: "Carreras",
    runsShort: "C",
    calledNote:
      "El partido se terminó antes, así que queda como estaba al final de la {nth}. Las carreras después de eso no cuentan.",
    calledAfter: "terminado después de la {nth}",
    finalCalled: "Final, {called}",
    gameOver: "Terminó: esperando confirmación",
    gameOverCalled: "Terminó, {called}: esperando confirmación",
    liveAt: "En vivo: {position}",
    live: "En vivo",
    top: "Alta de la {nth}",
    bottom: "Baja de la {nth}",
    heading: "Entrada por entrada",
    scoredLive:
      "Anotado en vivo, entrada por entrada. ¡Gracias a quien llevó el marcador!",
    unofficial: "No es oficial hasta el final.",
    unofficialMore:
      "El marcador final se reporta después del partido y lo confirman los capitanes.",
  },
  share: {
    whatsapp: "Compartir en WhatsApp",
    opensWhatsapp: " (abre WhatsApp)",
    more: "Más formas de compartir",
    copy: "Copiar el mensaje",
    copied: "Copiado. Pégalo en cualquier chat.",
    manual: "No se pudo copiar aquí. Selecciona el mensaje y cópialo:",
  },
  eventKinds: {
    social: "Social",
    bar_night: "Noche en el bar",
    bbq: "Parrillada",
    tournament: "Torneo",
    theme_week: "Semana temática",
    party: "Fiesta",
  },
  eventCard: {
    calledOff: "Cancelado",
    rsvpOn: "Confirma en {site}",
    going: "{n} van",
    full: "Lleno: lista de espera abierta",
    spotsLeft: {
      $plural: { one: "Queda {n} lugar", other: "Quedan {n} lugares" },
    },
    freeForMembers: "Gratis para miembros, {price} para los demás",
    memberPrice: "{price} ({member} para miembros)",
    tagged: "{kind} · {tag}",
  },
  events: {
    title: "Eventos",
    description:
      "Noches en el bar, parrilladas, torneos y semanas temáticas: el calendario social de la liga, con confirmaciones y calendario para suscribirte.",
    headingStart: "Eventos de la",
    headingSwipe: "liga",
    intro:
      "Los partidos son la excusa; la gente es lo importante. Ven a una noche en el bar, una parrillada, un torneo o una semana temática. Todos los eventos son opcionales, y nunca tienes que beber para sumarte.",
    loading: "Cargando eventos…",
    coming: "Lo que viene",
    empty:
      "No hay nada en el calendario por ahora. Los eventos nuevos aparecen aquí y en el calendario de abajo en cuanto la liga los publica.",
    rsvpStart: "Confirma tu asistencia desde la página del evento cuando",
    signIn: "inicies sesión",
    rsvpEnd:
      ". Si un evento está lleno, puedes anotarte en la lista de espera; te avisamos por correo si se abre un lugar.",
    playerRun: "Organizado por nuestros jugadores",
    moreFriends: "Más amigos de la liga",
    calendarTitle: "Agrega los eventos a tu calendario",
    calendarBody:
      "Suscríbete una vez y los eventos nuevos, los cambios y las cancelaciones aparecen solos, en la zona horaria de la liga.",
    apple: "Apple u Outlook",
    google: "Google Calendar",
    newTab: " (se abre en una pestaña nueva)",
    ics: "Descargar .ics",
    recently: "Recientes",
    anotherSite: " (otro sitio)",
  },
  event: {
    title: "Evento",
    loading: "Cargando el evento…",
    home: "Inicio",
    events: "Eventos",
    breadcrumb: "Ruta de navegación",
    allEvents: "Todos los eventos",
    calledOff: "Cancelado",
    when: "Cuándo",
    where: "Dónde",
    openMaps: "Abrir en Maps",
    newTab: " (se abre en una pestaña nueva)",
    tickets: "Entradas",
    spots: "Lugares",
    noLimit: {
      $plural: {
        one: "Sin límite. Va {n} persona.",
        other: "Sin límite. Van {n} personas.",
      },
    },
    allTaken: "Los {capacity} lugares están ocupados.",
    allTakenWaitlist: {
      $plural: {
        one: "Los {capacity} lugares están ocupados, y hay {n} persona en la lista de espera.",
        other:
          "Los {capacity} lugares están ocupados, y hay {n} personas en la lista de espera.",
      },
    },
    spotsLeft: "Quedan {left} de {capacity} lugares.",
    about: "Sobre este evento",
    themeWeek:
      "Las semanas temáticas son todos los días de partido entre estas fechas, y el calendario las marca.",
    seeSchedule: "Ver el calendario de {season}",
    fullTitle: "Está lleno, pero se abren lugares",
    coming: "¿Vienes?",
    fullTicket:
      "Anótate en la lista de espera y tendrás un día para comprar la próxima entrada que se libere.",
    fullFree:
      "Anótate en la lista de espera y te avisamos por correo si alguien se baja.",
    buy: "Compra tu entrada con tarjeta o con crédito de la liga. Primero inicia sesión.",
    rsvpBody:
      "Confirma para que la liga sepa para cuántos organizar. Puedes cambiar de idea cuando quieras.",
    joinWaitlist: "Anotarme en la lista de espera",
    getTicket: "Conseguir una entrada",
    rsvp: "Confirmar asistencia",
    guestList: "La lista de invitados está en {site}.",
    noRsvp: "No hace falta confirmar. Solo ven.",
    rsvpOn: "Confirma en {site}",
    over: "Este evento ya pasó. ¡Gracias por venir!",
    cancelled: "La liga canceló este evento.",
    elseComing: "Mira qué más viene",
    share: "Compartir este evento",
    saveDate: "Guarda la fecha",
    apple: "Apple u Outlook",
    google: "Google Calendar",
    photos: "Fotos",
    shareCalledOff: "Cancelado: {title} ({when})",
    shareFor: "Para {audience}",
  },
  sponsors: {
    title: "Patrocinadores y el bar de la liga",
    description:
      "Los negocios que apoyan a la liga, adónde va todo el mundo después de los partidos, las ofertas de la semana y el equipo de la semana.",
    headingStart: "Nuestros",
    headingSwipe: "patrocinadores",
    intro:
      "Los lugares del barrio que mantienen viva la liga. Después del último out, todos van al bar de la liga. Haz check-in al llegar y usa una oferta si te sirve. Las ofertas son un extra, nunca una obligación.",
    loading: "Cargando los patrocinadores…",
    kinds: {
      bar: "Bar",
      restaurant: "Restaurante",
      brand: "Marca",
      other: "Patrocinador",
    },
    homeBase: "Nuestro punto de encuentro después de los partidos",
    also: "También apoyan a la liga",
    backing: "Apoyan a la liga",
    deals: {
      $plural: {
        one: "{n} oferta para jugadores",
        other: "{n} ofertas para jugadores",
      },
    },
    onTheWay:
      "Los patrocinadores vienen en camino. ¿Tienes un local cerca del parque?",
    getInTouch: "Escríbenos",
  },
  sponsor: {
    title: "Patrocinador",
    homeBarTitle: "{name}, el bar de la liga",
    description:
      "{name} apoya a la liga. Ofertas para jugadores y cómo hacer check-in.",
    loading: "Cargando el patrocinador…",
    home: "Inicio",
    sponsors: "Patrocinadores",
    homeBar: "El bar de la liga",
    map: "Mapa",
    website: "Sitio web",
    deals: "Ofertas para jugadores",
    checkInTitle: "Haz check-in al llegar",
    stepCode:
      "Busca el código de la liga en la pantalla junto a la puerta o la caja. Cambia cada pocos minutos.",
    stepScan: "Escanéalo con la cámara de tu teléfono y toca Check in.",
    stepDeal:
      "Elige una oferta si quieres y muéstrale la pantalla a quien te atienda.",
    checkInNote:
      "Los check-ins le muestran a {name} cuántos de nosotros pasamos, y así siguen las ofertas. Cuenta uno por día, y nunca tienes que pedir nada.",
  },
  deals: {
    none: "No hay ofertas publicadas por ahora. Ven por la compañía.",
    everyDay: "Todos los días",
    weekdays: "Entre semana",
    weekends: "Fines de semana",
    days: {
      1: "Los lunes",
      2: "Los martes",
      3: "Los miércoles",
      4: "Los jueves",
      5: "Los viernes",
      6: "Los sábados",
      7: "Los domingos",
    },
    between: "{days}, de {from} a {to}",
    midnight: "medianoche",
    noon: "mediodía",
    confirmed: "Confirmada el {date}",
  },
  teamOfWeek: {
    label: "Equipo de la semana · {day}",
    tab: "Tienen una cuenta de {amount} en {sponsor}, invita la casa.",
  },
  help: {
    title: "Centro de ayuda",
    description:
      "Guías cortas para jugadores, capitanes y árbitros: inscribirte, pagar, avisar si vienes, suplentes, orden de pateo, marcadores y más.",
    home: "Inicio",
    headingStart: "¿Cómo",
    headingSwipe: "hago…?",
    introStart:
      "Guías cortas de todo lo que hace la app, según tu rol en la liga. La app todavía está en inglés, así que citamos los botones tal como aparecen en pantalla. ¿Eres nuevo? Las",
    faq: "preguntas frecuentes",
    introMid: "cubren lo básico, y las",
    rules: "reglas de la liga",
    introEnd: "explican cómo jugamos, con qué cambió y cuándo.",
    widgetTitle: "¿Tienes un bar o el sitio de un equipo?",
    widgetBody:
      "Muestra los próximos partidos en tu propio sitio con una línea de HTML.",
    widgetLink: "Obtener el widget del calendario",
    roleTitle: "Ayuda para {role}",
    roleDescription: "{intro} Guías cortas: {list}.",
    onThisPage: "En esta página",
    inApp: "En la app:",
    others: "Ayuda para otros",
    inEnglishTitle: "Administradores y dueños",
    inEnglishBody:
      "Sus guías están en inglés, igual que las pantallas que usan.",
    search: {
      label: "Buscar en el centro de ayuda",
      placeholder: "Prueba con “pagar”, “lluvia” u “orden de pateo”",
      none: "No hay resultados. Prueba con otra palabra, o mira los temas de abajo.",
      found: "{n} guía encontrada.",
      foundMany: "{n} guías encontradas.",
      results: "Resultados de la búsqueda",
    },
  },
};
