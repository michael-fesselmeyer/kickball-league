import { describe, expect, it } from "vitest";
import { renderEmail } from "./layout";

const site = { siteUrl: "https://league.example.test/" };

describe("renderEmail", () => {
  const email = renderEmail(
    {
      subject: "Hi <team>",
      heading: "Bring <snacks>",
      paragraphs: ["Line one\nline two", "Second & last"],
      action: { label: "Open", path: "/app/seasons/fall" },
      reason: "you play on Kick Assets",
    },
    site,
  );

  it("escapes every value in the HTML", () => {
    expect(email.html).toContain("Bring &lt;snacks&gt;");
    expect(email.html).toContain("Line one<br>line two");
    expect(email.html).toContain("Second &amp; last");
    expect(email.html).not.toContain("<snacks>");
  });

  it("links the button and the settings page to the site", () => {
    expect(email.html).toContain(
      'href="https://league.example.test/app/seasons/fall"',
    );
    expect(email.text).toContain(
      "Open: https://league.example.test/app/seasons/fall",
    );
    expect(email.text).toContain(
      "Choose which emails you get: https://league.example.test/app/profile#notifications",
    );
  });

  it("says why the person got it, in both versions", () => {
    expect(email.html).toContain(
      "You got this email because you play on Kick Assets.",
    );
    expect(email.text).toContain(
      "You got this email because you play on Kick Assets.",
    );
  });

  it("keeps the subject as plain text", () => {
    expect(email.subject).toBe("Hi <team>");
  });
});
