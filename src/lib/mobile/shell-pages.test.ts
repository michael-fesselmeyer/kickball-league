import { describe, expect, it } from "vitest";
import { resolveAppUrl } from "./app-url";
import { shellPages } from "./shell-pages";

describe("shellPages", () => {
  const pages = shellPages(resolveAppUrl("https://league.example.test"));

  it("writes the shell's start page and its error page", () => {
    expect(Object.keys(pages)).toEqual(["index.html", "offline.html"]);
  });

  it("sends the start page on to the signed-in home screen", () => {
    expect(pages["index.html"]).toContain(
      'location.replace("https://league.example.test/app")',
    );
    expect(pages["index.html"]).toContain(
      'href="https://league.example.test/app"',
    );
  });

  it("offers a way back to the site when it can't be reached", () => {
    const offline = pages["offline.html"];
    expect(offline).toContain("<h1>Can't reach the league</h1>");
    expect(offline).toContain('href="https://league.example.test/app"');
    expect(offline).toContain('lang="en"');
    // Clear of the notch and the home indicator.
    expect(offline).toContain("viewport-fit=cover");
    expect(offline).toContain("env(safe-area-inset-top)");
  });

  it("uses a dev server's address as given", () => {
    const dev = shellPages(resolveAppUrl("http://localhost:3000"));
    expect(dev["offline.html"]).toContain('href="http://localhost:3000/app"');
  });
});
