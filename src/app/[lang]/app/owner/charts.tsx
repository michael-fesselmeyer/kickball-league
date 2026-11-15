/**
 * The dashboard's charts, drawn on the server with no script: bars are
 * plain elements sized by percentage inside real tables, so every number a
 * bar shows is also in a cell a screen reader reads, and the week chart is
 * an SVG with the same numbers in a table under it. Two series at most, in
 * the chart tokens (--chart-1, --chart-2), always with a legend and the
 * numbers beside the bars, so color is never the only cue. Each bar has a
 * title, which browsers show on hover.
 */

export type Series = { key: string; label: string; className: string };

export const SERIES_1 = "bg-chart-1";
export const SERIES_2 = "bg-chart-2";

export function Legend({ series }: { series: readonly Series[] }) {
  return (
    <ul
      aria-hidden="true"
      className="flex flex-wrap gap-x-4 gap-y-1 text-small text-text-muted"
    >
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className={`inline-block size-3 rounded-sm ${s.className}`} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/** Percent of `max` as a CSS width, never 0 for a value above 0. */
const width = (value: number, max: number) =>
  max > 0 && value > 0 ? `max(2px, ${(value / max) * 100}%)` : "0";

/**
 * Stacked horizontal bar: the segments side by side, each as wide as its
 * share of `max`, with a 2px gap between fills.
 */
export function StackBar({
  segments,
  max,
}: {
  segments: readonly { label: string; value: number; className: string }[];
  max: number;
}) {
  return (
    <div aria-hidden="true" className="flex h-3 w-full gap-0.5">
      {segments.map((s) =>
        s.value > 0 ? (
          <span
            key={s.label}
            title={`${s.label}: ${s.value}`}
            className={`h-full rounded-sm ${s.className}`}
            style={{ width: width(s.value, max) }}
          />
        ) : null,
      )}
    </div>
  );
}

/** Two bars, one under the other, for comparing two amounts. */
export function PairBars({
  bars,
  max,
}: {
  bars: readonly { label: string; value: number; className: string }[];
  max: number;
}) {
  return (
    <div aria-hidden="true" className="flex w-full flex-col gap-0.5">
      {bars.map((b) => (
        <span
          key={b.label}
          title={b.label}
          className={`h-2.5 rounded-r-sm ${b.className}`}
          style={{ width: width(b.value, max) }}
        />
      ))}
    </div>
  );
}

/** A thin meter for a rate from 0 to 1, with its track. */
export function Meter({ value }: { value: number | null }) {
  return (
    <span
      aria-hidden="true"
      className="block h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
    >
      <span
        className="block h-full rounded-full bg-chart-1"
        style={{ width: value === null ? "0" : `${value * 100}%` }}
      />
    </span>
  );
}

/** A round number at or above `n` for an axis: 1, 2 or 5 times a power of ten. */
export function niceMax(n: number): number {
  if (n <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(n));
  for (const step of [1, 2, 5, 10]) if (step * power >= n) return step * power;
  return 10 * power;
}

/**
 * Columns over time (one series), as an SVG sized to its box. Labels the
 * first week and then every few, so they never collide at phone width.
 */
export function WeekColumns({
  id,
  title,
  weeks,
}: {
  id: string;
  title: string;
  weeks: readonly { label: string; value: number }[];
}) {
  const w = 320;
  const h = 140;
  const left = 28;
  const bottom = 20;
  const top = 8;
  const plotW = w - left - 4;
  const plotH = h - bottom - top;
  const max = niceMax(Math.max(0, ...weeks.map((x) => x.value)));
  const step = weeks.length > 0 ? plotW / weeks.length : plotW;
  const bar = Math.max(2, step - 2);
  const every = Math.max(1, Math.ceil(weeks.length / 4));
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-labelledby={`${id}-title`}
      className="h-auto w-full text-text-muted"
    >
      <title id={`${id}-title`}>{title}</title>
      {[0, max / 2, max].map((tick) => {
        const y = top + plotH - (tick / max) * plotH;
        return (
          <g key={tick}>
            <line
              x1={left}
              x2={w - 4}
              y1={y}
              y2={y}
              className="stroke-border"
              strokeWidth={1}
            />
            <text
              x={left - 4}
              y={y + 3}
              textAnchor="end"
              className="fill-current text-[10px]"
            >
              {tick}
            </text>
          </g>
        );
      })}
      {weeks.map((x, i) => {
        const bh = (x.value / max) * plotH;
        const bx = left + i * step + 1;
        const by = top + plotH - bh;
        const r = Math.min(4, bh / 2, bar / 2);
        return (
          <g key={x.label}>
            {x.value > 0 && (
              <path
                d={`M${bx},${top + plotH} V${by + r} Q${bx},${by} ${bx + r},${by} H${bx + bar - r} Q${bx + bar},${by} ${bx + bar},${by + r} V${top + plotH} Z`}
                className="fill-chart-1"
              >
                <title>{`Week of ${x.label}: ${x.value}`}</title>
              </path>
            )}
            {i % every === 0 && (
              <text x={bx} y={h - 6} className="fill-current text-[10px]">
                {x.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
