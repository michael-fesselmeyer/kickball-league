import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { envSchema, loadEnv, parseEnv, withVercelDefaults } from "./env";
import { generateVapidKeys } from "./push/web-push";

const valid = {
  DATABASE_URL:
    "postgresql://user:pass@ep-example.us-east-2.aws.neon.tech/kickball?sslmode=require",
  BETTER_AUTH_SECRET: "a".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
};

describe("parseEnv", () => {
  it("accepts a complete environment", () => {
    const result = parseEnv(valid);
    expect(result.ok).toBe(true);
  });

  it("ignores variables it does not know", () => {
    const result = parseEnv({ ...valid, PATH: "/usr/bin" });
    expect(result.ok && "PATH" in result.value).toBe(false);
  });

  it("names every missing required variable", () => {
    const result = parseEnv({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      for (const name of [
        "DATABASE_URL",
        "BETTER_AUTH_SECRET",
        "BETTER_AUTH_URL",
      ]) {
        expect(result.error).toContain(name);
      }
      expect(result.error.match(/is required/g)).toHaveLength(3);
    }
  });

  it("treats an empty string as missing", () => {
    const result = parseEnv({ ...valid, DATABASE_URL: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("DATABASE_URL");
  });

  it.each([
    ["DATABASE_URL", "mysql://user:pass@localhost/db", "postgres"],
    ["DATABASE_URL", "not a url", "postgres"],
    ["BETTER_AUTH_SECRET", "too-short", "32 characters"],
    ["BETTER_AUTH_URL", "ftp://example.com", "http(s)"],
  ])("rejects a malformed %s (%s)", (name, value, hint) => {
    const result = parseEnv({ ...valid, [name]: value });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain(name);
      expect(result.error).toContain(hint);
    }
  });

  it("rejects half a Google configuration", () => {
    const result = parseEnv({ ...valid, GOOGLE_CLIENT_ID: "id" });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toContain(
        "set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET",
      );
  });

  it("rejects half an email configuration", () => {
    const result = parseEnv({ ...valid, RESEND_API_KEY: "re_test_123" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("EMAIL_FROM");
  });

  it.each([
    ["RESEND_API_KEY", "sk_live_123", "starts with re_"],
    ["EMAIL_FROM", "not an address", "an address"],
  ])("rejects a malformed %s", (name, value, hint) => {
    const result = parseEnv({
      ...valid,
      RESEND_API_KEY: "re_test_123",
      EMAIL_FROM: "League <hello@example.test>",
      [name]: value,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(hint);
  });

  it("accepts a Stripe test key with its webhook secret, and refuses half or malformed", () => {
    const stripe = {
      STRIPE_SECRET_KEY: "sk_test_abc123",
      STRIPE_WEBHOOK_SECRET: "whsec_abc123",
    };
    expect(parseEnv({ ...valid, ...stripe }).ok).toBe(true);
    const half = parseEnv({ ...valid, STRIPE_SECRET_KEY: "sk_test_abc123" });
    expect(half.ok).toBe(false);
    if (!half.ok) expect(half.error).toContain("STRIPE_WEBHOOK_SECRET");
    const wrong = parseEnv({
      ...valid,
      ...stripe,
      STRIPE_SECRET_KEY: "pk_test_abc",
    });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error).toContain("starts with sk_test_");
    const secret = parseEnv({
      ...valid,
      ...stripe,
      STRIPE_WEBHOOK_SECRET: "abc",
    });
    expect(secret.ok).toBe(false);
    if (!secret.ok) expect(secret.error).toContain("starts with whsec_");
  });

  it.each(["League <hello@example.test>", "hello@example.test"])(
    "accepts email configured as %s",
    (from) => {
      const result = parseEnv({
        ...valid,
        RESEND_API_KEY: "re_test_123",
        EMAIL_FROM: from,
      });
      expect(result.ok).toBe(true);
    },
  );

  it("accepts a VAPID key pair, and refuses half, malformed or mismatched keys", () => {
    const keys = generateVapidKeys();
    const vapid = {
      VAPID_PUBLIC_KEY: keys.publicKey,
      VAPID_PRIVATE_KEY: keys.privateKey,
    };
    expect(parseEnv({ ...valid, ...vapid }).ok).toBe(true);
    expect(
      parseEnv({
        ...valid,
        ...vapid,
        VAPID_SUBJECT: "mailto:league@example.test",
      }).ok,
    ).toBe(true);
    const half = parseEnv({ ...valid, VAPID_PUBLIC_KEY: keys.publicKey });
    expect(half.ok).toBe(false);
    if (!half.ok) expect(half.error).toContain("VAPID_PRIVATE_KEY");
    const mismatched = parseEnv({
      ...valid,
      ...vapid,
      VAPID_PRIVATE_KEY: generateVapidKeys().privateKey,
    });
    expect(mismatched.ok).toBe(false);
    if (!mismatched.ok)
      expect(mismatched.error).toContain("is not the private key");
    const malformed = parseEnv({ ...valid, ...vapid, VAPID_PUBLIC_KEY: "abc" });
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.error).toContain("P-256 public key");
    const subject = parseEnv({ ...valid, ...vapid, VAPID_SUBJECT: "league" });
    expect(subject.ok).toBe(false);
    if (!subject.ok) expect(subject.error).toContain("mailto:");
  });

  it("allows Google sign-in to be unset until it is configured", () => {
    expect(parseEnv(valid).ok).toBe(true);
    expect(
      parseEnv({ ...valid, GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s" })
        .ok,
    ).toBe(true);
  });
});

describe("loadEnv", () => {
  it("returns typed values", () => {
    expect(loadEnv(valid).BETTER_AUTH_URL).toBe("http://localhost:3000");
  });

  it("throws with a readable message naming the variable", () => {
    expect(() => loadEnv({ ...valid, BETTER_AUTH_URL: undefined })).toThrow(
      /Invalid environment variables:[\s\S]*BETTER_AUTH_URL/,
    );
  });
});

describe(".env.example", () => {
  it("lists exactly the variables in the schema", () => {
    const example = readFileSync(join(process.cwd(), ".env.example"), "utf8");
    const names = example
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"))
      .map((line) => line.split("=")[0])
      .sort();
    expect(names).toEqual(Object.keys(envSchema.shape).sort());
  });
});

describe("withVercelDefaults", () => {
  const withoutUrl = {
    DATABASE_URL: valid.DATABASE_URL,
    BETTER_AUTH_SECRET: valid.BETTER_AUTH_SECRET,
  };

  it("uses the production domain in production", () => {
    const env = withVercelDefaults({
      ...withoutUrl,
      VERCEL_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: "kickball-league.vercel.app",
      VERCEL_URL: "kickball-league-abc123.vercel.app",
    });
    expect(env.BETTER_AUTH_URL).toBe("https://kickball-league.vercel.app");
  });

  it("uses each preview's branch address, or its deployment address", () => {
    expect(
      withVercelDefaults({
        ...withoutUrl,
        VERCEL_ENV: "preview",
        VERCEL_BRANCH_URL: "kl-git-15.vercel.app",
      }).BETTER_AUTH_URL,
    ).toBe("https://kl-git-15.vercel.app");
    expect(
      withVercelDefaults({
        ...withoutUrl,
        VERCEL_ENV: "preview",
        VERCEL_URL: "kl-abc.vercel.app",
      }).BETTER_AUTH_URL,
    ).toBe("https://kl-abc.vercel.app");
  });

  it("never overrides an explicit value, and does nothing off Vercel", () => {
    expect(
      withVercelDefaults({
        ...valid,
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "x.vercel.app",
      }).BETTER_AUTH_URL,
    ).toBe("http://localhost:3000");
    expect(withVercelDefaults(withoutUrl).BETTER_AUTH_URL).toBeUndefined();
  });

  it("lets a Vercel deployment pass validation without BETTER_AUTH_URL", () => {
    expect(
      parseEnv({
        ...withoutUrl,
        VERCEL_ENV: "preview",
        VERCEL_URL: "kl-abc.vercel.app",
      }).ok,
    ).toBe(true);
  });
});
