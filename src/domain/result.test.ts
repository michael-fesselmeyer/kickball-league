import { describe, expect, expectTypeOf, it } from "vitest";
import { err, ok, type Result } from "./result";

type RosterFailure = { kind: "team_full"; max: number };

const addPlayer = (size: number, max: number): Result<number, RosterFailure> =>
  size < max ? ok(size + 1) : err({ kind: "team_full", max });

describe("Result", () => {
  it("carries the value on success", () => {
    expect(addPlayer(11, 20)).toEqual({ ok: true, value: 12 });
  });

  it("carries a named failure instead of throwing", () => {
    expect(addPlayer(20, 20)).toEqual({
      ok: false,
      error: { kind: "team_full", max: 20 },
    });
  });

  it("narrows on the ok flag", () => {
    const result = addPlayer(20, 20);
    if (result.ok) {
      expectTypeOf(result.value).toEqualTypeOf<number>();
    } else {
      expectTypeOf(result.error).toEqualTypeOf<RosterFailure>();
    }
  });
});
