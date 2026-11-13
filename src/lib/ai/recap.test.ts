import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/queries/schedule";
import type { RecapFacts } from "@/domain/ai/recap";
import type { AiUsageId, LeagueId, SeasonId, UserId } from "@/domain/ids";
import { err, ok } from "@/domain/result";
import type { AiAnswer, AiCall } from "@/services/ai";

vi.mock("@/db/queries/ai", () => ({
  reserveAiCall: vi.fn(),
  settleAiCall: vi.fn(),
  saveRecapDraft: vi.fn(),
}));

const queries = await import("@/db/queries/ai");
const { recapWorstCase, tokenBound, writeRecapDraft } = await import("./recap");

const USAGE_ID = "00000000-0000-4000-8000-0000000000aa" as AiUsageId;
const NOW = new Date("2026-11-13T18:00:00Z");
const LINK = "https://league.example.test/seasons/fall-2026/standings";

const FACTS: RecapFacts = {
  season: "Fall 2026",
  gameDay: "Monday, November 9",
  results: [
    {
      teams: ["Kickers", "Sluggers"],
      outcome: "win",
      score: "7–5",
      margin: 2,
      shutout: false,
    },
  ],
  rankings: [
    { rank: 1, team: "Kickers", record: "3–0", movement: 1 },
    { rank: 2, team: "Sluggers", record: "2–1", movement: -1 },
  ],
  streaks: ["Kickers have won 3 straight."],
  newRecords: [],
  gameOfTheWeek: null,
  standingsLink: LINK,
};

const INPUT = {
  leagueId: "00000000-0000-4000-8000-000000000001" as LeagueId,
  seasonId: "00000000-0000-4000-8000-000000000002" as SeasonId,
  day: "2026-11-09",
  facts: FACTS,
  actorId: "00000000-0000-4000-8000-000000000003" as UserId,
};

const USAGE = {
  inputTokens: 3_000,
  outputTokens: 800,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

/** The mocked model: answers with `json`, never reaching the network. */
const model = (json: unknown) =>
  vi
    .fn<AiCall>()
    .mockResolvedValue(
      ok<AiAnswer>({ usage: USAGE, json, stopReason: "end_turn" }),
    );

/** The queries are mocked, so the client is never used. */
const fakeDb = {} as Db;
const txDb = {
  transaction: <T>(body: (tx: Db) => Promise<T>) => body(fakeDb),
};

const deps = (call: AiCall) => ({
  db: fakeDb,
  txDb,
  call,
  model: "claude-opus-5-5" as const,
  now: NOW,
});

beforeEach(() => {
  vi.mocked(queries.reserveAiCall).mockReset().mockResolvedValue(ok(USAGE_ID));
  vi.mocked(queries.settleAiCall).mockReset();
  vi.mocked(queries.saveRecapDraft).mockReset();
});

describe("writeRecapDraft", () => {
  it("reserves the worst case, asks the model, saves the draft and records the real cost", async () => {
    const answer = {
      subject: "Kickers stay perfect",
      body: `Kickers beat Sluggers 7–5 and sit at 3–0.\n${LINK}`,
    };
    const call = model(answer);
    expect(await writeRecapDraft(deps(call), INPUT)).toEqual(ok(answer));

    expect(queries.reserveAiCall).toHaveBeenCalledWith(fakeDb, {
      leagueId: INPUT.leagueId,
      feature: "recap",
      model: "claude-opus-5-5",
      worstCaseMicrodollars: recapWorstCase("claude-opus-5-5"),
      actorId: INPUT.actorId,
      now: NOW,
    });
    const request = call.mock.calls[0]?.[0];
    expect(request?.prompt).toContain('"score": "7–5"');
    expect(request?.maxTokens).toBe(4_000);
    expect(queries.saveRecapDraft).toHaveBeenCalledWith(fakeDb, {
      seasonId: INPUT.seasonId,
      day: "2026-11-09",
      ...answer,
      model: "claude-opus-5-5",
      createdBy: INPUT.actorId,
      now: NOW,
    });
    expect(queries.settleAiCall).toHaveBeenCalledWith(fakeDb, USAGE_ID, {
      usage: USAGE,
      costMicrodollars: 28_000,
      outcome: "accepted",
    });
  });

  it("does not call the model when the budget has no room", async () => {
    vi.mocked(queries.reserveAiCall).mockResolvedValue(err("over_budget"));
    const call = model({});
    expect(await writeRecapDraft(deps(call), INPUT)).toEqual(
      err("over_budget"),
    );
    expect(call).not.toHaveBeenCalled();
    expect(queries.settleAiCall).not.toHaveBeenCalled();
  });

  it("refuses facts too big to send, before reserving anything", async () => {
    const call = model({});
    const huge = { ...FACTS, streaks: ["x".repeat(20_000)] };
    expect(
      await writeRecapDraft(deps(call), { ...INPUT, facts: huge }),
    ).toEqual(err("too_big"));
    expect(queries.reserveAiCall).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
  });

  it("releases the reservation when the API never answers", async () => {
    const call = vi.fn<AiCall>().mockResolvedValue(err("down"));
    expect(await writeRecapDraft(deps(call), INPUT)).toEqual(err("no_answer"));
    expect(queries.settleAiCall).toHaveBeenCalledWith(fakeDb, USAGE_ID, {
      usage: { ...USAGE, inputTokens: 0, outputTokens: 0 },
      costMicrodollars: 0,
      outcome: "failed",
    });
  });

  it("records the cost of an answer it throws away", async () => {
    for (const [json, error] of [
      [null, "no_answer"],
      [{ subject: "Upset!", body: "Sluggers won 9–2." }, "unknown_score"],
    ] as const) {
      vi.mocked(queries.settleAiCall).mockClear();
      expect(await writeRecapDraft(deps(model(json)), INPUT)).toEqual(
        err(error),
      );
      expect(queries.saveRecapDraft).not.toHaveBeenCalled();
      expect(queries.settleAiCall).toHaveBeenCalledWith(fakeDb, USAGE_ID, {
        usage: USAGE,
        costMicrodollars: 28_000,
        outcome: "rejected",
      });
    }
  });
});

describe("tokenBound", () => {
  it("assumes two characters a token, rounded up", () => {
    expect(tokenBound("")).toBe(0);
    expect(tokenBound("abc")).toBe(2);
  });
});
