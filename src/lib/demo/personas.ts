/**
 * The people a demo visitor can view the league as. Invented names on the
 * reserved example.test domain; the seed creates them (src/seed/demo-personas.ts).
 * A visitor picks one by key: never by id or email, so view-as cannot reach
 * any other account.
 */
export const PERSONAS = {
  player: {
    label: "Player",
    firstName: "Pat",
    lastName: "Player",
    email: "pat.player@example.test",
    landing: "/app",
  },
  captain: {
    label: "Captain",
    firstName: "Casey",
    lastName: "Captain",
    email: "casey.captain@example.test",
    landing: "/app",
  },
  ref: {
    label: "Ref",
    firstName: "Reese",
    lastName: "Ref",
    email: "reese.ref@example.test",
    landing: "/app",
  },
  admin: {
    label: "Admin",
    firstName: "Addie",
    lastName: "Admin",
    email: "addie.admin@example.test",
    landing: "/app/admin/seasons",
  },
} as const;

export type PersonaKey = keyof typeof PERSONAS;

export const PERSONA_KEYS = Object.keys(PERSONAS) as PersonaKey[];

export const PERSONA_EMAILS: readonly string[] = PERSONA_KEYS.map(
  (key) => PERSONAS[key].email,
);

export const isPersonaKey = (value: unknown): value is PersonaKey =>
  typeof value === "string" && Object.hasOwn(PERSONAS, value);
