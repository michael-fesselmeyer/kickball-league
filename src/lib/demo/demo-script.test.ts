import { describe, expect, it } from "vitest";
import { envSchema } from "@/lib/env";
import { demoStatus } from "./guard";
import { demoCheckoutOn } from "./checkout";
import {
  buildKey,
  databaseUrl,
  demoEnv,
  demoSecrets,
  formatEnvFile,
  parseEnvFile,
} from "../../../scripts/demo-lib.mjs";

const shell = {
  PATH: "/usr/bin",
  HOME: "/home/someone",
  RESEND_API_KEY: "re_from_the_shell",
  GOOGLE_CLIENT_ID: "from-the-shell",
  DATABASE_URL: "postgresql://u:p@localhost:5432/league",
};
const secrets = demoSecrets();
const url = databaseUrl({ host: "127.0.0.1", port: 55432, password: "pw" });

describe("demoSecrets", () => {
  it("makes every secret once and keeps the saved ones", () => {
    expect(demoSecrets(secrets)).toEqual(secrets);
    expect(demoSecrets().AUTH_SECRET).not.toBe(secrets.AUTH_SECRET);
  });

  it("survives the trip through its file", () => {
    expect(parseEnvFile(formatEnvFile(secrets))).toEqual(secrets);
  });
});

describe("demoEnv", () => {
  const withMock = demoEnv({
    shell,
    secrets,
    databaseUrl: url,
    port: 4100,
    stripeMockUrl: "http://localhost:12112",
  });

  it("passes the app's own checks and turns demo mode on", () => {
    expect(envSchema.safeParse(withMock).success).toBe(true);
    expect(demoStatus(withMock)).toEqual({ on: true });
    expect(demoCheckoutOn(withMock)).toBe(true);
  });

  it("keeps the shell's and .env.local's keys out", () => {
    expect(withMock.RESEND_API_KEY).toBeUndefined();
    expect(withMock.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(withMock.DATABASE_URL).toBe(url);
    expect(withMock.PATH).toBe("/usr/bin");
    expect(withMock.__NEXT_PROCESSED_ENV).toBe("true");
  });

  it("leaves payments off without stripe-mock", () => {
    const without = demoEnv({
      shell,
      secrets,
      databaseUrl: url,
      port: 4100,
      stripeMockUrl: null,
    });
    expect(without.STRIPE_SECRET_KEY).toBeUndefined();
    expect(demoCheckoutOn(without)).toBe(false);
    expect(envSchema.safeParse(without).success).toBe(true);
  });
});

describe("buildKey", () => {
  const base = {
    commit: "abc",
    changes: "",
    day: "2026-11-14",
    port: 4100,
    database: url,
  };
  it("changes with the code, the day and the address", () => {
    const key = buildKey(base);
    expect(buildKey({ ...base })).toBe(key);
    for (const change of [
      { commit: "abd" },
      { changes: " M src/app/page.tsx" },
      { day: "2026-11-15" },
      { port: 4101 },
    ])
      expect(buildKey({ ...base, ...change })).not.toBe(key);
  });
});
