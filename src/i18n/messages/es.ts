import type { Translation } from "../catalog";
import type { EnglishMessages } from "./en";

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
      signIn: "Iniciar sesión",
    },
    theme: {
      toLight: "Cambiar a modo claro",
      toDark: "Cambiar a modo oscuro",
    },
    language: {
      group: "Idioma",
      current: "{language} (actual)",
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
};
