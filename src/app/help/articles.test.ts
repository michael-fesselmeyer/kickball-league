import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTENT_PAGES } from "@/lib/seo/sitemap";
import { HELP_ROLES, helpEntries, roleBySlug } from "./articles";

/** Every .tsx file under src/app, for the screens' Help links. */
function screens(dir = join(process.cwd(), "src/app")): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const path = join(dir, d.name);
    if (d.isDirectory()) return screens(path);
    return d.name.endsWith(".tsx") ? [path] : [];
  });
}

describe("the help center's how-tos", () => {
  it("covers every role with the topics each needs", () => {
    const titles = Object.fromEntries(
      HELP_ROLES.map((r) => [r.slug, r.articles.map((a) => a.id)]),
    );
    expect(titles).toEqual({
      player: ["sign-up", "pay", "rsvp", "subs", "install", "alerts"],
      captain: ["invite", "lineup", "scores", "co-captains", "find-subs"],
      ref: ["game-day", "live-scoring", "incidents"],
      admin: ["season-setup", "schedule", "rain-outs", "command-center"],
      owner: ["books", "permits", "dashboard"],
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
          /<HelpLink\s+role="([a-z]+)"\s+article="([a-z-]+)"/g,
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
