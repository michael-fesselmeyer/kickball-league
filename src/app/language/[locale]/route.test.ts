import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET } from "./route";

const ORIGIN = "https://league.example.test";

/** The footer's link to `locale`, as a browser sends it. */
async function follow(
  locale: string,
  { from, referer }: { from?: string; referer?: string } = {},
) {
  const url = new URL(`/language/${locale}`, ORIGIN);
  if (from !== undefined) url.searchParams.set("from", from);
  const request = new NextRequest(url, {
    headers: referer ? { referer } : {},
  });
  return GET(request, {
    params: Promise.resolve({ locale }),
  });
}

const target = (response: Response) =>
  new URL(response.headers.get("location") ?? "").pathname +
  new URL(response.headers.get("location") ?? "").search;

describe("GET /language/[locale]", () => {
  it("goes to the link's own page in the language picked", async () => {
    const response = await follow("es", { from: "/faq" });
    expect(response.status).toBe(303);
    expect(target(response)).toBe("/es/faq");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(target(await follow("en", { from: "/es/faq" }))).toBe("/faq");
  });

  it("ignores a Referer the service worker rewrote when the link names the page", async () => {
    const response = await follow("en", {
      from: "/es/faq",
      referer: `${ORIGIN}/sw.js`,
    });
    expect(target(response)).toBe("/faq");
  });

  it("falls back to the Referer, then the home page", async () => {
    expect(target(await follow("es", { referer: `${ORIGIN}/help` }))).toBe(
      "/es/help",
    );
    expect(
      target(
        await follow("es", {
          from: "https://elsewhere.example.test/faq",
          referer: `${ORIGIN}/help`,
        }),
      ),
    ).toBe("/es/help");
    expect(target(await follow("es"))).toBe("/es");
    expect(target(await follow("en"))).toBe("/");
  });

  it("never lands on the service worker or another file", async () => {
    expect(target(await follow("en", { referer: `${ORIGIN}/sw.js` }))).toBe(
      "/",
    );
    expect(target(await follow("en", { from: "/sw.js" }))).toBe("/");
    expect(target(await follow("es", { from: "/_next/static/x.js" }))).toBe(
      "/es",
    );
  });

  it("stays on this site whatever the link says", async () => {
    const response = await follow("en", { from: "//elsewhere.example.test/" });
    expect(new URL(response.headers.get("location") ?? "").origin).toBe(ORIGIN);
  });

  it("treats an unknown language as English", async () => {
    expect(target(await follow("xx", { from: "/es/faq" }))).toBe("/faq");
  });
});
