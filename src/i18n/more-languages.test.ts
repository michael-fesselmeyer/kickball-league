import { describe, expect, it } from "vitest";
import { fill, plural } from "./catalog";
import { formatDay, formatInstant, formatList, formatOrdinal } from "./format";
import { LANG_ATTRIBUTES, LOCALE_NAMES, LOCALES } from "./locales";
import { messagesFor } from "./messages";
import { isTranslated } from "./pages";
import { languageAlternates, switchLanguagePath } from "./routing";

/**
 * Chinese, Russian, Polish, Bengali, Korean and Haitian Creole (issue 441):
 * the parts each language needs beyond its catalog, which
 * catalogs.test.ts checks key by key.
 */
const NEW = ["zh", "ru", "pl", "bn", "ko", "ht"] as const;

describe("the new languages", () => {
  it("are offered by their own names, Chinese as Simplified", () => {
    expect(NEW.map((l) => LOCALE_NAMES[l])).toEqual([
      "简体中文",
      "Русский",
      "Polski",
      "বাংলা",
      "한국어",
      "Kreyòl ayisyen",
    ]);
    expect(LANG_ATTRIBUTES.zh).toBe("zh-Hans");
    expect(LOCALES).toEqual(["en", "es", ...NEW, "it", "fr"]);
  });

  it("serve the catalog's pages under their own prefix, and link to English help", () => {
    for (const locale of NEW) {
      expect(isTranslated(locale, "/faq"), locale).toBe(true);
      expect(isTranslated(locale, "/seasons/fall-2026/standings")).toBe(true);
      expect(isTranslated(locale, "/l/flag-football/teams/the-big-kicks")).toBe(
        true,
      );
      // The how-tos are written in English and Spanish only so far.
      expect(isTranslated(locale, "/help/player"), locale).toBe(false);
      expect(switchLanguagePath("/es/faq", locale)).toBe(`/${locale}/faq`);
    }
  });

  it("name Simplified Chinese in hreflang", () => {
    expect(languageAlternates("/about")["zh-Hans"]).toBe("/zh/about");
    expect(languageAlternates("/about")).not.toHaveProperty("zh");
  });
});

describe("counts", () => {
  it("use Russian and Polish few and many forms", () => {
    const ru = messagesFor("ru").formats.teams;
    expect([1, 3, 5, 21, 22, 25].map((n) => plural("ru", ru, n))).toEqual([
      "1 команда",
      "3 команды",
      "5 команд",
      "21 команда",
      "22 команды",
      "25 команд",
    ]);
    const pl = messagesFor("pl").formats.players;
    expect([1, 2, 5, 22].map((n) => plural("pl", pl, n))).toEqual([
      "1 gracz",
      "2 gracze",
      "5 graczy",
      "22 gracze",
    ]);
  });

  it("keep Western digits in Bengali", () => {
    expect(plural("bn", messagesFor("bn").formats.teams, 12)).toBe("12টি দল");
  });
});

describe("ordinals", () => {
  it("fit each language's phrase for an inning", () => {
    const top = (locale: (typeof NEW)[number]) =>
      fill(messagesFor(locale).live.top, {
        nth: formatOrdinal(locale, 3, "feminine"),
      });
    expect(NEW.map(top)).toEqual([
      "第3局上半",
      "Верх 3-го иннинга",
      "Góra 3. zmiany",
      "3য় ইনিংসের প্রথম ভাগ",
      "3회초",
      "Tèt 3yèm manch lan",
    ]);
  });

  it("fit each language's phrase for a place in the standings", () => {
    const place = (locale: (typeof NEW)[number]) =>
      fill(messagesFor(locale).team.standing, {
        record: "5-2",
        rank: formatOrdinal(locale, 2),
      });
    expect(NEW.map(place)).toEqual([
      "5-2，第2名",
      "5-2, 2-е место",
      "5-2, 2. miejsce",
      "5-2, 2য় স্থান",
      "5-2, 2위",
      "5-2, 2yèm plas",
    ]);
  });

  it("give Bengali and Creole their own endings", () => {
    expect([1, 2, 4, 6, 9, 11].map((n) => formatOrdinal("bn", n))).toEqual([
      "1ম",
      "2য়",
      "4র্থ",
      "6ষ্ঠ",
      "9ম",
      "11তম",
    ]);
    expect([1, 2, 10].map((n) => formatOrdinal("ht", n))).toEqual([
      "1ye",
      "2yèm",
      "10yèm",
    ]);
  });
});

describe("Haitian Creole dates and lists", () => {
  // The formatting data has no Creole, so its dates read the French ones
  // with the Creole day and month names.
  it("names days and months in Creole", () => {
    expect(formatDay("ht", "2027-08-14")).toBe("samdi 14 out");
    expect(
      formatInstant(
        "ht",
        new Date("2027-04-11T18:30:00Z"),
        "America/New_York",
        {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        },
      ),
    ).toBe("dim. 11 avr., 14:30");
  });

  it("joins a list with “ak”", () => {
    expect(formatList("ht", ["Ana", "Bo", "Cy"])).toBe("Ana, Bo ak Cy");
    expect(formatList("ht", ["Ana"])).toBe("Ana");
  });
});

describe("Italian and French", () => {
  const LATIN = ["it", "fr"] as const;

  it("are offered by their own names", () => {
    expect(LATIN.map((l) => LOCALE_NAMES[l])).toEqual(["Italiano", "Français"]);
    expect(LATIN.map((l) => LANG_ATTRIBUTES[l])).toEqual(["it", "fr"]);
  });

  it("serve the catalog's pages under their own prefix, and link to English help", () => {
    for (const locale of LATIN) {
      expect(isTranslated(locale, "/faq"), locale).toBe(true);
      expect(isTranslated(locale, "/help/player"), locale).toBe(false);
      expect(switchLanguagePath("/es/faq", locale)).toBe(`/${locale}/faq`);
    }
    expect(languageAlternates("/about")).toMatchObject({
      it: "/it/about",
      fr: "/fr/about",
    });
  });

  it("write ordinals their own way, an inning in the feminine", () => {
    expect([1, 2, 3].map((n) => formatOrdinal("it", n))).toEqual([
      "1º",
      "2º",
      "3º",
    ]);
    expect(formatOrdinal("it", 3, "feminine")).toBe("3ª");
    expect([1, 2, 21].map((n) => formatOrdinal("fr", n))).toEqual([
      "1er",
      "2e",
      "21e",
    ]);
    expect(formatOrdinal("fr", 1, "feminine")).toBe("1re");
  });

  it("fit each language's phrase for a place in the standings", () => {
    const place = (locale: (typeof LATIN)[number], n: number) =>
      fill(messagesFor(locale).team.standing, {
        record: "5-2",
        rank: formatOrdinal(locale, n),
      });
    expect(place("it", 2)).toBe("5-2, 2º posto");
    expect(place("fr", 1)).toBe("5-2, 1er au classement");
  });

  it("count one in French for zero as well as one", () => {
    const teams = (n: number) =>
      plural("fr", messagesFor("fr").formats.teams, n);
    expect([0, 1, 2].map(teams)).toEqual(["0 équipe", "1 équipe", "2 équipes"]);
    const players = (n: number) =>
      plural("it", messagesFor("it").formats.players, n);
    expect([0, 1, 2].map(players)).toEqual([
      "0 giocatori",
      "1 giocatore",
      "2 giocatori",
    ]);
  });
});
