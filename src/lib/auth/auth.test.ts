import { beforeAll, describe, expect, it, vi } from "vitest";
import type { auth as Auth } from "./index";
import { claimKeepOffsForNewAccount } from "@/db/queries/keep-off";
import { startWithNewsOff } from "@/db/queries/notifications";
import { allowSignInLink } from "@/db/queries/rate-limit";
import { createProfileForUser } from "./profile";

vi.mock("./profile", () => ({
  createProfileForUser: vi.fn(() => Promise.resolve()),
}));

// Claiming list entries for a new address is a database write.
vi.mock("@/db/queries/keep-off", () => ({
  claimKeepOffsForNewAccount: vi.fn(() => Promise.resolve(0)),
}));

// Starting a new account with league news off is a database write.
vi.mock("@/db/queries/notifications", () => ({
  startWithNewsOff: vi.fn(() => Promise.resolve()),
}));

// The per-inbox count lives in the database; here it always has room
// unless a test says otherwise.
vi.mock("@/db/queries/rate-limit", () => ({
  allowSignInLink: vi.fn(() => Promise.resolve(true)),
}));

let auth: typeof Auth;

beforeAll(async () => {
  // The instance validates the environment when imported. Nothing connects:
  // the Neon HTTP client only opens a connection when a query runs.
  vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");
  vi.stubEnv(
    "BETTER_AUTH_SECRET",
    "test-secret-that-is-at-least-32-characters",
  );
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
  ({ auth } = await import("./index"));
});

const DAY = 24 * 60 * 60;

describe("auth instance", () => {
  it("keeps sessions for 90 days and renews them at most daily", () => {
    expect(auth.options.session?.expiresIn).toBe(90 * DAY);
    expect(auth.options.session?.updateAge).toBe(DAY);
  });

  it("asks for a session confirmed in the last 15 minutes before sensitive actions", () => {
    expect(auth.options.session?.freshAge).toBe(15 * 60);
  });

  it("uses UUIDs, matching the database's uuid keys", () => {
    expect(auth.options.advanced?.database?.generateId).toBe("uuid");
  });

  it("signs in by magic link only: no email-and-password", () => {
    const pluginIds = auth.options.plugins?.map((plugin) => plugin.id);
    expect(pluginIds).toContain("magic-link");
    expect("emailAndPassword" in auth.options).toBe(false);
  });

  it("keeps nextCookies last so Server Actions can set the session cookie", () => {
    expect(auth.options.plugins?.at(-1)?.id).toBe("next-cookies");
  });

  it("creates a profile for the new user after Better Auth creates them", async () => {
    const after = auth.options.databaseHooks?.user?.create?.after;
    expect(after).toBeTypeOf("function");
    if (!after) throw new Error("no user.create.after hook");
    const user: Parameters<typeof after>[0] = {
      id: "8a3c1f9e-0b1d-4c2e-9f3a-5d6e7f8a9b0c",
      email: "new@example.test",
      emailVerified: false,
      name: "New Player",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await after(user);
    expect(createProfileForUser).toHaveBeenCalledWith(
      expect.anything(),
      user.id,
    );
    // League news is opt-in: the new account starts with it off.
    expect(startWithNewsOff).toHaveBeenCalledWith(expect.anything(), user.id);
    // Not-on-my-team entries added for the address before it had an account.
    expect(claimKeepOffsForNewAccount).toHaveBeenCalledWith(
      expect.anything(),
      user.id,
      user.email,
    );
  });

  it("routes magic links through deliverMagicLink (printed outside production)", async () => {
    const plugin = auth.options.plugins?.find((p) => p.id === "magic-link") as
      | {
          options: {
            sendMagicLink: (data: {
              email: string;
              url: string;
            }) => Promise<void>;
          };
        }
      | undefined;
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await plugin!.options.sendMagicLink({
      email: "player@example.com",
      url: "http://x/verify",
    });
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining("http://x/verify"),
    );
    info.mockRestore();
  });

  it("sends nothing once an inbox has had its links for now", async () => {
    const plugin = auth.options.plugins?.find((p) => p.id === "magic-link") as
      | {
          options: {
            sendMagicLink: (data: {
              email: string;
              url: string;
            }) => Promise<void>;
          };
        }
      | undefined;
    vi.mocked(allowSignInLink).mockResolvedValueOnce(false);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await expect(
      plugin!.options.sendMagicLink({
        email: "player@example.test",
        url: "http://x/verify",
      }),
    ).rejects.toMatchObject({ statusCode: 429 });
    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
  });
});
