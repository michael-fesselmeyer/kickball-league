import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTENT_PAGES } from "@/lib/seo/sitemap";
import { searchHelp } from "@/domain/help/search";
import {
  HELP_ROLES,
  helpEntries,
  helpRolesFor,
  roleBySlug,
  TRANSLATED_HELP_ROLES,
} from "./articles";
import { HELP_ES, type SpanishRole } from "./articles.es";

/** Every .tsx file under src/app, for the screens' Help links. */
function screens(dir = join(process.cwd(), "src/app")): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const path = join(dir, d.name);
    if (d.isDirectory()) return screens(path);
    return d.name.endsWith(".tsx") ? [path] : [];
  });
}

describe("the help center's how-tos", () => {
  it("gives a language without its own how-tos the English ones", () => {
    for (const locale of ["zh", "ru", "pl", "bn", "ko", "ht"] as const) {
      expect(helpRolesFor(locale), locale).toBe(HELP_ROLES);
      expect(TRANSLATED_HELP_ROLES[locale], locale).toEqual([]);
    }
  });

  it("covers every role with the topics each needs", () => {
    const titles = Object.fromEntries(
      HELP_ROLES.map((r) => [r.slug, r.articles.map((a) => a.id)]),
    );
    expect(titles).toEqual({
      player: [
        "sign-up",
        "pay",
        "raise-concern",
        "rsvp",
        "subs",
        "install",
        "conduct",
        "alerts",
        "contact-league",
        "check-in",
        "email-choices",
        "season-card",
        "who-has-field",
        "change-team",
        "leadership-check-in",
      ],
      captain: [
        "invite",
        "lineup",
        "scores",
        "co-captains",
        "find-subs",
        "game-day-checklist",
        "check-in-players",
        "injury-report",
        "recruit",
      ],
      ref: [
        "game-day",
        "live-scoring",
        "incidents",
        "ref-pool",
        "injury",
        "permit-layout",
      ],
      admin: [
        "season-setup",
        "schedule",
        "rain-outs",
        "command-center",
        "refunds",
        "shirt-order",
        "game-day-checklists",
        "field-layouts",
        "permit-coverage",
        "ref-assigner",
        "league-inbox",
        "injury-reports",
        "leadership-check-ins",
      ],
      owner: [
        "books",
        "permits",
        "permit-renewal",
        "dashboard",
        "season-checklist",
        "report-card",
        "processing-fees",
      ],
    });
  });

  it("keeps each how-to short", () => {
    for (const role of HELP_ROLES)
      for (const a of role.articles) {
        expect(a.steps.length, a.id).toBeGreaterThan(1);
        expect(a.steps.length, a.id).toBeLessThanOrEqual(6);
        expect(a.summary.length, a.id).toBeLessThanOrEqual(140);
      }
  });

  it("links each how-to to a signed-in screen, never another site", () => {
    for (const role of HELP_ROLES)
      for (const a of role.articles)
        if (a.screen) expect(a.screen.href, a.id).toMatch(/^\/app(\/|$|#)/);
  });

  it("lists each role's page in the sitemap", () => {
    const paths: string[] = CONTENT_PAGES.map((p) => p.path);
    expect(paths).toContain("/help");
    for (const role of HELP_ROLES)
      expect(paths).toContain(`/help/${role.slug}`);
  });

  it("gives the search box one entry per how-to", () => {
    const entries = helpEntries();
    expect(entries).toHaveLength(
      HELP_ROLES.reduce((n, r) => n + r.articles.length, 0),
    );
    expect(new Set(entries.map((e) => e.href)).size).toBe(entries.length);
    expect(entries[0]).toMatchObject({
      href: "/help/player#sign-up",
      role: "Players",
    });
  });

  it("has a how-to for every Help link on a screen", () => {
    const links = screens().flatMap((file) =>
      [
        ...readFileSync(file, "utf8").matchAll(
          /<HelpLink\s+audience="([a-z]+)"\s+article="([a-z-]+)"/g,
        ),
      ].map(([, role, article]) => ({ file, role, article })),
    );
    expect(links.length).toBeGreaterThanOrEqual(15);
    for (const { file, role, article } of links)
      expect(
        roleBySlug(role ?? "")?.articles.some((a) => a.id === article),
        `${file}: /help/${role}#${article}`,
      ).toBe(true);
  });
});

describe("the how-tos in Spanish", () => {
  const spanish = helpRolesFor("es");

  it("covers players, captains and refs, with English's articles and screens", () => {
    expect(spanish.map((r) => r.slug)).toEqual(TRANSLATED_HELP_ROLES.es);
    for (const role of spanish) {
      const english = HELP_ROLES.find((r) => r.slug === role.slug);
      expect(
        Object.keys(HELP_ES[role.slug as SpanishRole].articles).sort(),
      ).toEqual(english?.articles.map((a) => a.id).sort());
      for (const [i, a] of role.articles.entries()) {
        const source = english?.articles[i];
        expect(a.id).toBe(source?.id);
        expect(a.title, a.id).not.toBe(source?.title);
        expect(a.steps.length, a.id).toBe(source?.steps.length);
        expect(a.screen?.href, a.id).toBe(source?.screen?.href);
        if (source?.screen)
          expect(a.screen?.label, a.id).not.toBe(source.screen.label);
        expect(a.summary.length, a.id).toBeLessThanOrEqual(160);
      }
    }
  });

  it("searches in Spanish, linking the Spanish pages", () => {
    const entries = helpEntries("es");
    expect(entries[0]).toMatchObject({
      href: "/es/help/player#sign-up",
      role: "Jugadores",
    });
    expect(searchHelp(entries, "pagar")[0]?.href).toBe("/es/help/player#pay");
  });
});
