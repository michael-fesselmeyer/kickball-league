import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Screen-wide rules that are easy to forget on a new page, checked in the
 * source: every page has its own title, a page's loading state holds its
 * space, and a form's submit button can't send it twice.
 */

const APP = __dirname;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

const all = files(APP).map((path) => ({
  name: relative(APP, path),
  source: readFileSync(path, "utf8"),
}));
const pages = all.filter((f) => f.name.endsWith("page.tsx"));

/** Pages with no title of their own, and why. */
const UNTITLED = new Set([
  // Each only redirects to a season's page.
  "app/books/page.tsx",
  "app/books/permits/page.tsx",
  "app/owner/page.tsx",
  // Must not hint to anyone else that it exists.
  "operator/page.tsx",
]);

const staticTitle = (source: string) =>
  /export const metadata[^=]*=\s*\{[^}]*?\btitle:\s*("[^"]*"|[A-Z_]+|\{)/s.exec(
    source,
  )?.[1];

describe("page titles", () => {
  it.each(pages.map((p) => [p.name, p.source]))(
    "%s has a title",
    (name, source) => {
      if (UNTITLED.has(name)) return;
      expect(
        staticTitle(source) !== undefined || /generateMetadata/.test(source),
      ).toBe(true);
    },
  );

  it("no two pages share a fixed title", () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const page of pages) {
      const title = staticTitle(page.source);
      if (!title?.startsWith('"')) continue;
      const other = seen.get(title);
      if (other) clashes.push(`${title}: ${other} and ${page.name}`);
      seen.set(title, page.name);
    }
    expect(clashes).toEqual([]);
  });
});

describe("loading states", () => {
  it.each(pages.map((p) => [p.name, p.source]))(
    "%s holds the screen's space while it loads",
    (_name, source) => {
      // A bare line of text lets the footer jump up, then down again.
      expect(source).not.toMatch(/fallback=\{\s*<p>/);
    },
  );
});

describe("submit buttons", () => {
  // Server-rendered forms can't track their own submit, so a fast double
  // tap would send them twice; SubmitButton ignores the second.
  const serverForms = all.filter(
    (f) =>
      !/^\s*["']use client["']/.test(f.source) &&
      // A search form (method="get") just loads a page.
      [...f.source.matchAll(/<form\b([^>]*)>/gs)].some(
        ([, attributes]) =>
          /\baction=\{/.test(attributes) && !/method="get"/.test(attributes),
      ),
  );

  it("finds the server-rendered forms", () => {
    expect(serverForms.length).toBeGreaterThan(40);
  });

  it.each(serverForms.map((f) => [f.name, f.source]))(
    "%s submits with SubmitButton",
    (_name, source) => {
      const plain = [...source.matchAll(/<button\b([^>]*)>/gs)].filter(
        ([, attributes]) => !/\btype="button"/.test(attributes),
      );
      expect(plain.map(([tag]) => tag)).toEqual([]);
    },
  );
});
