import { describe, expect, it } from "vitest";
import { checkoutPage, demoCheckoutOn, returnPath } from "./checkout";

const demo = {
  DEMO_MODE: "true",
  DATABASE_URL: "postgresql://demo:demo@localhost:5432/kb_demo",
  STRIPE_SECRET_KEY: "sk_test_demo",
  STRIPE_MOCK_URL: "http://localhost:12111",
  DEMO_CHECKOUT: "true",
};
const session = {
  id: "cs_test_abc",
  url: "https://checkout.stripe.com/pay/c/cs_test_abc",
};
const success = "http://localhost:4100/app/seasons/fall-2026?paid=1";

describe("demoCheckoutOn", () => {
  it("needs the switch, demo mode and stripe-mock on this machine", () => {
    expect(demoCheckoutOn(demo)).toBe(true);
    expect(demoCheckoutOn({ ...demo, DEMO_CHECKOUT: undefined })).toBe(false);
    expect(demoCheckoutOn({ ...demo, DEMO_MODE: "false" })).toBe(false);
    expect(
      demoCheckoutOn({
        ...demo,
        DATABASE_URL: "postgresql://u:p@localhost:5432/league",
      }),
    ).toBe(false);
    expect(demoCheckoutOn({ ...demo, STRIPE_MOCK_URL: undefined })).toBe(false);
    expect(
      demoCheckoutOn({
        ...demo,
        STRIPE_MOCK_URL: "http://stripe.example.test",
      }),
    ).toBe(false);
  });
});

describe("checkoutPage", () => {
  it("is Stripe's page unless the demo's checkout is on", () => {
    expect(checkoutPage(session, success, "payment", {})).toBe(session.url);
    expect(
      checkoutPage({ ...session, url: null }, success, "payment", {}),
    ).toBe(null);
  });

  it("is the demo's page, coming back to the success page", () => {
    expect(checkoutPage(session, success, "payment", demo)).toBe(
      "/app/demo/checkout/cs_test_abc?back=%2Fapp%2Fseasons%2Ffall-2026%3Fpaid%3D1",
    );
    expect(checkoutPage(session, success, "setup", demo)).toContain(
      "&mode=setup",
    );
  });
});

describe("returnPath", () => {
  it("keeps a path on this site and refuses anything else", () => {
    expect(returnPath("/app/shop?order=paid")).toBe("/app/shop?order=paid");
    for (const bad of [
      "https://evil.example.test/",
      "//evil.example.test",
      "/\\evil.example.test",
      "app",
      undefined,
      ["/app"],
    ])
      expect(returnPath(bad)).toBe("/app");
  });
});
