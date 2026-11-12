import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { minCostAssignment } from "./assignment";

const total = (cost: number[][], columns: number[]) =>
  columns.reduce((sum, j, i) => sum + (cost[i]?.[j] ?? NaN), 0);

/** The cheapest finite total over every assignment, or null if none. */
function bruteForce(cost: number[][]): number | null {
  const m = cost[0]?.length ?? 0;
  let best: number | null = null;
  const used = new Array<boolean>(m).fill(false);
  const visit = (row: number, sum: number) => {
    if (row === cost.length) {
      if (best === null || sum < best) best = sum;
      return;
    }
    for (let j = 0; j < m; j++) {
      const c = cost[row]?.[j] ?? Infinity;
      if (used[j] || !Number.isFinite(c)) continue;
      used[j] = true;
      visit(row + 1, sum + c);
      used[j] = false;
    }
  };
  visit(0, 0);
  return best;
}

describe("minCostAssignment", () => {
  it("solves a square example", () => {
    const cost = [
      [4, 1, 3],
      [2, 0, 5],
      [3, 2, 2],
    ];
    expect(minCostAssignment(cost)).toEqual([1, 0, 2]);
  });

  it("leaves extra columns unused", () => {
    expect(minCostAssignment([[5, 1, 9, 2]])).toEqual([1]);
  });

  it("avoids forbidden pairs, and reports when it cannot", () => {
    expect(
      minCostAssignment([
        [Infinity, 1],
        [0, Infinity],
      ]),
    ).toEqual([1, 0]);
    expect(
      minCostAssignment([
        [1, Infinity],
        [2, Infinity],
      ]),
    ).toBeNull();
  });

  it("handles no rows, too many rows, and ragged input", () => {
    expect(minCostAssignment([])).toEqual([]);
    expect(minCostAssignment([[1], [2]])).toBeNull();
    expect(() => minCostAssignment([[1, 2], [3]])).toThrow();
  });

  it("matches brute force on small matrices", () => {
    const matrix = fc
      .record({
        rows: fc.integer({ min: 1, max: 5 }),
        extra: fc.integer({ min: 0, max: 2 }),
      })
      .chain(({ rows, extra }) =>
        fc.array(
          fc.array(
            fc.oneof(
              { weight: 5, arbitrary: fc.integer({ min: -20, max: 50 }) },
              { weight: 1, arbitrary: fc.constant(Infinity) },
            ),
            { minLength: rows + extra, maxLength: rows + extra },
          ),
          { minLength: rows, maxLength: rows },
        ),
      );
    fc.assert(
      fc.property(matrix, (cost) => {
        const columns = minCostAssignment(cost);
        const best = bruteForce(cost);
        if (best === null) {
          expect(columns).toBeNull();
          return;
        }
        expect(columns).not.toBeNull();
        expect(new Set(columns).size).toBe(cost.length);
        expect(total(cost, columns as number[])).toBe(best);
      }),
      { numRuns: 1000 },
    );
  });
});
