import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  FEATURE_KEYS,
  FEATURES,
  FRESH_SIGN_IN_MS,
  SITE_STATUSES,
  canWrite,
  featureOn,
  isFeature,
  isGrantableRole,
  isOperator,
  isSiteStatus,
  parseOperatorIds,
  reachableWhilePaused,
  signedInRecently,
} from "./operator";

const A = "0b6f2b5e-6a0d-4c1e-9f1a-2d3c4b5a6f70";
const B = "1c7a3c6f-7b1e-4d2f-8a2b-3e4d5c6b7a81";

describe("operator identity", () => {
  it("reads ids from the environment and ignores anything else", () => {
    const ids = parseOperatorIds(` ${A.toUpperCase()}, not-an-id,,${B} `);
    expect([...ids].sort()).toEqual([A, B].sort());
  });

  it("is nobody when unset or empty", () => {
    expect(parseOperatorIds(undefined).size).toBe(0);
    expect(parseOperatorIds("").size).toBe(0);
    expect(isOperator(A, parseOperatorIds(undefined))).toBe(false);
  });

  it("never treats a signed-out visitor or an unlisted person as the operator", () => {
    const ids = parseOperatorIds(A);
    expect(isOperator(null, ids)).toBe(false);
    expect(isOperator(B, ids)).toBe(false);
    expect(isOperator(A, ids)).toBe(true);
  });
});

describe("signedInRecently", () => {
  const now = new Date("2027-03-01T12:00:00Z");
  it("accepts a sign-in within the window and refuses older or missing ones", () => {
    expect(
      signedInRecently(new Date(now.getTime() - FRESH_SIGN_IN_MS), now),
    ).toBe(true);
    expect(
      signedInRecently(new Date(now.getTime() - FRESH_SIGN_IN_MS - 1), now),
    ).toBe(false);
    expect(signedInRecently(null, now)).toBe(false);
  });
});

describe("site status", () => {
  it("lets only the operator write while read-only or paused", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SITE_STATUSES),
        fc.boolean(),
        (status, operator) => {
          expect(canWrite(status, operator)).toBe(
            status === "active" || operator,
          );
        },
      ),
    );
  });

  it.each([
    ["/app", true],
    ["/app/profile/export", true],
    ["/sign-in", true],
    ["/operator", true],
    ["/api/auth/sign-in/magic-link", true],
    ["/", false],
    ["/seasons/fall-2026/schedule", false],
    ["/application", false],
    ["/operatorx", false],
  ])("treats %s as reachable while paused: %s", (path, reachable) => {
    expect(reachableWhilePaused(path)).toBe(reachable);
  });

  it("recognizes statuses, features and roles", () => {
    expect(isSiteStatus("paused")).toBe(true);
    expect(isSiteStatus("closed")).toBe(false);
    expect(isFeature("subs")).toBe(true);
    expect(isFeature("toString")).toBe(false);
    expect(isGrantableRole("owner")).toBe(true);
    expect(isGrantableRole("operator")).toBe(false);
  });

  it("keeps a feature on unless it was switched off", () => {
    expect(featureOn([], "subs")).toBe(true);
    expect(featureOn(["subs"], "subs")).toBe(false);
    expect(featureOn(["weather"], "subs")).toBe(true);
  });
});

describe("feature keys", () => {
  it("lists every switchable feature exactly once", () => {
    expect([...FEATURE_KEYS].sort()).toEqual(Object.keys(FEATURES).sort());
  });
});
