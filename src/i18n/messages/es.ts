import type { Translation } from "../catalog";
import type { EnglishMessages } from "./en";
import { emailEs } from "./email.es";
import { pagesEs } from "./pages.es";

/**
 * Spanish (ADR 0094). Written without a paid translation service; a
 * native-speaking player reviews it before launch (docs/i18n.md). Use the
 * informal "tú", as the league talks to its players.
 */
export const es: Translation<EnglishMessages> = {
  shell: {
    brand: "Liga de Kickball",
    skipToContent: "Saltar al contenido",
    siteNav: "Sitio",
    header: {
      nav: "Principal",
      schedule: "Calendario",
      standings: "Clasificación",
      events: "Eventos",
      faq: "Preguntas",
      join: "Únete",
      signIn: "Entra o abre la app",
      menu: "Menú",
      close: "Cerrar",
      more: "Más",
    },
    footer: {
      schedules: "Calendarios",
      history: "Historia",
      about: "Quiénes somos",
      events: "Eventos",
      faq: "Preguntas frecuentes",
      contact: "Contacto",
      friends: "Amigos",
      help: "Ayuda",
      park: "McCarren Park",
      rules: "Reglas",
      sponsors: "Patrocinadores",
      signIn: "Entra o abre la app",
    },
    theme: {
      toLight: "Cambiar a modo claro",
      toDark: "Cambiar a modo oscuro",
    },
    language: {
      group: "Idioma",
      current: "{language} (actual)",
      report: "¿Ves una traducción incorrecta o rara? Avísale a la liga",
    },
  },
  profile: {
    language: {
      label: "Idioma",
      hint: "Los correos y las notificaciones llegan en este idioma. Por ahora, las pantallas de la app están en inglés.",
      saved:
        "Guardado. Los correos y las notificaciones llegarán en {language}.",
      save: "Guardar idioma",
    },
  },
  formats: {
    teams: { $plural: { one: "{n} equipo", other: "{n} equipos" } },
    players: { $plural: { one: "{n} jugador", other: "{n} jugadores" } },
  },
  faq: {
    title: "Preguntas frecuentes",
    description:
      "¿Necesitas equipo? ¿Es mixto? ¿Cuánto cuesta, qué te pones y qué pasa si llueve? Respuestas rápidas sobre el kickball para adultos en Brooklyn.",
    home: "Inicio",
    headingStart: "Preguntas,",
    headingSwipe: "respondidas",
    intro:
      "En pocas palabras: es mixto, puedes venir solo y nadie tiene que ser bueno en el kickball.",
    sections: "Secciones de preguntas frecuentes",
    readyTitle: "Cuando quieras",
    readyBody:
      "Inicia sesión con tu correo para inscribir un equipo, unirte a uno o venir solo.",
    signUp: "Inscríbete en una temporada",
    joining: {
      title: "Cómo unirte",
      team: {
        question: "¿Necesito un equipo para unirme?",
        answer:
          "No. Inscríbete como agente libre y la liga te pone en un equipo antes de que empiece la temporada. Muchos vienen solos, y es la manera más rápida de conocer gente.",
      },
      friend: {
        question: "¿Cómo me uno al equipo de un amigo?",
        answer:
          "Pídele a tu capitán el enlace de invitación del equipo. Ábrelo, inicia sesión con tu correo, firma el descargo de responsabilidad y paga tu parte si el equipo divide la cuota. Listo, ya estás en la lista.",
      },
      age: {
        question: "¿Qué edad tengo que tener?",
        answer:
          "Necesitas tener 18 años o más para jugar. Algunos eventos sociales en bares son para mayores de 21, y la página de cada evento lo dice.",
      },
      skill: {
        question: "¿Tengo que ser bueno en el kickball?",
        answer:
          "Para nada. Si te acuerdas del recreo, ya cumples. Los partidos son amistosos, los árbitros explican las jugadas y a nadie le importa si fallas una patada.",
      },
    },
    season: {
      title: "La temporada",
      when: {
        question: "¿Cuándo son los partidos?",
        answer:
          "Depende de la temporada y de los permisos del parque: domingos por la tarde en verano, entre semana por la noche en primavera y otoño. La página de cada temporada muestra el día y los horarios exactos antes de abrir las inscripciones.",
      },
      where: {
        question: "¿Dónde jugamos?",
        answer:
          "En McCarren Park, en Brooklyn, entre Greenpoint y Williamsburg. La página de tu partido dice en qué campo juegas.",
        more: "Cómo llegar a McCarren Park",
      },
      cost: {
        question: "¿Cuánto cuesta?",
        answer:
          "La cuota se fija cada temporada y aparece en la página de la temporada, con lo que incluye, antes de que pagues nada. Algunas temporadas cobran por jugador y otras por equipo. Cuando un equipo divide la cuota, cada jugador paga su parte en línea.",
      },
      length: {
        question: "¿Cuánto dura un partido?",
        answer:
          "Cada partido cabe en una hora, así que terminas a tiempo para cenar, o tomar algo (o un agua con gas) con tu equipo.",
      },
      coed: {
        question: "¿La liga es mixta?",
        answer:
          "Sí. Todos los equipos son mixtos, y las alineaciones siguen la regla de equilibrio de género de la liga, que vigilan tu capitán y el árbitro.",
      },
      rain: {
        question: "¿Qué pasa si llueve?",
        answer:
          "Alguien de la liga revisa el pronóstico y decide, por lo general el día anterior. Si tu partido se suspende por lluvia, la página del partido lo dice, y la nueva fecha aparece ahí en cuanto se fija.",
      },
    },
    gameDay: {
      title: "El día del partido",
      wear: {
        question: "¿Qué me pongo?",
        answer:
          "Tenis o zapatos para césped, algo del color de tu equipo y una capa extra para los partidos de noche. En verano trae agua y protector solar.",
      },
      drink: {
        question: "¿Tengo que beber?",
        answer:
          "Para nada. Quedarse después del partido es parte de la diversión, pero puede ser una bebida o un agua con gas, como prefieras, y mucha gente no se queda. Las bebidas esperan hasta después del partido, porque el alcohol no está permitido en los parques de la ciudad.",
      },
      watch: {
        question: "¿Pueden venir amigos a mirar?",
        answer:
          "Claro. Es un parque público, y unos cuantos fans al costado del campo nunca le hicieron daño a ninguna patada.",
      },
    },
  },
  schedule: {
    title: "Calendario",
    seasonTitle: "Calendario de {season}",
    divisionTitle: "Calendario de {division}",
    namedTitle: "{name}: calendario de {season}",
    thisWeek: "Ir a esta semana",
    seasonNav: "Temporada",
    standings: "Clasificación",
    playoffs: "Playoffs",
    statusLabel: "Estado de la jornada",
    divisionsNav: "Divisiones",
    allDivisions: "Todas las divisiones",
    comingSoon: "Muy pronto",
    comingSoonBody:
      "El calendario sale una semana antes del primer día, más o menos. Inscríbete ahora y te avisamos por correo cuando esté listo.",
    team: "Equipo",
    allTeams: "Todos los equipos",
    show: "Mostrar",
    teamPage: "Página y calendario de {team}",
    showingTeam: {
      $plural: {
        one: "Mostrando {n} partido de {name}.",
        other: "Mostrando {n} partidos de {name}.",
      },
    },
    showingAll: {
      $plural: {
        one: "Mostrando {n} partido.",
        other: "Mostrando los {n} partidos.",
      },
    },
    themeWeek: "Semana temática:",
    open: "Libre",
    crossover: "Entre divisiones",
    makeups: "Partidos por reprogramar",
    makeupsBody:
      "Estos partidos necesitan una nueva fecha. Aparecen aquí, en las páginas de los equipos y en los calendarios en cuanto la liga la fije.",
    kickoff: "Inicio",
    fieldTba: "Campo por confirmar",
    timeTba: "Hora por confirmar",
  },
  gameStatus: {
    cancelled: "Cancelado",
    postponed: "Aplazado",
    rainedOut: "Suspendido por lluvia",
    final: "Final",
    ruling: "Decisión de la liga",
    forfeit: "Por abandono",
    live: "En vivo",
  },
  gameday: {
    updated: "Actualizado {time}",
    gamesOn: "Los partidos se juegan.",
    watchingDay: "Pendientes del clima: decidimos antes de las {time}.",
    someLate: "Algunos partidos empiezan tarde.",
    allLate: "Todos los partidos empiezan tarde.",
    someOff: "Algunos partidos se suspenden.",
    allOff: "Todos los partidos se suspenden.",
    watchingGame: "Pendientes del clima: decisión antes de las {time}",
    startsLate: "Empieza tarde: {time}",
    off: "Suspendido",
  },
  ruleSet: {
    innings: { $plural: { one: "{n} entrada", other: "{n} entradas" } },
    timeLimit: "límite de {minutes} minutos",
    bunting: "se permite el toque",
    noBunting: "sin toques",
    stealing: "se permite robar base",
    noStealing: "sin robo de bases",
    bestOf: "al mejor de {n} sets",
    daylight: "el juego termina {minutes} minutos antes del atardecer",
  },
  home: {
    title: "{site} · Kickball mixto para adultos en Brooklyn",
    sticker: "McCarren Park, Brooklyn ☀️",
    heroStart: "Patea una pelota. Conoce a tu nueva",
    heroSwipe: "gente favorita.",
    intro:
      "Kickball mixto para adultos en Brooklyn, para quienes no juegan desde el recreo. Trae a tu equipo o ven solo y te encontramos uno. Quédate después a tomar algo (o un agua con gas).",
    signUp: "Inscríbete en una temporada",
    questions: "¿Preguntas? Tenemos respuestas",
    basics: "Lo básico",
    facts: {
      what: {
        term: "Qué",
        detail:
          "Kickball mixto para adultos. Partidos amistosos, clasificación de verdad.",
      },
      where: {
        term: "Dónde",
        detail: "McCarren Park, entre Greenpoint y Williamsburg.",
        link: "Cómo llegar",
      },
      when: {
        term: "Cuándo",
        detail:
          "Domingos por la tarde en verano; entre semana por la noche en primavera y otoño.",
        link: "Calendarios y clasificación",
      },
      price: {
        term: "Precio",
        detail:
          "Se fija cada temporada y lo ves antes de pagar. Los equipos pueden dividir la cuota.",
        link: "Cómo funcionan las cuotas",
      },
    },
    waysIn: "Tres maneras de entrar",
    ways: {
      team: {
        title: "Trae a tu equipo",
        body: "Inscríbete como capitán, comparte un enlace de invitación en el chat del grupo y cada quien se inscribe y paga su parte.",
      },
      friend: {
        title: "Únete al equipo de un amigo",
        body: "Abre el enlace de invitación de tu capitán, firma el descargo de responsabilidad y ya estás en la lista.",
      },
      solo: {
        title: "Ven solo",
        body: "Inscríbete como agente libre y te ponemos en un equipo. La mitad de la diversión es conocer gente nueva.",
        link: "Cómo funciona la inscripción individual",
      },
    },
    afterTitle: "El partido es solo la mitad",
    afterBody:
      "Los equipos se quedan juntos después de los partidos, cada temporada termina con playoffs y la mayoría se va con nuevos amigos. Nadie tiene que beber, y nadie tiene que ser bueno en el kickball.",
    aboutLink: "Más sobre la liga",
    photos: "Últimamente, en el campo",
    opensPost: "(abre la publicación en Instagram)",
    newHere: "¿Nuevo en el kickball, o en Brooklyn?",
    newHereLinks: {
      howToPlay: "Cómo se juega al kickball",
      elsewhere: "Si juegas desde otra parte de Nueva York",
      solo: "Cómo unirte sin equipo",
    },
    league: {
      description:
        "{league}: temporadas, calendarios, clasificación, equipos y eventos.",
      intro:
        "Temporadas, calendarios, clasificación y eventos de {league}. Inscríbete con la misma cuenta que usas para cualquier liga de este sitio.",
      seasons: "Temporadas",
      noSeasons:
        "El calendario de la primera temporada aparece aquí cuando se publique.",
      schedule: "Calendario",
      standings: "Clasificación",
      more: "Más de {league}",
      events: "Eventos",
      sponsors: "Patrocinadores",
      history: "Historia de la liga",
      records: "Récords",
    },
  },
  ...pagesEs,
  email: emailEs,
};
