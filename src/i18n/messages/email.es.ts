import type { Translation } from "../catalog";
import type { emailEn } from "./email.en";

/**
 * The emails and push notifications in Spanish (`es.email`). Same rules as
 * the rest of the Spanish catalog: "tú", casual, and the game words in the
 * glossary in docs/i18n.md.
 */
export const emailEs: Translation<typeof emailEn> = {
  layout: {
    because: "Te llegó este correo porque {reason}.",
    settings: "Elige qué correos recibes y cuándo",
    stopAbout: "Dejar de recibir correos sobre {topic}",
    pushBecause: "Porque {reason}.",
    fewer: "¿Prefieres menos correos?",
    turnDown: {
      team: "Solo de mi equipo",
      weekly: "Un resumen semanal",
      snooze: "Pausar por 2 semanas",
    },
  },
  topics: {
    rainout: "suspensiones por lluvia",
    schedule_change: "cambios en el calendario",
    game_reminder: "recordatorios de partidos",
    payment: "pagos e inscripciones",
    sub_request: "pedidos de suplentes",
    announcement: "novedades de la liga",
    score: "marcadores",
    events: "eventos",
    marketing: "novedades y ofertas de la liga",
    new_team: "solicitudes de equipos nuevos",
    discipline: "suspensiones",
    digest: "el resumen",
    operations: "el funcionamiento de la liga",
    photos: "tus fotos",
    team_roles: "capitanes y cocapitanes",
    game_day_watch: "avisos del clima",
    lost_found: "objetos perdidos",
    rules: "reglas y calendario",
  },
  common: {
    seeGame: "Ver el partido",
    seeTeam: "Ver tu equipo",
    seeEvent: "Ver el evento",
    seeOrders: "Ver tus pedidos",
    seeCredit: "Ver tu crédito",
    seeOtherRequests: "Ver otros pedidos",
    openApp: "Abrir la app",
    fromLeague: "De parte de la liga: {text}",
    cardRefund:
      "{returned}. El reembolso a la tarjeta suele aparecer en 5 a 10 días.",
    youPaid: "Pagaste {paid}.",
    nextFee: "Se descuenta solo de tu próxima cuota cuando pagues.",
  },
  announcement: {
    action: "Abrir la app de la liga",
    reasonTeam: "juegas en {team} en {season}",
    reasonLeague: "estás inscrito en {season}",
  },
  awayShort: {
    subject: "A {team} le pueden faltar jugadores la semana del {week}",
    heading: "¿Les faltan jugadores la semana del {week}?",
    lead: "{player} no va a estar esa semana, así que tienes {available} jugadores disponibles para {games}.",
    game: "{when} contra {opponent}",
    and: " y ",
    subsOpen:
      "Pide un suplente ahora y les avisamos a los jugadores que estén libres esa noche.",
    subsClosed:
      "No se pueden pedir suplentes para partidos de playoffs; consulta con la liga.",
    askSub: "Pedir un suplente",
    reason: "eres capitán de {team} en {season}",
  },
  concern: {
    received:
      "{league} recibió tu mensaje. Solo lo leen los administradores de la liga, y uno de ellos te va a responder.",
    followInApp: "Puedes seguirlo en la app.",
    answerByEmail: "Si dejaste un correo, la respuesta llega a este correo.",
    replied: "{league} respondió:",
    closed: "{league} cerró tu mensaje. Esto es lo que se hizo:",
    receivedTitle: "Recibimos tu mensaje",
    replyTitle: "Una respuesta de la liga",
    closedTitle: "Tu mensaje está cerrado",
    reason: "le enviaste un mensaje a la liga",
  },
  digest: {
    updates: {
      $plural: { one: "1 novedad", other: "{n} novedades" },
    },
    subject: "Noticias de la liga: {updates}",
    headingDaily: "Tus noticias de la liga de hoy",
    headingWeekly: "Tus noticias de la liga de esta semana",
    lead: {
      $plural: {
        one: "Aquí tienes la novedad que guardamos para que tu bandeja de entrada esté tranquila.",
        other:
          "Aquí tienes las {n} novedades que guardamos para que tu bandeja de entrada esté tranquila.",
      },
    },
    reasonDaily:
      "elegiste recibir las noticias que pueden esperar en un solo correo diario",
    reasonWeekly:
      "elegiste recibir las noticias que pueden esperar en un solo correo semanal",
    reasonCap: {
      $plural: {
        one: "recibes como máximo {n} correo de la liga al día que puede esperar, y estos llegaron después",
        other:
          "recibes como máximo {n} correos de la liga al día que pueden esperar, y estos llegaron después",
      },
    },
    settings: "Cambia tu límite diario, el resumen o las horas de silencio",
  },
  event: {
    rsvpOn: "Confirma tu asistencia en {site}: {url}",
    announcedSubject: "Nuevo evento: {title}",
    updatedSubject: "Cambios: {title}",
    announcedHeading: "Estás invitado: {title}",
    updatedHeading: "{title} cambió",
    announcedLead: "¡{title} va! {where}.",
    updatedLead: "La liga cambió los detalles de {title}. Ahora es: {where}.",
    postedReason: "la liga publicó un evento para ti",
    spotSubject: "Ya tienes lugar: {title}",
    spotHeading: "Se abrió un lugar para {title}",
    spotLead:
      "Estabas en la lista de espera de {title} ({where}) y ahora tienes lugar.",
    spotDrop:
      "¿Cambiaron tus planes? Libera tu lugar en la página del evento para que lo tome la siguiente persona de la lista.",
    waitlistReason: "te anotaste en la lista de espera de este evento",
    offSubject: "Cancelado: {title}",
    offHeading: "{title} se canceló",
    offLead:
      "La liga canceló {title} ({where}). Lo sentimos. Tu confirmación se borró y no tienes que hacer nada.",
    otherEvents: "Ver otros eventos",
    rsvpReason: "confirmaste tu asistencia a este evento",
  },
  ticket: {
    receiptSubject: "Tu entrada: {title}",
    receiptHeading: "Vas a {title}",
    receiptLead: "Tu entrada para {title} ({where}) está confirmada.",
    code: "Tu código de entrada es {code}. Muéstralo en la puerta.",
    seeTicket: "Ver tu entrada",
    boughtReason: "compraste una entrada",
    refundedSubject: "Reembolsada: {title}",
    refundedHeading: "Tu entrada para {title} fue reembolsada",
    refundedLead:
      "La liga reembolsó tu entrada para {title} ({where}), así que ya no te da acceso.",
    offeredSubject: "Se abrió un lugar: {title}",
    offeredHeading: "Se abrió un lugar para {title}",
    offeredLead:
      "Estabas en la lista de espera de {title} ({where}) y ahora te estamos guardando un lugar.",
    buyBy:
      "Compra tu entrada antes de {expires}. Después pasa a la siguiente persona de la fila.",
    buy: "Compra tu entrada. Después pasa a la siguiente persona de la fila.",
    buyAction: "Comprar tu entrada",
  },
  gameDay: {
    laterTime: "una hora más tarde",
    delayedSubject: "Empieza tarde: {teams}, {day}",
    delayedHeading: "Tu partido ahora empieza a las {time}",
    delayedLead:
      "{teams} del {day} estaba para las {was} y ahora empieza a las {time}.{why}",
    offSubject: "Suspendido: {teams}, {day}",
    offHeading: "Tu partido se suspende",
    offLead:
      "{teams} del {day} a las {was} se suspende.{why} Te avisamos la nueva hora cuando la liga lo reprograme.",
    backSubject: "Se juega: {teams}, {day}",
    backHeading: "Tu partido vuelve a jugarse",
    backLead: "{teams} del {day} vuelve a jugarse a las {was}.{why}",
    playReason: "juegas en {season}",
    watchSubject: "Pendientes del clima: decisión antes de las {time}, {day}",
    watchHeading: "Decidimos antes de las {time}",
    watchLead:
      "La liga está pendiente del clima para {teams} del {day} y decide antes de las {time} si se juega.{why}",
    watchMore:
      "Si tu partido empieza tarde o se suspende, te llega otro mensaje.",
    watchReason: "pediste avisos del clima antes de tus partidos",
  },
  gear: {
    holding: "Tienes {kit}.",
    onItsWay:
      "{kit} va en camino hacia ti: confírmalo en la app cuando lo tengas.",
    with: "{name} tiene {kit} ahora; pídeselo y confírmalo en la app cuando te lo entregue.",
    atHome:
      '{kit} está en {place}; toca "Recogí {kit}" en la app cuando lo tengas.',
    subject: "Lleva {kit} a {place} antes de las {by} el {day}",
    heading: "{kit} para {teams}",
    bring:
      "Llévalo a {place} antes de las {by} el {day}, media hora antes de que empiece {teams}.",
    missing:
      "Si le falta algo al kit, avísalo en la app para que la liga lo reponga.",
    action: "Abrir tu equipo de la liga",
    reason: "vas a llevar equipo de la liga a este partido",
  },
  giveaway: {
    subject: "Ganaste el sorteo de {event}",
    heading: "¡Ganaste!",
    lead: "Salió tu nombre en el sorteo de {event}: {prize}.",
    leadFrom:
      "Salió tu nombre en el sorteo de {event}: {prize}, de parte de {donor}.",
    claim:
      "La página del sorteo dice cómo reclamarlo. El sorteo fue al azar, entre todos los que hicieron check-in.",
    action: "Ver tu premio",
    reason: "participaste en el sorteo de {event}",
  },
  merch: {
    teamColors: "{description}, con los colores de {team}",
    receiptSubject: "Tu pedido: {description}",
    receiptHeading: "Gracias por tu pedido",
    receiptLead: "Recibimos tu pedido de {what}.",
    letYouKnow: "Te avisamos cuando esté listo.",
    reason: "hiciste un pedido en la tienda de la liga",
    readySubject: "Listo: {description}",
    readyHeading: "Tu pedido está listo",
    readyLead:
      "Tu pedido de {what} está listo. La liga te lo entrega en tu próximo partido.",
    refundedSubject: "Reembolsado: {description}",
    refundedHeading: "Tu pedido fue reembolsado",
    refundedLead: "La liga reembolsó tu pedido de {what}.",
  },
  money: {
    warningSubject:
      "{team} todavía debe {balance}: se cobra a tu tarjeta el {on}",
    warningHeading: "Ojo: faltan {balance} de {team}",
    warningLead:
      "A la cuota de {season} de tu equipo todavía le faltan {balance}. Como garantía del equipo, se cobrará ese monto a tu {card} el {on}.",
    warningLeadCharge:
      "A la cuota de {season} de tu equipo todavía le faltan {balance}. Como garantía del equipo, se cobrarán {charge} a tu {card} el {on}: el saldo al precio con tarjeta, que cubre la comisión de la tarjeta.",
    warningMore:
      "Lo que paguen tus compañeros antes se descuenta del cobro. Después les cobras el resto, o quita la tarjeta si prefieres pagar de otra forma.",
    whoPaid: "Ver quién ya pagó",
    guaranteeReason:
      "guardaste una tarjeta como garantía de la cuota de {team}",
    failedSubject: "No pudimos cobrar a tu tarjeta para {team}",
    failedHeading: "Tu tarjeta fue rechazada",
    failedLead:
      "Intentamos cobrar {balance} a tu tarjeta guardada por el resto de la cuota de {season} de {team}, y el banco lo rechazó.",
    failedMore:
      "Tu equipo no está confirmado hasta que se pague la cuota. Paga el saldo desde la página del equipo o guarda otra tarjeta.",
    payBalance: "Pagar el saldo",
    waitlistSubject:
      "Se abrió un lugar para equipos en {season}. Es tuyo hasta {expires}",
    waitlistHeading: "¡Te toca! Se acaba de abrir un lugar",
    waitlistLead:
      "Se abrió un lugar para un equipo en {season} y eres el siguiente en la lista de espera. Te lo guardamos hasta {expires}.",
    waitlistMore:
      "Inscribe a tu equipo antes de esa fecha para tomarlo. Después pasa al siguiente equipo de la fila.",
    registerTeam: "Inscribir a tu equipo",
    waitlistReason: "te anotaste en la lista de espera de {season}",
    referralSubject: "Ganaste {amount} de crédito de la liga",
    referralHeading: "Gracias por traer a un amigo",
    referralLead:
      "Alguien a quien invitaste acaba de pagar {season}, así que tienes {amount} de crédito de la liga en tu cuenta.",
    referralReason: "alguien se inscribió con tu enlace de invitación",
    rebateSubject:
      "{amount} de crédito de la liga por los partidos suspendidos por lluvia",
    rebateHeading: "Te devolvemos parte de tu cuota",
    rebateLead:
      "{team} perdió {lost} de {count} partidos en {season} por el clima y no se pudieron reponer. Tu parte del reembolso, {amount}, ya es crédito de la liga.",
    rebateReason: "pagaste parte de la cuota de {season} de {team}",
  },
  newTeam: {
    approvedSubject: "{team} juega en {season}",
    approvedHeading: "Tu equipo fue aprobado",
    approvedLead:
      "La liga dijo que sí: {team} está listo para {season}, contigo como capitán.",
    approvedMore:
      "Ahora comparte el enlace de invitación del equipo para que se unan tus jugadores, y firma el descargo de responsabilidad. El equipo queda confirmado cuando tenga suficientes jugadores y la cuota esté cubierta.",
    invite: "Invitar a tus jugadores",
    askedReason: "pediste crear {team}",
    declinedSubject: "Sobre tu solicitud para crear {team}",
    declinedHeading: "Tu solicitud de equipo nuevo",
    declinedLead: "La liga no puede agregar a {team} en {season}.",
    declinedMore:
      "Igual puedes unirte a un equipo con una invitación o como agente libre.",
    seeSeason: "Ver tu temporada",
    leftSubject: "{player} va a crear un equipo nuevo",
    leftHeading: "{player} dejó {left}",
    leftLead:
      "La liga aprobó la solicitud de {player} para crear {team} en {season}, así que ya no está en tu lista.",
    leftMore:
      "Si necesitas otro jugador, invita a alguien o pídele un agente libre a la liga.",
    seeRoster: "Ver tu lista",
    captainReason: "eres capitán de {team}",
  },
  payment: {
    today: "hoy",
    tomorrow: "mañana",
    inDays: { $plural: { one: "en {n} día", other: "en {n} días" } },
    subject: "Tu cuota de {season} vence {when}",
    heading: "Tu lugar se paga {when}",
    lead: "La fecha límite de pago de {season} es {deadline}. Paga antes para no perder tu lugar.",
    waiverFirst:
      "Primero firma el descargo de responsabilidad de la temporada; el pago viene justo después.",
    byCard:
      "Con tarjeta tardas un minuto. Si ya le pagaste a tu capitán en efectivo o por Venmo, pídele que lo marque en la app.",
    action: "Pagar ahora",
    reason: "te inscribiste en {season} y todavía no pagaste",
  },
  photo: {
    approvedSubject: "Tu foto quedó seleccionada",
    approvedHeading: "Tu foto ya está publicada",
    approvedLead:
      "¡Gracias por compartirla! La liga aprobó tu foto y ya aparece en {where}. También puede salir en las redes de la liga.",
    deleteAnytime: "Puedes borrarla de tus fotos cuando quieras.",
    seeIt: "Verla en el sitio",
    rejectedSubject: "Sobre la foto que subiste",
    rejectedHeading: "La liga no usó tu foto",
    rejectedLead:
      "Gracias por enviarla. La liga no va a publicar esta, así que se borró del sitio.",
    keepThem:
      "Sigue mandando: las fotos claras y con buena luz de los partidos y eventos tienen más chance.",
    yourPhotos: "Tus fotos",
    reason: "subiste una foto para la liga",
  },
  privateEvent: {
    tournament: "torneo",
    league: "liga privada",
    reason: "le pediste a la liga un {what} para {organization}",
    receivedSubject: "Recibimos tu solicitud de {what}",
    receivedHeading: "Gracias, recibimos tu solicitud",
    receivedLead:
      "La liga tiene tu solicitud de {what} para {organization}. Un administrador va a revisar campos y fechas y te responde, normalmente en una semana.",
    receivedMore: "Puedes ver en qué va cuando quieras.",
    seeRequest: "Ver tu solicitud",
    acceptedSubject: "{season} va",
    acceptedHeading: "Tu {what} está listo",
    acceptedLead:
      "La liga armó {season} para {organization}. Es privado: solo tus equipos pueden unirse y no aparece nada en las páginas públicas de la liga.",
    acceptedMore:
      "Comparte el enlace de invitación con el capitán de cada equipo. Tu página muestra los equipos a medida que se unen, el calendario cuando salga y los resultados.",
    organizerPage: "Abrir tu página de organizador",
    declinedSubject: "Sobre tu solicitud de {what}",
    declinedHeading: "Tu solicitud",
    declinedLead:
      "Esta vez la liga no puede organizar un {what} para {organization}.",
    declinedMore: "Puedes volver a pedirlo para otras fechas.",
    askAgain: "Pedirlo de nuevo",
  },
  rainout: {
    movesSubject: "Suspendido por lluvia: {teams} pasa a {makeup}",
    postponedSubject: "Suspendido por lluvia: {teams} queda aplazado",
    newTimeHeading: "Tu partido tiene nueva hora",
    postponedHeading: "Tu partido quedó aplazado",
    lead: "{teams} ({was}) se suspendió por lluvia.",
    makeup:
      "El partido de reposición es {makeup}. Avísale a tu capitán si no puedes ir.",
    noMakeup:
      "Todavía no tiene hora de reposición. La nueva hora aparece en el calendario en cuanto la liga la fije.",
    action: "Ver el calendario",
    reason: "juegas en este partido de {season}",
  },
  referee: {
    subject: "Se necesita árbitro: {teams}, {when}",
    heading: "¿Puedes arbitrar este partido?",
    dropped: "{teams}, {when}, se quedó sin árbitro.",
    none: "{teams}, {when}, todavía no tiene árbitro.",
    first:
      'El primer árbitro que toque "Lo tomo" se queda con el partido. Si alguien te ganó, la página te lo dice.',
    action: "Lo tomo",
    reason: "arbitras en {season} y a esa hora no juegas ni arbitras",
  },
  ruleChange: {
    subject: "Cambio de reglas desde el {on}: {summary}",
    heading: "Las reglas de la liga cambian",
    effective: "Empieza a valer el {on}.",
    sections: {
      $plural: {
        one: "Sección que cambia: {sections}.",
        other: "Secciones que cambian: {sections}.",
      },
    },
    read: "Lee el texto nuevo en la página de reglas, y pregúntale a tu capitán o a la liga si algo no queda claro.",
    action: "Leer las reglas",
    reason: "juegas en una temporada de la liga",
  },
  scoreConfirm: {
    subject: "Confirma el marcador: {result}",
    heading: "¿Este marcador está bien?",
    lead: "{reportedBy} reportó {result} para {teams} ({when}).",
    more: "Confírmalo, o recházalo si está mal. Si nadie lo rechaza, queda como final a las 24 horas.",
    action: "Confirmar o rechazar",
    reason: "eres capitán de uno de los equipos de este partido",
  },
  scoreReminder: {
    subject: "Falta el marcador: {teams}",
    heading: "¿Cómo quedó el partido?",
    lead: "{teams} ({when}) todavía no tiene marcador.",
    referee:
      "Como árbitro, ingrésalo ahora para que la clasificación se actualice esta noche. Tardas unos segundos.",
    captain:
      "Tu árbitro no lo ingresó. Cualquiera de los capitanes puede hacerlo, y el otro equipo lo confirma.",
    action: "Ingresar el marcador",
    refereeReason: "arbitraste este partido",
    captainReason: "eres capitán de uno de los equipos de este partido",
  },
  seasonCard: {
    subject: "Tu temporada {season} de kickball",
    heading: "Tu temporada de kickball",
    lead: "{season} terminó. Tu tarjeta tiene tus partidos, las carreras y el récord de tu equipo, tus premios y tu mejor partido.",
    private: "Solo tú la puedes ver hasta que decidas compartir su enlace.",
    action: "Ver tu temporada",
    reason: "jugaste en {season}",
  },
  shirt: {
    subject: "Tu talla de camiseta para {season}",
    heading: "¿Qué talla de camiseta usas?",
    lead: "La liga está pidiendo las camisetas de {season} y todavía no tenemos tu talla.",
    pick: "Elígela en tu perfil: {sizes}. Tardas unos segundos.",
    action: "Elegir mi talla",
    reason: "estás inscrito en {season}",
  },
  sub: {
    requestSubject: "{team} necesita {spots}: {when}",
    requestHeading: "{team} necesita un suplente",
    requestLead: "{teams}, {when}. {team} busca {spots}.",
    fromCaptain: "De parte del capitán: {note}",
    hold: 'Toca "Me apunto" para guardar un lugar. El capitán confirma y te avisamos por correo.',
    seeRequests: "Ver pedidos de suplentes",
    freeAgentReason: "eres agente libre en {season} y estás libre a esa hora",
    playerReason: "juegas en {season} y tu equipo no juega a esa hora",
    claimedSubject: "{player} quiere ser suplente: {when}",
    claimedHeading: "{player} puede jugar de suplente",
    claimedLead: "{player} está guardando un lugar para {teams}, {when}.",
    claimedMore:
      "Apruébalo para que sepa que juega, o recházalo para liberar el lugar.",
    approveOrDecline: "Aprobar o rechazar",
    captainReason: "eres capitán de {team}, que pidió suplentes",
    withdrawnSubject: "{player} ya no puede ser suplente: {when}",
    withdrawnHeading: "Un suplente se bajó",
    withdrawnLead:
      "{player} ya no puede jugar en {teams}, {when}. Su lugar vuelve a estar libre.",
    seeYourRequest: "Ver tu pedido",
    approvedSubject: "Juegas de suplente con {team}: {when}",
    approvedHeading: "¡Juegas!",
    approvedLead:
      "El capitán de {team} dijo que sí. Juegas en {teams}, {when}.",
    approvedMore:
      "Si puedes, ponte el color del equipo. Si cambian tus planes, bájate desde la página de suplentes para que busquen a otra persona.",
    seeDetails: "Ver los detalles",
    offeredReason: "te ofreciste como suplente para {team}",
    declinedSubject: "{team} ya está completo: {when}",
    declinedHeading: "Gracias por ofrecerte",
    declinedLead:
      "El capitán de {team} ya tiene lo que necesita para {teams}, {when}. Gracias por dar la mano.",
    cancelledSubject: "{team} ya no necesita suplentes: {when}",
    cancelledHeading: "Pedido retirado",
    cancelledLead:
      "{team} retiró su pedido de suplentes para {teams}, {when}, así que no juegas en ese partido. Gracias por ofrecerte.",
  },
  survey: {
    subject: "¿Qué tal {season}?",
    lead: "Cinco preguntas rápidas sobre la temporada, unos dos minutos. Tus respuestas son anónimas: la liga ve los totales y los comentarios, nunca quién los escribió.",
    action: "Responder la encuesta",
    reason: "jugaste en {season}",
  },
  suspension: {
    subject: "Estás suspendido: {length}",
    heading: "Estás suspendido",
    banned:
      "Después de un reporte de incidente, {league} te prohibió jugar de forma permanente.",
    suspended:
      "Después de un reporte de incidente, {league} te suspendió por {length} en {season}.",
    lastsGames:
      "Se descuenta a medida que los partidos de tu equipo quedan finales, y termina solo cuando se jueguen.",
    lastsSeason: "Termina cuando termina la temporada.",
    lastsPermanent: "Dura hasta que la liga la levante.",
    meaning:
      "Mientras estés suspendido no puedes confirmar que juegas un partido, tomar un lugar de suplente ni entrar a un equipo desde el grupo de agentes libres. Tu capitán ve que estás suspendido, pero no el motivo.",
    appealTo:
      "Para apelar, responde a este correo o escribe a {email} y cuéntale a la liga lo que quieras que sepa.",
    appeal:
      "Para apelar, responde a este correo y cuéntale a la liga lo que quieras que sepa.",
    reason: "la liga te suspendió después de un reporte de incidente",
  },
  teamRole: {
    offeredSubject: "{captain} te pidió ser capitán de {team}",
    offeredHeading: "¿Capitán de {team}?",
    offeredLead:
      "A {captain} le gustaría que tomes su lugar como capitán de {team} en {season}.",
    offeredMore:
      "Nada cambia hasta que digas que sí. Como capitán manejas la lista, las invitaciones, los pagos y los cocapitanes; la otra persona sigue como cocapitán.",
    answer: "Responder en la página de tu equipo",
    playReason: "juegas en {team}",
    acceptedSubject: "{player} ahora es capitán de {team}",
    acceptedHeading: "Tu equipo tiene nuevo capitán",
    acceptedLead:
      "{player} aceptó: desde ahora es capitán de {team} en {season}.",
    acceptedMore:
      "Tú sigues como cocapitán, con las alineaciones, los pedidos de suplentes y los marcadores. El nuevo capitán puede cambiar eso.",
    offeredReason: "le ofreciste la capitanía a {player}",
    declinedSubject: "{player} no va a tomar {team}",
    declinedHeading: "Sigues siendo el capitán",
    declinedLead:
      "{player} dijo que no a ser capitán de {team}, así que sigues como capitán en {season}.",
    declinedMore:
      "Puedes ofrecérsela a otro compañero desde la página de tu equipo.",
    coSubject: "Eres cocapitán de {team}",
    coHeading: "Eres cocapitán",
    coLead:
      "Ahora ayudas a manejar {team} en {season}: armas el orden de pateo, pides suplentes, ingresas y confirmas marcadores y ves quién ya pagó.",
    coMore:
      "Puedes dejar el puesto desde la página de tu equipo cuando quieras.",
    playerSubject: "Ya no eres cocapitán de {team}",
    playerHeading: "De vuelta a jugar",
    playerLead:
      "Ahora estás en {team} en {season} como jugador, sin las herramientas de cocapitán.",
  },
  volunteer: {
    subject: "Mañana: tu turno de {role}",
    heading: "¡Gracias por ser voluntario!",
    lead: "Estás anotado para {role} en {occasion}: {when}.",
    leadAt: "Estás anotado para {role} en {occasion}: {when}, {place}.",
    drop: "¿Al final no puedes ir? Deja el turno en la app para que lo tome otra persona.",
    action: "Ver tus turnos",
    reason: "te anotaste para un turno de voluntario",
  },
  winBack: {
    reason:
      "ya jugaste en la liga y las inscripciones para {season} están abiertas",
  },
};
