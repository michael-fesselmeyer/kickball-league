import { beforeEach, describe, expect, it, vi } from "vitest";

const transaction = vi.fn();
const redirect = vi.fn((to: string) => {
  throw new Error(`redirect:${to}`);
});

vi.mock("next/navigation", () => ({ redirect, notFound: vi.fn() }));
vi.mock("@/db/client", () => ({ db: {}, txDb: { transaction } }));
vi.mock("@/db/queries/events", () => ({
  eventBySlug: vi.fn(async () => ({ id: "e", leagueId: "l" })),
}));
vi.mock("@/db/queries/tournaments", () => ({
  removeGuestTeam: vi.fn(),
  saveTournament: vi.fn(),
  drawBracket: vi.fn(),
  resetBracket: vi.fn(),
  updateBracketGame: vi.fn(),
}));
vi.mock("@/lib/auth/permission", () => ({
  requirePermissionToChange: vi.fn(async () => ({ userId: "u" })),
}));
vi.mock("@/lib/league/active", () => ({
  activeLeague: vi.fn(async () => ({ id: "l" })),
  activeLeagueId: vi.fn(async () => "l"),
}));
vi.mock("@/lib/public-cache", () => ({
  refreshEventPages: vi.fn(),
  refreshFriendPages: vi.fn(),
}));

describe("removeGuestTeamAction", () => {
  beforeEach(() => transaction.mockClear());

  it("turns a malformed team id away before any query runs", async () => {
    const { removeGuestTeamAction } = await import("./tournament-actions");
    await expect(
      removeGuestTeamAction("harbor-cup", "not-a-uuid'; drop table x;--"),
    ).rejects.toThrow(
      "redirect:/app/admin/events/harbor-cup?tournamentError=no_team",
    );
    expect(transaction).not.toHaveBeenCalled();
  });
});
