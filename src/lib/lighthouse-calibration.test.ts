import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  ANCHOR_BENCHMARK_INDEX,
  ANCHOR_SLOWDOWN,
  afterWarmup,
  MAX_SLOWDOWN,
  MIN_SLOWDOWN,
  medianOf,
  reasonOf,
  slowdownFor,
  TARGET_DEVICE_INDEX,
  tooSlowToMeasure,
  waitForUrl,
  withRetries,
  withSlowdown,
  withTimeout,
} from "../../scripts/lighthouse-calibration.mjs";

type Config = {
  ci: {
    collect: { settings: { throttling: { cpuSlowdownMultiplier: number } } };
  };
};
const rc = JSON.parse(readFileSync("lighthouserc.json", "utf8")) as Config;

describe("slowdownFor", () => {
  it("keeps the budgets' phone: the anchor runner gets today's 4x", () => {
    expect(slowdownFor(ANCHOR_BENCHMARK_INDEX)).toBe(ANCHOR_SLOWDOWN);
    expect(rc.ci.collect.settings.throttling.cpuSlowdownMultiplier).toBe(
      ANCHOR_SLOWDOWN,
    );
  });

  it("slows a faster runner more and a slower runner less, in proportion", () => {
    expect(slowdownFor(2400)).toBe(2.78);
    expect(slowdownFor(2950)).toBe(3.42);
    expect(slowdownFor(4200)).toBe(4.87);
    expect(slowdownFor(2400)).toBeLessThan(slowdownFor(3450));
    expect(slowdownFor(4200)).toBeGreaterThan(slowdownFor(3450));
  });

  it("stays inside the sanity limits", () => {
    expect(slowdownFor(100)).toBe(MIN_SLOWDOWN);
    expect(slowdownFor(100_000)).toBe(MAX_SLOWDOWN);
  });

  it("refuses a number that isn't an index", () => {
    expect(() => slowdownFor(Number.NaN)).toThrow();
    expect(() => slowdownFor(0)).toThrow();
    expect(() => slowdownFor(-5)).toThrow();
  });
});

describe("medianOf", () => {
  it("takes the middle sample, so one odd sample doesn't move it", () => {
    expect(medianOf([3400, 900, 3500, 3450, 3300])).toBe(3400);
  });
  it("averages the middle two of an even count", () => {
    expect(medianOf([1, 2, 3, 4])).toBe(2.5);
  });
  it("needs at least one sample", () => {
    expect(() => medianOf([])).toThrow();
  });
});

describe("withSlowdown", () => {
  it("changes the CPU slowdown and nothing else, budgets included", () => {
    const calibrated = withSlowdown(rc, 2.78);
    expect(
      calibrated.ci.collect.settings.throttling.cpuSlowdownMultiplier,
    ).toBe(2.78);
    // Put the original multiplier back and the whole config is identical.
    const restored = withSlowdown(calibrated, ANCHOR_SLOWDOWN);
    expect(restored).toEqual(rc);
  });

  it("does not alter the config it was given", () => {
    withSlowdown(rc, 2);
    expect(rc.ci.collect.settings.throttling.cpuSlowdownMultiplier).toBe(4);
  });
});

describe("withRetries", () => {
  const sleep = vi.fn(async () => {});

  it("returns the first success and retries only after failures", async () => {
    const attempt = vi
      .fn<(n: number) => Promise<number>>()
      .mockRejectedValueOnce(new Error("connect ECONNREFUSED 127.0.0.1:44271"))
      .mockResolvedValueOnce(3450);
    const onRetry = vi.fn();
    sleep.mockClear();

    await expect(
      withRetries(attempt, { tries: 3, delayMs: 2000, onRetry, sleep }),
    ).resolves.toBe(3450);
    expect(attempt.mock.calls).toEqual([[1], [2]]);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(2000);
  });

  it("gives up after the last try with every reason, without a result", async () => {
    const attempt = vi.fn(async (n: number) => {
      throw new Error(`refused ${n}`);
    });
    sleep.mockClear();

    await expect(withRetries(attempt, { tries: 3, sleep })).rejects.toThrow(
      "Failed 3 times (try 1: refused 1; try 2: refused 2; try 3: refused 3)",
    );
    expect(attempt).toHaveBeenCalledTimes(3);
    // No wait after the last try.
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});

describe("waitForUrl", () => {
  it("waits until the port answers", async () => {
    const fetchUrl = vi
      .fn<(url: string) => Promise<{ ok: boolean; status: number }>>()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    await waitForUrl("http://127.0.0.1:9222/json/version", {
      timeoutMs: 1000,
      fetchUrl,
      now: () => 0,
      sleep: async () => {},
    });
    expect(fetchUrl).toHaveBeenCalledTimes(3);
  });

  it("fails with the last reason once the time is up", async () => {
    let clock = 0;
    await expect(
      waitForUrl("http://127.0.0.1:9222/json/version", {
        timeoutMs: 300,
        intervalMs: 100,
        fetchUrl: async () => {
          throw new Error("connect ECONNREFUSED");
        },
        now: () => clock,
        sleep: async (ms) => {
          clock += ms;
        },
      }),
    ).rejects.toThrow(
      "http://127.0.0.1:9222/json/version did not answer within 300 ms (connect ECONNREFUSED)",
    );
  });
});

describe("tooSlowToMeasure", () => {
  it("stops a runner slower than the target phone", () => {
    // The degraded runner that ran a shard out of time.
    expect(tooSlowToMeasure(306)).toBe(true);
    expect(tooSlowToMeasure(TARGET_DEVICE_INDEX - 1)).toBe(true);
  });

  it("measures every runner the phone can be reproduced on", () => {
    expect(tooSlowToMeasure(TARGET_DEVICE_INDEX)).toBe(false);
    // Below the 2x limit but still faster than the phone: measured at 2x.
    expect(tooSlowToMeasure(1200)).toBe(false);
    expect(slowdownFor(1200)).toBe(MIN_SLOWDOWN);
    expect(tooSlowToMeasure(ANCHOR_BENCHMARK_INDEX)).toBe(false);
  });
});

describe("afterWarmup", () => {
  it("drops the cold first sample before the median is taken", () => {
    // The hung shard's samples (run 43943188248): Chrome was still starting.
    const samples = [429, 1936, 3471, 3525, 3468, 3490];
    expect(afterWarmup(samples, 1)).toEqual([1936, 3471, 3525, 3468, 3490]);
    expect(medianOf(afterWarmup(samples, 1))).toBe(3471);
  });

  it("does not alter the samples it was given", () => {
    const samples = [1845, 2625, 2647];
    afterWarmup(samples, 1);
    expect(samples).toEqual([1845, 2625, 2647]);
  });

  it("needs at least one sample after the warm-up", () => {
    expect(() => afterWarmup([1971], 1)).toThrow(
      "Only 1 benchmark samples; 1 are warm-up.",
    );
  });
});

describe("withTimeout", () => {
  it("settles with the promise when it is in time", async () => {
    await expect(
      withTimeout(Promise.resolve(3450), 1000, "late"),
    ).resolves.toBe(3450);
    await expect(
      withTimeout(Promise.reject(new Error("refused")), 1000, "late"),
    ).rejects.toThrow("refused");
  });

  it("rejects once the time is up, after letting the caller clean up", async () => {
    vi.useFakeTimers();
    try {
      const onTimeout = vi.fn();
      const never = new Promise<number>(() => {});
      const result = withTimeout(never, 45_000, "no benchmark within 45 s", {
        onTimeout,
      });
      const settled = expect(result).rejects.toThrow(
        "no benchmark within 45 s",
      );
      await vi.advanceTimersByTimeAsync(45_000);
      await settled;
      expect(onTimeout).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears its timer when the promise settles first", async () => {
    const clearTimer = vi.fn();
    await withTimeout(Promise.resolve(1), 1000, "late", { clearTimer });
    expect(clearTimer).toHaveBeenCalledOnce();
  });
});

describe("reasonOf", () => {
  it("names a failure even when its message is empty", () => {
    // The hung shard logged "Benchmark try 1 of 3 failed ()".
    expect(reasonOf(new Error(""))).toBe("Error");
    expect(reasonOf(new TypeError(""))).toBe("TypeError");
    expect(reasonOf(new Error("connect ECONNREFUSED"))).toBe(
      "connect ECONNREFUSED",
    );
    expect(reasonOf(undefined)).toBe("unknown error");
    expect(reasonOf("closed by peer")).toBe("closed by peer");
  });
});
