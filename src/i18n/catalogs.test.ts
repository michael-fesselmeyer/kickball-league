import { describe, expect, it } from "vitest";
import {
  fill,
  keysOf,
  type MessageTree,
  messageAt,
  plural,
  slotsOf,
  withFallback,
} from "./catalog";
import { LOCALE_TAGS, LOCALES } from "./locales";
import { CATALOGS, messagesFor } from "./messages";
import { en } from "./messages/en";

/**
 * Every catalog against the English one (ADR 0065). These run in CI, so a
 * message added in English and not yet translated fails the build with the
 * list of keys to translate, instead of shipping English by surprise.
 */
const english = keysOf(en);

describe.each(LOCALES.filter((l) => l !== "en"))("the %s catalog", (locale) => {
  const catalog = CATALOGS[locale] as MessageTree;
  const keys = keysOf(catalog);

  it("translates every English message", () => {
    expect(english.filter((k) => !keys.includes(k))).toEqual([]);
  });

  it("has no message English doesn't", () => {
    expect(keys.filter((k) => !english.includes(k))).toEqual([]);
  });

  it("keeps each message's {slots} and form", () => {
    for (const key of keys) {
      const own = messageAt(catalog, key);
      const base = messageAt(en, key);
      if (own === undefined || base === undefined) continue;
      expect(typeof own, key).toBe(typeof base);
      expect(slotsOf(own), key).toEqual(slotsOf(base));
    }
  });

  it("gives a plural every form the language's rules can pick", () => {
    const categories = new Intl.PluralRules(
      LOCALE_TAGS[locale],
    ).resolvedOptions().pluralCategories;
    for (const key of keys) {
      const own = messageAt(catalog, key);
      if (typeof own !== "object") continue;
      for (const category of categories)
        // "other" covers a category a language rarely uses, such as
        // Spanish "many" for a million; anything else must be written.
        if (category !== "many")
          expect(own.$plural[category], `${key}.${category}`).toBeDefined();
    }
  });

  it("is never left blank", () => {
    for (const key of keys) {
      const own = messageAt(catalog, key);
      const texts =
        typeof own === "string" ? [own] : Object.values(own?.$plural ?? {});
      for (const text of texts) expect(text.trim(), key).not.toBe("");
    }
  });
});

describe("withFallback", () => {
  it("fills a missing message with English, and keeps the rest", () => {
    const merged = withFallback(
      { a: "Hello", b: { c: "Team", d: "Teams" } },
      { b: { c: "Equipo" } },
    );
    expect(merged).toEqual({ a: "Hello", b: { c: "Equipo", d: "Teams" } });
  });

  it("never takes a message of the wrong shape", () => {
    const base = { n: { $plural: { one: "{n} team", other: "{n} teams" } } };
    // A catalog read from elsewhere could hold a string where a plural
    // belongs; the English plural stands.
    const wrongShape = JSON.parse('{ "n": "equipos" }') as Record<
      string,
      undefined
    >;
    expect(withFallback(base, wrongShape).n).toEqual(base.n);
  });

  it("gives every language a complete catalog", () => {
    for (const locale of LOCALES)
      expect(keysOf(messagesFor(locale) as MessageTree)).toEqual(english);
  });
});

describe("fill and plural", () => {
  it("fills slots, and leaves an unknown one visible", () => {
    expect(fill("Hi {name}, {count} new", { name: "Ana", count: 3 })).toBe(
      "Hi Ana, 3 new",
    );
    expect(fill("Hi {name}")).toBe("Hi {name}");
  });

  it("picks the form for the count in each language", () => {
    const teams = en.formats.teams;
    expect(plural("en", teams, 1)).toBe("1 team");
    expect(plural("en", teams, 0)).toBe("0 teams");
    expect(plural("en", teams, 1250)).toBe("1,250 teams");
    const equipos = messagesFor("es").formats.teams;
    expect(plural("es", equipos, 1)).toBe("1 equipo");
    expect(plural("es", equipos, 2)).toBe("2 equipos");
    // Spanish "many" falls back to "other".
    expect(plural("es", equipos, 1_000_000)).toMatch(/equipos$/);
  });
});
