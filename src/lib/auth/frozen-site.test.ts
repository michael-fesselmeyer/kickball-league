import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SiteStatus } from "@/domain/platform/operator";

const OPERATOR = "0b6f2b5e-6a0d-4c1e-9f1a-2d3c4b5a6f70";
const OWNER = "1c7a3c6f-7b1e-4d2f-8a2b-3e4d5c6b7a81";

const state: { status: string; userId: string } = vi.hoisted(() => ({
  status: "active",
  userId: "",
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  notFound: () => {
    throw new Error("not-found");
  },
}));
vi.mock("./index", () => ({
  auth: {
    api: {
      getSession: async () => ({
        user: { id: state.userId },
        session: { createdAt: new Date() },
      }),
    },
  },
}));
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/db/queries/subject", () => ({
  loadSubject: async (_db: unknown, userId: string | null) => ({
    userId,
    globalRole: "owner",
    roster: [],
    isReferee: false,
    refereeGameIds: [],
    sponsorIds: [],
  }),
}));
vi.mock("@/lib/platform/site", () => ({
  currentSite: async () => ({
    leagueId: "league",
    name: "Test League",
    status: state.status,
    disabledFeatures: [],
  }),
  isCurrentOperator: (userId: string | null) => userId === OPERATOR,
}));

const { requirePermission, requirePermissionToChange } =
  await import("./permission");
const act = () =>
  requirePermissionToChange("season.manage", { next: "/app/admin" });

beforeEach(() => {
  state.status = "active";
  state.userId = OWNER;
});

describe("writes while the site is frozen", () => {
  it("lets an owner's Server Action through while the site is active", async () => {
    await expect(act()).resolves.toMatchObject({ userId: OWNER });
  });

  it.each(["read_only", "paused"] satisfies SiteStatus[])(
    "stops an owner's Server Action while %s, before it changes anything",
    async (status) => {
      state.status = status;
      await expect(act()).rejects.toThrow("redirect:/paused");
    },
  );

  it("still lets owners read pages while frozen", async () => {
    state.status = "paused";
    await expect(
      requirePermission("season.manage", { next: "/app/admin" }),
    ).resolves.toMatchObject({ userId: OWNER });
  });

  it("lets the operator act while frozen", async () => {
    state.status = "read_only";
    state.userId = OPERATOR;
    await expect(act()).resolves.toMatchObject({ userId: OPERATOR });
  });
});
