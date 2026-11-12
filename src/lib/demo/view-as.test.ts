import { describe, expect, it, vi } from "vitest";
import { PERSONA_EMAILS, PERSONA_KEYS, isPersonaKey } from "./personas";
import { viewAsPersona } from "./view-as";

const on = {
  DEMO_MODE: "true",
  DATABASE_URL: "postgresql://ci:ci@localhost:5432/kb_demo",
};

type User = { id: string; email: string };

function fakes(users: User[] = []) {
  return {
    findUserByEmail: vi.fn(
      async (email: string) => users.find((u) => u.email === email) ?? null,
    ),
    startSession: vi.fn<(user: User) => Promise<void>>(async () => {}),
  };
}

const admin = { id: "admin-id", email: "addie.admin@example.test" };

describe("viewAsPersona with demo mode off", () => {
  it.each([
    {},
    { ...on, DEMO_MODE: "false" },
    { ...on, DATABASE_URL: "postgresql://ci:ci@localhost:5432/kickball" },
    {
      ...on,
      VERCEL_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: "kickball-league.vercel.app",
    },
  ])(
    "refuses without looking anyone up or starting a session (%o)",
    async (env) => {
      const deps = fakes([admin]);
      const result = await viewAsPersona(env, "admin", deps);
      expect(result).toEqual({
        ok: false,
        error: { kind: "off", reason: expect.any(String) },
      });
      expect(deps.findUserByEmail).not.toHaveBeenCalled();
      expect(deps.startSession).not.toHaveBeenCalled();
    },
  );
});

describe("viewAsPersona with demo mode on", () => {
  it("signs in as the persona and says where to go", async () => {
    const deps = fakes([admin]);
    const result = await viewAsPersona(on, "admin", deps);
    expect(result).toEqual({
      ok: true,
      value: { landing: "/app/admin/seasons" },
    });
    expect(deps.startSession).toHaveBeenCalledExactlyOnceWith(admin);
  });

  it.each([
    "owner",
    "toString",
    "__proto__",
    "addie.admin@example.test",
    "",
    null,
    undefined,
    42,
  ])("refuses anything but a persona key (%j)", async (persona) => {
    const deps = fakes([admin]);
    const result = await viewAsPersona(on, persona, deps);
    expect(result).toEqual({ ok: false, error: { kind: "unknown_persona" } });
    expect(deps.startSession).not.toHaveBeenCalled();
  });

  it("refuses when the demo data has not been seeded", async () => {
    const deps = fakes([]);
    const result = await viewAsPersona(on, "player", deps);
    expect(result).toEqual({ ok: false, error: { kind: "missing_persona" } });
    expect(deps.startSession).not.toHaveBeenCalled();
  });

  it("never signs in as an account on another address", async () => {
    const deps = {
      findUserByEmail: vi.fn(async () => ({
        id: "x",
        email: "someone@example.test",
      })),
      startSession: vi.fn(async () => {}),
    };
    const result = await viewAsPersona(on, "player", deps);
    expect(result.ok).toBe(false);
    expect(deps.startSession).not.toHaveBeenCalled();
  });
});

describe("personas", () => {
  it("are a player, a captain, a ref and an admin", () => {
    expect(PERSONA_KEYS).toEqual(["player", "captain", "ref", "admin"]);
  });

  it("use invented addresses on the reserved example.test domain", () => {
    for (const email of PERSONA_EMAILS)
      expect(email).toMatch(/^[a-z.]+@example\.test$/);
    expect(new Set(PERSONA_EMAILS).size).toBe(PERSONA_EMAILS.length);
  });

  it("are chosen by key only", () => {
    expect(isPersonaKey("ref")).toBe(true);
    expect(isPersonaKey("constructor")).toBe(false);
    expect(isPersonaKey({})).toBe(false);
  });
});
