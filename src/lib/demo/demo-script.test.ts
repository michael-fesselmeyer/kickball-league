import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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
  it("changes with the code, the day, the address and the branding", () => {
    const key = buildKey(base);
    expect(buildKey({ ...base })).toBe(key);
    for (const change of [
      { commit: "abd" },
      { changes: " M src/app/page.tsx" },
      { day: "2026-11-15" },
      { port: 4101 },
      { brand: "0123456789abcdef" },
    ])
      expect(buildKey({ ...base, ...change })).not.toBe(key);
  });
});

describe("the demo never sees .env files", () => {
  // Every name in the example env file, each given a value that is not the demo's.
  const names = [
    ...new Set(
      (
        readFileSync(".env.example", "utf8").match(
          /^#?\s*[A-Z][A-Z0-9_]*(?==)/gm,
        ) ?? []
      ).map((name) => name.replace(/^#?\s*/, "")),
    ),
  ];
  const probe = `
    const { loadEnvConfig } = require("@next/env");
    const fs = require("node:fs");
    loadEnvConfig(process.cwd(), false, console, true);
    try { process.loadEnvFile(".env.local"); } catch {}
    const out = {};
    for (const [k, v] of Object.entries(process.env)) if (v === "league-real-value") out[k] = v;
    out.readable = fs.existsSync(".env.local");
    console.log(JSON.stringify(out));
  `;
  const run = (env: Record<string, string>) => {
    const dir = mkdtempSync(path.join(tmpdir(), "demo-env-"));
    try {
      writeFileSync(
        path.join(dir, ".env.local"),
        names.map((name) => `${name}=league-real-value`).join("\n"),
      );
      const result = spawnSync(process.execPath, ["-e", probe], {
        cwd: dir,
        encoding: "utf8",
        env: {
          ...env,
          NODE_PATH: path.resolve("node_modules"),
          NODE_ENV: "production",
        },
      });
      return JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const env = demoEnv({
    shell,
    secrets,
    databaseUrl: url,
    port: 4100,
    stripeMockUrl: "http://localhost:12112",
  });

  it("checks a real list of names", () => {
    expect(names).toContain("DATABASE_URL");
    expect(names.length).toBeGreaterThan(10);
  });

  it("is needed: without the preload a forced reload reads .env.local", () => {
    const unguarded = { ...env };
    delete unguarded.NODE_OPTIONS;
    expect(Object.keys(run(unguarded)).length).toBeGreaterThan(5);
  });

  it("lets no name from the example env file reach the demo with another value", () => {
    expect(run(env)).toEqual({ readable: false });
  });
});
