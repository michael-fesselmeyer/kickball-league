import type { HelpArticle, HelpRole } from "./articles";

/**
 * The how-tos for players, captains and refs in Spanish (ADR 0065). Same
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
        title: "Activa o apaga las notificaciones",
        summary:
          "Elige qué correos y notificaciones recibes, y cuándo llegan las que no son urgentes.",
        steps: [
          "Abre tu perfil desde tu inicio.",
          'En "Email settings", marca los correos que quieres y toca "Save email settings". Los enlaces para iniciar sesión siempre llegan.',
          'En "Push notifications", marca los temas y toca "Save push settings". Tu navegador te pide permiso para mostrar notificaciones. "Turn off push on this device" las apaga en este teléfono.',
          'En "How often we message you", elige un límite diario, un resumen diario o semanal y horas de silencio.',
        ],
        notes: [
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
          "Después de cada media entrada, toca sus carreras (de 0 a 7, o escribe un número). Corrige cualquier media entrada cambiando sus carreras, o deshaz la última.",
          'Termina con "Game over" para reportar todas las carreras, o con "Called after the" y la entrada para reportar el marcador al final de la última entrada completa (mínimo la 4.ª).',
          "Cualquiera de los dos queda como marcador reportado, y los capitanes lo confirman.",
        ],
        notes: [
          "¿Sin señal? Las carreras se guardan en el teléfono y se envían cuando vuelvas a tener señal.",
          "La página pública del partido muestra el marcador por entradas en unos 15 segundos.",
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
    },
  },
};
