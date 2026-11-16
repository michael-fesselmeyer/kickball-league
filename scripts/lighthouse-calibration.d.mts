// Types for scripts/lighthouse-calibration.mjs, which node runs as plain JavaScript.

export declare const ANCHOR_BENCHMARK_INDEX: number;
export declare const ANCHOR_SLOWDOWN: number;
export declare const TARGET_DEVICE_INDEX: number;
export declare const MIN_SLOWDOWN: number;
export declare const MAX_SLOWDOWN: number;
export declare function medianOf(values: number[]): number;
export declare function slowdownFor(benchmarkIndex: number): number;
export declare function withSlowdown<T extends { ci: { collect: object } }>(
  config: T,
  slowdown: number,
): T;
