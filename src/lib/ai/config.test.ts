import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LeagueId } from "@/domain/ids";

const env: { ANTHROPIC_API_KEY?: string; AI_MODEL?: string } = {};
vi.mock("@/env", () => ({ env }));
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/db/queries/ai", () => ({
  aiBudget: vi.fn(),
  monthSpend: vi.fn(),
}));
vi.mock("@/lib/platform/site", () => ({ featureEnabled: vi.fn() }));

const queries = await import("@/db/queries/ai");
const site = await import("@/lib/platform/site");
const { aiConfig, recapAvailability } = await import("./config");

const NOW = new Date("2026-11-13T18:00:00Z");
const LEAGUE = "00000000-0000-4000-8000-000000000001" as LeagueId;

beforeEach(() => {
  delete env.ANTHROPIC_API_KEY;
  delete env.AI_MODEL;
  vi.mocked(site.featureEnabled).mockReset().mockResolvedValue(true);
  vi.mocked(queries.aiBudget)
    .mockReset()
    .mockResolvedValue({ leagueId: LEAGUE, budgetCents: 500 });
  vi.mocked(queries.monthSpend).mockReset().mockResolvedValue(0);
});

describe("aiConfig", () => {
  it("is null without a key", () => {
    expect(aiConfig()).toBeNull();
  });

  it("uses the configured model, or the default", () => {
    env.ANTHROPIC_API_KEY = "sk-ant-test-0000";
    expect(aiConfig()?.model).toBe("claude-opus-5-5");
    env.AI_MODEL = "claude-haiku-5-5";
    expect(aiConfig()?.model).toBe("claude-haiku-5-5");
  });
});

describe("recapAvailability", () => {
  it("is hidden without a key, without asking the database", async () => {
    expect(await recapAvailability(NOW)).toEqual({ kind: "hidden" });
    expect(queries.aiBudget).not.toHaveBeenCalled();
  });

  it("is hidden while the operator has the feature off", async () => {
    env.ANTHROPIC_API_KEY = "sk-ant-test-0000";
    vi.mocked(site.featureEnabled).mockResolvedValue(false);
    expect(await recapAvailability(NOW)).toEqual({ kind: "hidden" });
    expect(site.featureEnabled).toHaveBeenCalledWith("ai");
  });

  it("is hidden when there is no league yet", async () => {
    env.ANTHROPIC_API_KEY = "sk-ant-test-0000";
    vi.mocked(queries.aiBudget).mockResolvedValue(null);
    expect(await recapAvailability(NOW)).toEqual({ kind: "hidden" });
  });

  it("is ready with room in the budget, and off when it is spent", async () => {
    env.ANTHROPIC_API_KEY = "sk-ant-test-0000";
    vi.mocked(queries.monthSpend).mockResolvedValue(70_000);
    expect(await recapAvailability(NOW)).toEqual({
      kind: "ready",
      spentMicrodollars: 70_000,
      budgetMicrodollars: 5_000_000,
    });
    expect(queries.monthSpend).toHaveBeenCalledWith({}, LEAGUE, NOW);

    vi.mocked(queries.monthSpend).mockResolvedValue(4_950_000);
    expect(await recapAvailability(NOW)).toMatchObject({
      kind: "over_budget",
      resumesOn: new Date("2026-12-01T00:00:00Z"),
    });
  });
});
