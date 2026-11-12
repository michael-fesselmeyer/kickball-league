import { describe, expect, it } from "vitest";
import { stripeMockServer } from "./stripe-mock";

const TEST_KEY = "sk_test_e2e";

describe("stripeMockServer", () => {
  it("points a test key at a mock server on this machine", () => {
    expect(
      stripeMockServer({
        STRIPE_SECRET_KEY: TEST_KEY,
        STRIPE_MOCK_URL: "http://localhost:12111",
      }),
    ).toEqual({ host: "localhost", port: 12111, protocol: "http" });
  });

  it("is off when no mock address is set", () => {
    expect(stripeMockServer({ STRIPE_SECRET_KEY: TEST_KEY })).toBeNull();
  });

  it("never applies to a live key", () => {
    expect(
      stripeMockServer({
        STRIPE_SECRET_KEY: "sk_live_e2e",
        STRIPE_MOCK_URL: "http://localhost:12111",
      }),
    ).toBeNull();
  });

  it.each([
    "https://localhost:12111",
    "http://stripe-mock.example.test:12111",
    "not a url",
  ])("ignores an address that is not plain http on this machine: %s", (url) => {
    expect(
      stripeMockServer({ STRIPE_SECRET_KEY: TEST_KEY, STRIPE_MOCK_URL: url }),
    ).toBeNull();
  });
});
