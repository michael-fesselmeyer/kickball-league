import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoViewAs } from "./demo-view-as";

/**
 * The view-as endpoint inside a real Better Auth instance, with an in-memory
 * database: what the HTTP router exposes, and what it does with demo mode
 * off and on.
 */
async function makeAuth() {
  const db = {
    user: [
      {
        id: "d3e30000-0000-4000-8000-000000000004",
        name: "Addie Admin",
        email: "addie.admin@example.test",
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as Record<string, unknown>[],
    session: [] as Record<string, unknown>[],
    account: [] as Record<string, unknown>[],
    verification: [] as Record<string, unknown>[],
  };
  const auth = betterAuth({
    baseURL: "http://localhost:3000",
    // A placeholder of the required length, not a real value.
    secret: "x".repeat(32),
    database: memoryAdapter(db),
    plugins: [demoViewAs()],
    telemetry: { enabled: false },
  });
  return { auth, db };
}

const DEMO = {
  DEMO_MODE: "true",
  DATABASE_URL: "postgresql://ci:ci@localhost:5432/kb_demo",
};

beforeEach(() => {
  vi.stubEnv("DEMO_MODE", "");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("STRIPE_SECRET_KEY", "");
  vi.stubEnv("DATABASE_URL", DEMO.DATABASE_URL);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("demo view-as endpoint", () => {
  it("is never reachable over HTTP, even in demo mode", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    const { auth, db } = await makeAuth();
    const response = await auth.handler(
      new Request("http://localhost:3000/api/auth/demo/view-as", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ persona: "admin" }),
      }),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(db.session).toHaveLength(0);
  });

  it("refuses with demo mode off and creates no session", async () => {
    const { auth, db } = await makeAuth();
    await expect(
      auth.api.demoViewAs({ body: { persona: "admin" } }),
    ).rejects.toMatchObject({ status: "NOT_FOUND" });
    expect(db.session).toHaveLength(0);
  });

  it("refuses with DEMO_MODE set against a database that is not a demo's", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    vi.stubEnv("DATABASE_URL", "postgresql://ci:ci@localhost:5432/kickball");
    const { auth, db } = await makeAuth();
    await expect(
      auth.api.demoViewAs({ body: { persona: "admin" } }),
    ).rejects.toMatchObject({ status: "NOT_FOUND" });
    expect(db.session).toHaveLength(0);
  });

  it("signs in as the persona with demo mode on, for a few hours", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    const { auth, db } = await makeAuth();
    const { headers, response } = await auth.api.demoViewAs({
      body: { persona: "admin" },
      returnHeaders: true,
    });
    expect(response).toEqual({ landing: "/app/admin/seasons" });
    expect(headers.get("set-cookie")).toMatch(/session_token=/);
    expect(db.session).toHaveLength(1);
    const expiresAt = db.session[0]?.expiresAt as Date;
    expect(expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(
      4 * 60 * 60 * 1000,
    );
  });

  it("refuses anything but a persona key", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    const { auth, db } = await makeAuth();
    await expect(
      auth.api.demoViewAs({ body: { persona: "addie.admin@example.test" } }),
    ).rejects.toMatchObject({ status: "BAD_REQUEST" });
    expect(db.session).toHaveLength(0);
  });

  it("reports missing demo data instead of signing in", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    const { auth, db } = await makeAuth();
    await expect(
      auth.api.demoViewAs({ body: { persona: "ref" } }),
    ).rejects.toMatchObject({ status: "SERVICE_UNAVAILABLE" });
    expect(db.session).toHaveLength(0);
  });
});
