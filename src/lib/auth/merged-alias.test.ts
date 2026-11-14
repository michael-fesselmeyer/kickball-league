import { describe, expect, it } from "vitest";
import { followAlias, MAGIC_LINK_PATH, requestedEmail } from "./merged-alias";

describe("merged-away addresses", () => {
  it("send a sign-in link for an alias to the kept account", () => {
    expect(
      followAlias(
        MAGIC_LINK_PATH,
        { email: "old@example.test", callbackURL: "/app" },
        "kept@example.test",
      ),
    ).toEqual({ email: "kept@example.test", callbackURL: "/app" });
  });

  it("leave everything else alone", () => {
    expect(
      followAlias(MAGIC_LINK_PATH, { email: "a@example.test" }, null),
    ).toBe(null);
    expect(
      followAlias("/sign-out", { email: "a@example.test" }, "b@example.test"),
    ).toBe(null);
    expect(followAlias(MAGIC_LINK_PATH, "nope", "b@example.test")).toBe(null);
  });

  it("read the address a request names", () => {
    expect(requestedEmail({ email: "a@example.test" })).toBe("a@example.test");
    expect(requestedEmail({ email: 3 })).toBe(null);
    expect(requestedEmail(null)).toBe(null);
  });
});
