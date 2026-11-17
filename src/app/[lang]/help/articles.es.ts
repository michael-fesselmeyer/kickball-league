import type { HelpArticle, HelpRole } from "./articles";

/**
 * The how-tos for players, captains and refs in Spanish (ADR 0094). Same
 * roles, article ids, step counts and screens as the English ones in
 * ./articles.ts, which a test checks. The app's screens are still in
 * English, so a button's words are quoted as the screen shows them, in
 * English. Admin and owner help stays in English, like their screens.
 */

export type SpanishRole = "player" | "captain" | "ref";

type Words = Pick<HelpArticle, "title" | "summary" | "steps" | "notes"> & {
  screenLabel?: string;
  keywords?: readonly string[];
};

export const HELP_ES: Readonly<
  Record<
    SpanishRole,
    Pick<HelpRole, "title" | "intro"> & {
      articles: Readonly<Record<string, Words>>;
    }
  >
> = {
  player: {
    title: "Jugadores",
    intro: "Unirte a un equipo, pagar, avisar si vienes y tus notificaciones.",
    articles: {
      "sign-up": {
        title: "Inscríbete en una temporada",
        summary:
          "Únete a un equipo con el enlace de invitación de tu capitán, o inscríbete solo como agente libre.",
        steps: [
          "Con equipo: abre el enlace de invitación que compartió tu capitán. Inicia sesión con tu correo, una passkey o Google, y toca para unirte.",
          "Solo: abre la temporada desde la página de inicio, elige unirte como agente libre (free agent) y responde las cinco preguntas para encontrar tu equipo. Con un código de amigos puedes quedar en el mismo equipo con hasta cuatro amigos.",
          "Confirma tu perfil: nombre, talla de camiseta, fecha de nacimiento y un contacto de emergencia.",
          "Lee y firma el descargo de responsabilidad (waiver) de la temporada.",
          "Paga, si tu equipo divide la cuota o si eres agente libre. La página de tu temporada muestra cada paso con una marca cuando está listo.",
        ],
        notes: [
          "Tienes que cumplir la edad mínima de la temporada, que aparece al inscribirte.",
          "A los agentes libres los pone en un equipo la liga, y te avisamos por correo cuando pasa.",
        ],
        screenLabel: "Tu inicio",
        keywords: [
          "inscribirme",
          "registro",
          "unirme",
          "invitación",
          "agente libre",
          "waiver",
          "descargo",
          "cuenta",
        ],
      },
      pay: {
        title: "Paga tu parte",
        summary:
          "Paga tu parte de la cuota del equipo con tarjeta, Apple Pay o Google Pay, con un código promocional o crédito de la liga.",
        steps: [
          "Primero firma el descargo de responsabilidad. El pago se abre cuando está firmado.",
          'Abre la página de tu temporada. El paso "Pay" muestra lo que debes.',
          'Agrega un código promocional si tienes uno. El crédito de la liga se usa solo; desmarca "Use my league credit" para guardarlo.',
          'Toca "Pay securely with Stripe" y termina en la página de Stripe.',
        ],
        notes: [
          "Si tu capitán paga la cuota de todo el equipo, el paso lo dice y no tienes nada que pagar.",
          "¿Le pagaste en efectivo a un compañero? Tu capitán puede registrarlo en la página del equipo.",
          "Si la liga activó el precio con tarjeta, el paso Pay muestra primero el total de cada forma de pago: el precio con tarjeta con su comisión en una línea aparte, una transferencia bancaria si la ofrecen, y el precio más bajo en efectivo, Zelle o cheque, con cómo pagarlos.",
        ],
        screenLabel: "Tu inicio, después tu temporada",
        keywords: [
          "pagar",
          "pago",
          "dinero",
          "cuota",
          "stripe",
          "tarjeta",
          "código promocional",
          "crédito",
          "debo",
        ],
      },
      rsvp: {
        title: "Avisa si vienes (RSVP)",
        summary:
          "Toca In, Maybe u Out en cada partido para que tu capitán sepa quién juega.",
        steps: [
          "Abre la página de tu equipo desde tu inicio.",
          'En cada partido que viene, toca "In" (voy), "Maybe" (quizás) u "Out" (no voy). El que elegiste queda marcado.',
          "Puedes cambiarlo hasta el partido. Tu capitán ve cuántos van y si el equipo puede armar una alineación completa.",
        ],
        notes: [
          '¿No vas a estar unas semanas? Usa "Away some weeks? Mark them" en la página del equipo, y tu capitán lo ve en todos los partidos de esas semanas.',
        ],
        screenLabel: "Tu inicio, después tu equipo",
        keywords: [
          "asistencia",
          "voy",
          "no voy",
          "quizás",
          "ausente",
          "vacaciones",
          "confirmar",
        ],
      },
      subs: {
        title: "Consigue un suplente, o sé uno",
        summary:
          "Avísale a tu capitán que no vas para que pida un suplente, o juega con un equipo al que le faltan jugadores.",
        steps: [
          '¿No puedes ir a un partido? Toca "Out" en la página de tu equipo. Tu capitán le pide suplentes a la liga; no tienes que buscar a nadie.',
          '¿Quieres jugar más? Abre "Sub for a team" desde tu inicio. Ahí publican los equipos a los que les faltan jugadores.',
          'Toca "I\'m in" para guardar un lugar. El capitán confirma, y te llega un correo cuando juegas.',
          '¿Cambiaron tus planes? "Drop out" (o "I can\'t make it" si ya estás confirmado) libera el lugar.',
        ],
        notes: [
          "Para ser suplente tienes que estar inscrito esta temporada con el descargo firmado, y no jugar ni arbitrar a esa hora.",
          "Los avisos de suplentes están activados salvo que los apagues en tu perfil.",
        ],
        screenLabel: "Ser suplente (Sub for a team)",
        keywords: ["suplente", "sustituto", "faltan", "jugar más", "cubrir"],
      },
      install: {
        title: "Instala la app en tu teléfono",
        summary:
          "Agrega la liga a tu pantalla de inicio para que se abra como una app y guarde tu próximo partido para cuando no haya señal.",
        steps: [
          'iPhone: abre el sitio en Safari, toca "Compartir" y después "Agregar a inicio".',
          'Android: en Chrome, abre el menú y toca "Instalar app" (o "Agregar a la pantalla principal"). Capitanes, árbitros y administradores también pueden ver un botón "Install" en su inicio.',
          "Abre la liga desde el ícono nuevo e inicia sesión una vez.",
        ],
        notes: [
          "Tu próximo partido queda guardado en el teléfono, así que se abre en el campo aunque no haya señal.",
          "No hay nada que descargar de una tienda de apps ni nada que pagar.",
        ],
        keywords: [
          "pwa",
          "pantalla de inicio",
          "sin señal",
          "offline",
          "iphone",
          "android",
          "descargar",
          "instalar",
        ],
      },
      alerts: {
        title: "Activa, baja o apaga las notificaciones",
        summary:
          "Elige qué correos y notificaciones recibes, y recibe menos sin perderte tus partidos.",
        steps: [
          "Abre tu perfil desde tu inicio.",
          'En "Email settings", marca los correos que quieres y toca "Save email settings". Los enlaces para iniciar sesión siempre llegan.',
          'En "How often we message you", elige un límite diario, un resumen diario o semanal y horas de silencio.',
          'En "Fewer messages, not none", elige "Only my team" (solo mi equipo), recibe las noticias de la liga en un resumen semanal, o toca "Snooze for 2 weeks" (pausar 2 semanas).',
          'En "Push notifications", marca los temas y toca "Save push settings". Tu navegador te pide permiso para mostrar notificaciones. "Turn off push on this device" las apaga en este teléfono.',
        ],
        notes: [
          'Nunca te pedimos notificaciones en tu primera visita. De vez en cuando aparece una tarjeta que ofrece un aviso justo cuando sirve, como los avisos de lluvia después de confirmar asistencia. Cada tarjeta pregunta una vez, y "No thanks" las aleja por un mes.',
          "Cada correo tiene las mismas opciones al final: solo mi equipo, un resumen semanal, pausar, o dejar de recibir ese tipo de correo.",
          "Las suspensiones por lluvia, los cambios en tus partidos, las fechas límite de pago y tu talla de camiseta siempre llegan. Los cambios de reglas están activados salvo que los apagues.",
          "Los mensajes urgentes, como una suspensión por lluvia el día de tu partido, llegan igual en las horas de silencio, pero sin sonido.",
          'En tu perfil también eliges el idioma ("Language") de tus correos y notificaciones.',
        ],
        screenLabel: "Tu perfil",
        keywords: [
          "notificaciones",
          "avisos",
          "correo",
          "push",
          "horas de silencio",
          "resumen",
          "darme de baja",
          "idioma",
        ],
      },
      "raise-concern": {
        title: "Plantea una inquietud a la liga",
        summary:
          "Cuéntale a la liga en privado sobre un partido, un equipo o cómo te trataron.",
        steps: [
          'Desde tu inicio, toca "Raise a concern".',
          "Elige de qué se trata, agrega el enlace al partido si hay uno y cuenta qué pasó.",
          'Toca "Send to the league". Te llega un correo confirmando que llegó.',
          'Sigue la respuesta en "Your concerns". Te llega un correo cuando la liga responde y cuando cierra el tema, con lo que se hizo.',
        ],
        notes: [
          "Solo lo leen los administradores de la liga. Nunca se lo muestran al otro equipo, a tu capitán ni a nadie fuera de la liga.",
          "Si hay una emergencia en el campo, primero llama al 911.",
        ],
        screenLabel: "Plantear una inquietud (Raise a concern)",
        keywords: [
          "queja",
          "reporte",
          "seguridad",
          "trato",
          "privado",
          "contacto",
        ],
      },
      conduct: {
        title: "Lee el código de conducta",
        summary:
          "El código de la liga cubre el juego, el parque, el alcohol y el ruido, y la conducta en línea.",
        steps: [
          'Lee el código en la página pública de reglas de la liga, en "Code of conduct".',
          "Cuando firmas el descargo de responsabilidad de la temporada, el código aparece arriba de la casilla y la marcas para aceptarlo.",
          "Aceptas cada versión una sola vez. Si la liga publica una nueva, la aceptas en tu próxima inscripción.",
        ],
        notes: [
          "Unirte a un equipo, unirte con el enlace de un equipo y unirte como agente libre pasan por el mismo paso del descargo.",
        ],
        screenLabel: "Tu inicio, después firma el descargo",
        keywords: [
          "reglas",
          "comportamiento",
          "parque",
          "alcohol",
          "vidrio",
          "aceptar",
        ],
      },
      "contact-league": {
        title: "Contacta a la liga",
        summary:
          "Haz una pregunta o reporta un problema en el campo. No necesitas cuenta.",
        steps: [
          'Abre "Contact the league" desde la página Quiénes somos o la del parque.',
          'Elige de qué se trata: "A question" (una pregunta), "A problem at the field" (un problema en el campo), "Something about how the park is used" (algo sobre el uso del parque) o "Something else" (otra cosa).',
          "Agrega la fecha y el campo si los sabes, y escribe tu mensaje. Por favor no incluyas enlaces.",
          'Agrega tu correo si quieres respuesta y toca "Send to the league".',
        ],
        notes: [
          "Solo lo leen los administradores de la liga, y tu correo se guarda un año después de que cierran tu mensaje.",
          '¿Iniciaste sesión y es sobre un partido o una persona? Usa "Raise a concern".',
          "Si es una emergencia, primero llama al 911.",
        ],
        keywords: [
          "pregunta",
          "reglas del parque",
          "problema",
          "escribir a la liga",
          "contacto",
        ],
      },
      "check-in": {
        title: "Haz check-in en el partido",
        summary:
          "Escanea el código en el teléfono de tu capitán o del árbitro para que la liga sepa que jugaste.",
        steps: [
          "En el campo, pídele a tu capitán o al árbitro que te muestre el código de check-in del partido.",
          "Escanéalo con la cámara de tu teléfono e inicia sesión si te lo pide.",
          'Toca "Check in". Vas a ver "You\'re checked in".',
        ],
        notes: [
          "El código cambia cada pocos minutos, así que uno de una foto no funciona. Escanea el que está en pantalla.",
          "¿Te dice que no estás en la lista? Pídele a un capitán que te agregue o que apruebe tu lugar de suplente, y vuelve a escanear.",
          "¿Se cerró el check-in o te lo perdiste? Pídele a tu capitán que te marque. Cuenta para tus partidos jugados.",
        ],
        keywords: ["qr", "escanear", "asistencia", "partidos jugados", "jugué"],
      },
      "email-choices": {
        title: "Elige qué correos recibes",
        summary:
          "Las noticias de la liga son opcionales. Elige tus correos, pon un límite diario y date de baja con un toque.",
        steps: [
          "Abre tu perfil y busca la configuración de correos.",
          'Marca los correos que quieres, como "Announcements from admins and captains". Los enlaces para iniciar sesión siempre llegan.',
          "Pon un límite diario para noticias y recordatorios, y guárdalos durante la noche si quieres.",
          'Toca "Save email settings".',
        ],
        notes: [
          "Una cuenta nueva empieza con las noticias de la liga apagadas, así que márcalas si las quieres.",
          "Cada correo tiene un enlace para darte de baja de su tema. Un toque y se acaba.",
          "Lo urgente, como una suspensión por lluvia o una fecha límite de pago, llega igual al instante.",
        ],
        screenLabel: "Tu perfil",
        keywords: [
          "darme de baja",
          "boletín",
          "noticias",
          "correo",
          "resumen",
          "horas de silencio",
        ],
      },
      "season-card": {
        title: "Tu tarjeta de la temporada",
        summary:
          "Cuando termina una temporada recibes una tarjeta con tus partidos, la temporada de tu equipo y tus premios. Compártela si quieres.",
        steps: [
          'Abre el mensaje que dice que tu tarjeta está lista, o busca "Your season in kickball" en la app.',
          "Revísala. Al principio solo tú la puedes ver.",
          'Para compartirla, toca "Make my card\'s link public" y compártela o cópiala para WhatsApp.',
          '¿Cambiaste de idea? Toca "Make my card private". El enlace y su imagen dejan de funcionar.',
        ],
        notes: ["En tu tarjeta no aparece el nombre de ningún otro jugador."],
        screenLabel: "Tu inicio",
        keywords: [
          "fin de temporada",
          "resumen",
          "estadísticas",
          "compartir",
          "premios",
        ],
      },
      "who-has-field": {
        title: "Mira quién tiene un campo",
        summary:
          "Cada parque tiene una página pública que muestra qué campos tiene la liga y a qué hora.",
        steps: [
          "Abre la página del parque desde el sitio de la liga.",
          'En "Fields and hours", mira cada campo que la liga tiene con permiso para los próximos días, con su número de permiso y su horario.',
          "Una línea para hoy dice si la liga tiene un campo en este momento.",
          'Lee las "House rules" antes de armar.',
        ],
        notes: [
          '¿Hay alguien más en un campo que tenemos? Sé amable, muéstrale el número de permiso y avísale a la liga con "Contact the league".',
        ],
        keywords: [
          "permiso",
          "parque",
          "campo",
          "hay alguien en nuestro campo",
          "nyc parks",
        ],
      },
      "change-team": {
        title: "Busca un equipo nuevo, sin que nadie se entere",
        summary:
          "¿Te gustaría cambiar de equipo la próxima temporada? Dilo en privado. Tu equipo actual nunca lo ve.",
        steps: [
          'Abre tu perfil y toca "Looking for a change".',
          "Elige quién lo ve: los capitanes que buscan jugadores para la próxima temporada, los administradores de la liga, o ambos. Agrega una nota corta si quieres, como una noche que te quede bien. No tienes que dar una razón.",
          'Toca "I\'m open to a new team". Tu capitán, tus cocapitanes y tus compañeros actuales nunca lo ven, y no aparece en nada público.',
          'Los equipos que buscan jugadores solo ven cuántos están disponibles. Cuando uno te invita, te llega un correo: toca "Yes, share my name and email" o "No thanks". Un no no se le cuenta a nadie.',
          'Se borra solo cuando cierran las inscripciones de la próxima temporada. "Take it back" lo quita, con sus invitaciones, cuando quieras.',
        ],
        screenLabel: "Buscar un cambio (Looking for a change)",
        keywords: [
          "cambiar de equipo",
          "equipo nuevo",
          "transferir",
          "mudarme",
          "cambio",
        ],
      },
      "leadership-check-in": {
        title: "La consulta de liderazgo al final de la temporada",
        summary:
          "Di en privado quién te gustaría que liderara la próxima temporada; solo hay votación secreta si participa suficiente gente.",
        steps: [
          'Cuando termina la temporada, la página de tu equipo muestra "Leadership check-in". Ábrela.',
          'Marca "I\'d like to help as a co-captain" (quiero ayudar como cocapitán) o "I\'d like to captain next season" (quiero ser capitán), sugiere a un compañero, o deja todo en blanco para decir que todo está bien. Toca "Check in". Es una sola vez y nadie ve tu respuesta.',
          "¿Te sugirió un compañero? En un día te preguntan si quieres postularte. Decir que no está bien, y nunca te dicen quién te sugirió.",
          'Si suficientes jugadores de la lista participaron y alguien se postula para capitán, se abre una votación secreta. Elige a uno y toca "Cast my secret vote".',
          "Tu capitán se entera del resultado primero; el equipo, unos días después. Para un cambio hace falta más de la mitad de los votos.",
        ],
        notes: [
          "Nadie ve cómo votó cada uno ni quién sugirió a quién: ni el capitán, ni los compañeros, ni la liga.",
          "Los capitanes igual pueden pasar el equipo cuando quieran desde la página del equipo.",
        ],
        screenLabel: "Tu inicio, después tu equipo",
        keywords: [
          "capitán",
          "votar",
          "votación",
          "elección",
          "cocapitán",
          "nominar",
        ],
      },
    },
  },
  captain: {
    title: "Capitanes",
    intro:
      "Manejar tu equipo: la lista, el orden de pateo, los marcadores y la ayuda.",
    articles: {
      invite: {
        title: "Invita jugadores",
        summary:
          "Comparte un enlace de invitación en el chat del equipo; cada jugador se une, firma el descargo y paga su parte.",
        steps: [
          'Abre la página de tu equipo. En "Invite players", toca "Make an invite link" y después "Copy link" o "Share on WhatsApp".',
          "Compártelo en el chat del equipo. Cada jugador inicia sesión, se une, firma el descargo y, si dividen la cuota, paga su parte.",
          "Mira cómo se llena la lista: quién se unió, firmó el descargo y pagó.",
          "¿Un compañero te pagó en efectivo o por otra app? Regístralo junto a su nombre.",
        ],
        notes: [
          "Si haces un enlace nuevo, el anterior deja de funcionar.",
          '¿Necesitas que alguien no entre a tu equipo? Agrégalo a la lista privada "Not on my team" en la misma página.',
        ],
        keywords: [
          "lista",
          "enlace de invitación",
          "agregar jugadores",
          "whatsapp",
          "invitar",
        ],
      },
      lineup: {
        title: "Arma el orden de pateo",
        summary:
          "Arma el orden con los jugadores que dijeron que van, con la regla de dos seguidos revisada sobre la marcha.",
        steps: [
          'En la página de tu equipo, toca "Set kicking order" en un partido que todavía no se jugó.',
          "El armador muestra quién va, después los suplentes aprobados, con el lado al que cuenta cada uno.",
          "Arrastra una fila por su agarre, o usa los botones de subir y bajar. Con teclado, toma una fila con Espacio y muévela con las flechas.",
          'Si algo rompe la regla de dos seguidos, te lo dice al momento. "Auto-arrange" arregla el orden con los menos cambios posibles; "Copy last game" empieza desde tu último orden guardado.',
          "Guarda. Cada jugador ve su lugar en la página del equipo, y el día del partido el árbitro y el otro capitán ven el orden.",
        ],
        keywords: [
          "orden de bateo",
          "alineación",
          "orden",
          "regla de género",
          "pateo",
        ],
      },
      scores: {
        title: "Ingresa y confirma marcadores",
        summary:
          "Reporta el marcador final y el otro lado lo confirma; si hay desacuerdo, decide la liga.",
        steps: [
          'Después del inicio, abre el partido desde tu inicio y toca "Score". Sin árbitro, también puedes anotarlo en vivo, media entrada por media entrada.',
          "Ingresa los dos marcadores y si se jugó completo o se terminó antes, y guarda.",
          'El capitán del otro equipo (o cualquiera de los dos, si reportó el árbitro) toca "Confirm" o "Dispute" con una nota.',
          "Un marcador confirmado queda final al instante. Sin respuesta, queda final en la fecha que se muestra, salvo que alguien lo rechace.",
        ],
        notes: [
          "¿Sin señal en el campo? El marcador se guarda en el teléfono y se envía cuando vuelvas a tener señal.",
          "Cuando queda final, puedes calificar la deportividad del otro equipo.",
        ],
        keywords: [
          "marcador",
          "resultado",
          "confirmar",
          "rechazar",
          "disputa",
          "final",
        ],
      },
      "co-captains": {
        title: "Cocapitanes y pasar el equipo",
        summary:
          "Comparte las herramientas del equipo con cocapitanes, o pásale la capitanía a un compañero.",
        steps: [
          'En la página de tu equipo, abre "Captain and co-captains".',
          '"Make co-captain" le da a un compañero las herramientas del equipo: orden de pateo, pedidos de suplentes, marcadores, pagos y la lista privada. "Make a player" se las quita.',
          'Para pasar el equipo, elige a un compañero y toca "Offer the captaincy". Puedes retirarlo hasta que responda.',
          'Cuando toque "Become captain", pasa a liderar el equipo y tú sigues como cocapitán, puesto que puedes dejar.',
        ],
        notes: ["Cada cambio le llega por correo al compañero."],
        keywords: ["cocapitán", "pasar", "transferir", "capitanía"],
      },
      "find-subs": {
        title: "Pide suplentes",
        summary:
          "¿Les faltan jugadores para un partido? Publica un pedido de suplentes y aprueba a quien lo tome.",
        steps: [
          'En la página de tu equipo, toca "Find subs" (o "Short? Find subs" en un partido).',
          "Elige el partido, cuántos necesitas y, si importa, cuántos tienen que ser mujeres u hombres. Agrega una nota.",
          'Les llega un correo a los jugadores que pueden, primero a los agentes libres. Cuando alguien toca "I\'m in", te llega un correo.',
          "Aprueba o rechaza cada oferta. El pedido se cierra a la hora del partido.",
        ],
        notes: ["No se pueden pedir suplentes para partidos de playoffs."],
        keywords: ["suplente", "sustituto", "faltan", "cubrir"],
      },
      "game-day-checklist": {
        title: "Lista del día de partido",
        summary:
          "Marca la lista de antes y después del partido de la liga para tu equipo, aunque no haya señal.",
        steps: [
          "El día del partido, abre la lista desde tu partido. Se abre ese día.",
          "Marca cada punto antes de jugar el partido de tu equipo.",
          "Marca los puntos de después cuando terminen.",
          'Si tu partido es el último en el campo, confirma "Field left clean" (campo limpio) o anota lo que viste. La foto es opcional.',
        ],
        notes: [
          "Tus marcas se guardan en el teléfono y se envían cuando vuelves a tener señal.",
          "La liga escribe la lista cada temporada, así que puede cambiar.",
        ],
        screenLabel: "Tu inicio",
        keywords: [
          "lista",
          "checklist",
          "antes del partido",
          "campo limpio",
          "sin señal",
        ],
      },
      "check-in-players": {
        title: "Haz el check-in de tus jugadores",
        summary:
          "Muestra el código del partido, que cambia solo, para que lo escaneen, o márcalos tú.",
        steps: [
          "En el partido, abre su pantalla de check-in y muestra el código para que lo escaneen tus jugadores.",
          'Cada jugador lo escanea y toca "Check in".',
          "Fíjate en la pantalla si alguien hizo check-in sin el descargo firmado.",
          "¿Faltó alguien? Márcalo a mano, en el campo o hasta una semana después.",
        ],
        notes: [
          "Los suplentes aprobados también cuentan.",
          "La página de tu equipo muestra la asistencia y los partidos jugados de cada uno. Algunas temporadas piden un mínimo para los playoffs.",
        ],
        screenLabel: "Tu inicio, después el partido",
        keywords: ["check-in", "asistencia", "qr", "partidos jugados"],
      },
      "injury-report": {
        title: "Reporta una lesión",
        summary:
          "Envía un reporte corto y privado si alguien se lastima en tu partido.",
        steps: [
          "Si es grave, primero llama al 911.",
          'En la página del partido, toca "Someone was hurt? Report an injury".',
          "Elige quién se lastimó, dónde y qué atención necesitó.",
          "Cuenta qué pasó: cuándo, cómo y qué se hizo. Deja afuera lo que no haga falta.",
          'Toca "Send the report".',
        ],
        notes: [
          "Solo lo pueden leer los dueños y administradores de la liga. A la liga le llega un correo avisando que hay un reporte, sin detalles.",
          "El partido tiene que haber empezado para poder enviarlo.",
        ],
        keywords: ["lesión", "lastimado", "herido", "accidente", "reporte"],
      },
      recruit: {
        title: "Invita a jugadores que buscan un cambio",
        summary:
          "Mientras están abiertas las inscripciones de la próxima temporada, invita a jugadores dispuestos a cambiar de equipo.",
        steps: [
          'En la página de tu equipo para la próxima temporada, busca "Players looking for a change". Muestra cuántos jugadores están disponibles y todavía no recibieron tu invitación.',
          'Agrega un mensaje corto si quieres (tu noche, tu onda) y toca "Invite" (dice a cuántos). Todos reciben las mismas palabras, y nunca ves quiénes son.',
          'Un jugador que dice que sí aparece en "Said yes" con su nombre, correo y nota, y te llega un correo. Mándale el enlace de tu equipo.',
        ],
        notes: [
          "Un jugador que dice que no, o no responde, sigue siendo anónimo. La cuenta nunca incluye a nadie que haya jugado en tu equipo.",
        ],
        keywords: [
          "reclutar",
          "jugadores nuevos",
          "invitar",
          "cambio de equipo",
        ],
      },
    },
  },
  ref: {
    title: "Árbitros",
    intro:
      "Tus partidos, el marcador en vivo en el campo y reportar lo que pasó.",
    articles: {
      "game-day": {
        title: "Día de partido",
        summary:
          "Haz check-in en el campo, mira los dos órdenes de pateo y abre la pantalla del marcador.",
        steps: [
          'Tu inicio muestra "Games you\'re refereeing" con la hora, el campo y los suplentes aprobados de cada equipo.',
          'En el campo, toca "I\'m at the field" para que la liga sepa que llegaste.',
          '"Kicking orders" muestra el orden de los dos equipos el día del partido, y si cada uno cumple la regla.',
          'Desde el inicio del partido, "Score" abre la pantalla del marcador. El permiso del parque y los contactos de emergencia de todos están a un toque el día del partido.',
        ],
        notes: [
          "Instala la app para que tu próximo partido se abra aunque no haya señal.",
        ],
        screenLabel: "Tu inicio",
        keywords: [
          "árbitro",
          "check-in",
          "asignación",
          "permiso",
          "emergencia",
        ],
      },
      "live-scoring": {
        title: "Marcador en vivo",
        summary:
          "Toca las carreras después de cada media entrada; la página pública del partido se actualiza sola.",
        steps: [
          "En la pantalla del marcador, abre el marcador en vivo y elige quién patea primero.",
          'Toca "First pitch" cuando empieza el juego. El reloj cuenta hacia atrás hasta la hora en que el juego debe terminar: el atardecer menos un margen, o la hora en que hay que dejar el campo, lo que llegue primero. Si se empezó tarde, di qué equipo lo demoró.',
          "Después de cada media entrada, toca sus carreras (de 0 a 7, o escribe un número). Corrige cualquier media entrada cambiando sus carreras, o deshaz la última.",
          'Toca "End the game", revisa el marcador que te muestra y luego toca "Game over" para reportar todas las carreras, o "Called after the" y la entrada para reportar el marcador al final de la última entrada completa (mínimo la 4.ª). Si se acaba el tiempo, elige como motivo la luz del día o el horario del campo. "Not yet, keep scoring" te devuelve al juego.',
          "Cualquiera de los dos queda como marcador reportado, y los capitanes lo confirman.",
        ],
        notes: [
          "¿Sin señal? Las carreras se guardan en el teléfono y se envían cuando vuelvas a tener señal, y el reloj sigue corriendo.",
          "La página pública del partido muestra el marcador por entradas en unos 15 segundos.",
          "El reloj cuenta desde la hora programada y avisa cuándo ya no se puede empezar una entrada nueva cerca del límite de tiempo.",
          'Para expulsar a un jugador, usa "Eject a player" debajo del marcador. Envía el reporte a la liga y lo saca del orden de pateo de su equipo por el resto del partido.',
        ],
        keywords: [
          "marcador",
          "entradas",
          "carreras",
          "partido terminado antes",
          "sin señal",
        ],
      },
      incidents: {
        title: "Reporta un incidente",
        summary:
          "Avísale a la liga de una expulsión, un problema de seguridad o cualquier otra cosa, desde el inicio del partido.",
        steps: [
          "Desde la pantalla del marcador, sigue el enlace para reportar un incidente.",
          "Elige el tipo: expulsión, relacionado con un abandono, conducta antideportiva, alcohol traído de afuera en el bar patrocinador, seguridad u otro.",
          "Marca a las personas involucradas de cualquiera de los dos equipos y cuenta qué pasó.",
          "Envíalo. Los administradores revisan cada reporte y deciden si hay alguna suspensión.",
        ],
        notes: [
          "Cualquiera de los capitanes y los administradores también pueden reportar uno.",
        ],
        keywords: [
          "expulsión",
          "seguridad",
          "conducta",
          "suspensión",
          "reporte",
        ],
      },
      "ref-pool": {
        title: "Toma un partido del grupo de árbitros",
        summary:
          "Di cuándo puedes arbitrar, toma partidos que necesitan árbitro y suelta uno si cambian tus planes.",
        steps: [
          'Abre "Your games and pay". En "When can you ref?", marca los horarios en que puedes trabajar y toca "Save when I can ref".',
          "Cuando un partido no tiene árbitro, la liga le avisa al grupo. Abre el enlace y toma el partido. El primer árbitro que lo toma se queda con él.",
          "Tus partidos aparecen en tu inicio con su pago.",
          '¿No puedes ir a uno? Toca "Drop this game" antes de que empiece y di por qué. Los administradores ven el motivo.',
        ],
        notes: [
          "No puedes tomar un partido de tu propio equipo, ni uno a la misma hora que un partido que juegas o arbitras.",
          "¿El partido ya empezó? Avísale a un administrador en vez de soltarlo.",
          "¿No estás en el grupo? Pídele a un administrador que te agregue.",
        ],
        screenLabel: "Tus partidos y pagos",
        keywords: [
          "árbitro",
          "arbitrar",
          "disponibilidad",
          "pago",
          "tomar partido",
        ],
      },
      injury: {
        title: "Reporta una lesión",
        summary:
          "Si alguien se lastima, primero busca ayuda y después envía un reporte corto y privado.",
        steps: [
          "Si es grave, primero llama al 911. Atiende al jugador.",
          'Abre el partido y toca "Someone was hurt? Report an injury".',
          "Elige de las listas quién se lastimó, dónde y qué atención necesitó.",
          'Cuenta qué pasó y quién lo vio, y toca "Send the report".',
        ],
        notes: [
          "Solo los dueños y administradores de la liga leen el reporte. Los jugadores, los capitanes y el otro equipo nunca lo ven.",
          "Los capitanes y los administradores también pueden enviar uno.",
        ],
        keywords: ["lesión", "lastimado", "herido", "accidente", "reporte"],
      },
      "permit-layout": {
        title: "Encuentra el permiso y el plano del campo",
        summary:
          "Mira qué campos tenemos y hasta dónde llega el área con permiso, aunque no haya señal.",
        steps: [
          "Abre tu partido el día del partido y toca el permiso del parque.",
          'Usa "Open the layout (PDF)" para ver dónde termina el área con permiso y dónde van los diamantes.',
          "Úsalo para armar, o para mostrarle a otra persona en el campo lo que tenemos.",
        ],
        notes: [
          "Se guarda en tu teléfono con tu próximo partido, así que se abre sin señal.",
          "¿No hay plano? La pantalla lo dice. Pídele a un administrador que lo agregue.",
          "Si un partido se va a pasar del horario del permiso del campo, tú y los capitanes reciben un aviso antes de que empiece.",
        ],
        screenLabel: "Tus partidos",
        keywords: ["permiso", "plano", "pdf", "campo", "diamante"],
      },
    },
  },
};
