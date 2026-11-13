import { describe, expect, it } from "vitest";
import { withVapidKeys } from "./env-file";

const keys = { publicKey: "Bpublic", privateKey: "private" };

describe("withVapidKeys", () => {
  it("appends the pair to an existing file", () => {
    expect(withVapidKeys("DATABASE_URL=x\n", keys)).toBe(
      [
        "DATABASE_URL=x",
        "",
        "# Web push (npm run push:keys). Keep the private key secret.",
        "VAPID_PUBLIC_KEY=Bpublic",
        "VAPID_PRIVATE_KEY=private",
        "",
      ].join("\n"),
    );
  });

  it("fills in blank lines copied from .env.example", () => {
    const result = withVapidKeys(
      "DATABASE_URL=x\nVAPID_PUBLIC_KEY=\nVAPID_PRIVATE_KEY=\n",
      keys,
    );
    expect(result?.match(/VAPID_PUBLIC_KEY=/g)).toHaveLength(1);
    expect(result).toContain("VAPID_PRIVATE_KEY=private");
  });

  it("starts an empty file", () => {
    expect(withVapidKeys("", keys)?.startsWith("# Web push")).toBe(true);
  });

  it("never replaces a key that is already set", () => {
    expect(withVapidKeys("VAPID_PRIVATE_KEY=old\n", keys)).toBeNull();
    expect(withVapidKeys(" VAPID_PUBLIC_KEY = Bold\n", keys)).toBeNull();
  });
});
