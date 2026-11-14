import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decryptToken } from "@/lib/social/token-crypto";
import { seal, unseal } from "./sealed";

const SECRET = "unit-test-secret-not-a-real-one-0001";
const at = { secret: SECRET, purpose: "emergency-contact", bindTo: "row-1" };

describe("sealing", () => {
  it("opens what it sealed, for any text", () => {
    fc.assert(
      fc.property(fc.string({ unit: "grapheme" }), (text) => {
        expect(unseal(seal(text, at), at)).toBe(text);
      }),
    );
  });

  it("never stores the plaintext and differs every time", () => {
    const a = seal("Sam Example, (718) 555-0199", at);
    expect(a).not.toContain("555");
    expect(seal("Sam Example, (718) 555-0199", at)).not.toBe(a);
  });

  it("won't open for another row, purpose or secret, or once altered", () => {
    const sealed = seal("allergic to bees", at);
    expect(unseal(sealed, { ...at, bindTo: "row-2" })).toBeNull();
    expect(unseal(sealed, { ...at, purpose: "social-token" })).toBeNull();
    expect(
      unseal(sealed, { ...at, secret: "another-unit-test-secret-000000002" }),
    ).toBeNull();
    const [v, iv, tag, body] = sealed.split(".");
    expect(unseal([v, iv, tag, `A${body?.slice(1)}`].join("."), at)).toBeNull();
    expect(unseal("v2.a.b.c", at)).toBeNull();
    expect(unseal("not sealed", at)).toBeNull();
  });

  it("still opens Instagram tokens sealed before the helper was shared", () => {
    // Made by the earlier token-crypto.ts with this secret and binding.
    const before =
      "v1.GuMMz6hqhorQaXiU.ieiMVmNXcdPV_uNhUnsEXg.ZpNvyz0CcqM_zuaXECYaLBLwdOwqZa0";
    expect(decryptToken(before, SECRET, "account-1")).toBe(
      "an-instagram-test-token",
    );
  });
});
