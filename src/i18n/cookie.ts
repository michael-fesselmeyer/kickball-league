/**
 * The signed-in person's language, mirrored in a cookie so the proxy can
 * serve their pages in it without reading the database (ADR 0065). The
 * profile's `language` is the truth, and what emails and push use; the
 * cookie is written whenever that setting is saved or read at sign-in.
 */
export const LANGUAGE_COOKIE = "kb_lang";

/** A year, renewed each time the setting is saved. */
export const LANGUAGE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
