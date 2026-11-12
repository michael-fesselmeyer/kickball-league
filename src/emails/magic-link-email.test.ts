import { describe, expect, it } from "vitest";
import { renderMagicLinkEmail } from "./magic-link-email";

describe("renderMagicLinkEmail", () => {
  const url =
    "https://example.test/api/auth/magic-link/verify?token=t&callbackURL=%2Fapp";
  const email = renderMagicLinkEmail({ url, minutes: 15 });

  it("links to the sign-in URL in both versions", () => {
    expect(email.subject).toBe("Your sign-in link");
    expect(email.html).toContain(`href="${url.replace("&", "&amp;")}"`);
    expect(email.text).toContain(url);
  });

  it("says how long the link lasts and what to do if it was not requested", () => {
    expect(email.text).toContain("expires in 15 minutes");
    expect(email.html).toContain("expires in");
    expect(email.text).toContain("Ignore this email");
  });

  it("is a full HTML document", () => {
    expect(email.html.startsWith("<!doctype html><html")).toBe(true);
    expect(email.html.trimEnd().endsWith("</html>")).toBe(true);
  });
});

describe("renderMagicLinkEmail escaping", () => {
  it("cannot be broken out of by a hostile link", () => {
    const { html } = renderMagicLinkEmail({
      url: `https://example.test/"><script>alert(1)</script>`,
      minutes: 15,
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });
});
