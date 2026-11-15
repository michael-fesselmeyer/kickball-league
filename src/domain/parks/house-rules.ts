/**
 * The house rules a park's page and its printed sign show. They are the same
 * in every park, so the sign at the fence and the page agree.
 */
export const HOUSE_RULES = [
  "Play inside the permit hours, and be off the field when they end.",
  "No alcohol, glass or speakers on the field.",
  "Carry out what you bring, and leave the grass cleaner than you found it.",
  "Share the space: other groups use this park too.",
] as const;

/** Said wherever a permit is shown; every permit is issued by NYC Parks. */
export const PERMIT_ISSUER = "NYC Parks";
