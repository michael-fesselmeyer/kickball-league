import { describe, expect, it } from "vitest";
import { accountLinking, isGoogleEnabled, socialProviders } from "./google";

const both = {
  GOOGLE_CLIENT_ID: "id.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "secret",
};

describe("Google sign-in", () => {
  it("is off until both credentials are set", () => {
    expect(isGoogleEnabled({})).toBe(false);
    expect(isGoogleEnabled({ GOOGLE_CLIENT_ID: both.GOOGLE_CLIENT_ID })).toBe(
      false,
    );
    expect(
      isGoogleEnabled({ GOOGLE_CLIENT_SECRET: both.GOOGLE_CLIENT_SECRET }),
    ).toBe(false);
    expect(socialProviders({})).toEqual({});
  });

  it("configures Google with an account picker once both are set", () => {
    expect(isGoogleEnabled(both)).toBe(true);
    expect(socialProviders(both)).toEqual({
      google: {
        clientId: both.GOOGLE_CLIENT_ID,
        clientSecret: both.GOOGLE_CLIENT_SECRET,
        prompt: "select_account",
      },
    });
  });

  it("links a Google sign-in to an existing account with the same verified email", () => {
    expect(accountLinking).toEqual({
      enabled: true,
      trustedProviders: ["google"],
    });
  });
});
