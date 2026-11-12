/**
 * Minimum-cost assignment (the Hungarian algorithm, in the shortest
 * augmenting path form with potentials), for Stage C1.
 *
 * `cost[row][column]` is the cost of giving `row` to `column`; `Infinity`
 * forbids the pair. Every row gets a distinct column, so there must be at
 * least as many columns as rows. Returns the column for each row, or null
 * when no assignment avoids every forbidden pair. O(rows² × columns).
 */
export function minCostAssignment(
  cost: readonly (readonly number[])[],
): number[] | null {
  const n = cost.length;
  if (n === 0) return [];
  const m = (cost[0] as readonly number[]).length;
  if (cost.some((row) => row.length !== m))
    throw new Error("Every row needs the same number of columns");
  if (n > m) return null;

  // Stand-in for Infinity: more than any assignment of finite costs, so the
  // optimum only uses it when it has to.
  let total = 0;
  for (const row of cost)
    for (const c of row) if (Number.isFinite(c)) total += Math.abs(c);
  const forbidden = 2 * total + 1;
  const at = (i: number, j: number) => {
    const c = (cost[i] as readonly number[])[j] as number;
    return Number.isFinite(c) ? c : forbidden;
  };

  // 1-based, with row/column 0 as the virtual start.
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(m + 1).fill(0);
  const rowOf = new Array<number>(m + 1).fill(0);
  const way = new Array<number>(m + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    rowOf[0] = i;
    let j0 = 0;
    const minv = new Array<number>(m + 1).fill(Infinity);
    const used = new Array<boolean>(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = rowOf[j0] as number;
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const reduced =
          at(i0 - 1, j - 1) - (u[i0] as number) - (v[j] as number);
        if (reduced < (minv[j] as number)) {
          minv[j] = reduced;
          way[j] = j0;
        }
        if ((minv[j] as number) < delta) {
          delta = minv[j] as number;
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          const r = rowOf[j] as number;
          u[r] = (u[r] as number) + delta;
          v[j] = (v[j] as number) - delta;
        } else {
          minv[j] = (minv[j] as number) - delta;
        }
      }
      j0 = j1;
    } while (rowOf[j0] !== 0);
    do {
      const j1 = way[j0] as number;
      rowOf[j0] = rowOf[j1] as number;
      j0 = j1;
    } while (j0 !== 0);
  }

  const columnFor = new Array<number>(n).fill(-1);
  for (let j = 1; j <= m; j++) {
    const r = rowOf[j] as number;
    if (r > 0) columnFor[r - 1] = j - 1;
  }
  const feasible = columnFor.every((j, i) =>
    Number.isFinite((cost[i] as readonly number[])[j]),
  );
  return feasible ? columnFor : null;
}
