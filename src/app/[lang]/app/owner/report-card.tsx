import { money } from "@/domain/books/ledger";
import {
  change,
  type ReportLine,
  reportLines,
  SECTIONS,
  type SeasonFacts,
  show,
} from "@/domain/dashboard/report-card";
import { Legend, PairBars, SERIES_1, SERIES_2, StackBar } from "./charts";
import { ScrollTable } from "@/components/scroll-table";

const th = "py-2 pr-3 text-left font-normal";
const num = "py-2 pl-3 text-right tabular-nums";
const numHead = `${num} font-normal`;

const TONE = {
  good: "text-success",
  bad: "text-warning",
  neutral: "text-text-muted",
} as const;

/**
 * The season report card: charts drawn on the server with their numbers in
 * tables, then every measure beside the season before with the change in
 * words. `share` leaves out the money, for a version owners show sponsors.
 * Counts and totals only, so neither version names anyone.
 */
export function ReportCard({
  current,
  previous,
  share = false,
}: {
  current: SeasonFacts;
  previous: SeasonFacts | null;
  share?: boolean;
}) {
  const lines = reportLines(current, previous, { share });
  const seasons = previous ? [previous, current] : [current];
  const most = (f: (s: SeasonFacts) => number) =>
    Math.max(0, ...seasons.map(f));

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="at-a-glance" className="flex flex-col gap-4">
        <h2 id="at-a-glance" className="text-h2">
          At a glance
        </h2>
        <Chart
          title="Players"
          caption="Players registered each season, returning and new"
          series={[
            { key: "returning", label: "Returning", className: SERIES_1 },
            { key: "new", label: "New", className: SERIES_2 },
          ]}
          rows={seasons.map((s) => ({
            name: s.name,
            value: `${s.members}`,
            bar: (
              <StackBar
                max={most((x) => x.members)}
                segments={[
                  {
                    label: "Returning",
                    value: s.returning,
                    className: SERIES_1,
                  },
                  { label: "New", value: s.newMembers, className: SERIES_2 },
                ]}
              />
            ),
          }))}
        />
        <Chart
          title="Games"
          caption="Games played and game times rained out each season"
          series={[
            { key: "played", label: "Played", className: SERIES_1 },
            { key: "rained", label: "Rained out", className: SERIES_2 },
          ]}
          rows={seasons.map((s) => ({
            name: s.name,
            value: `${s.gamesPlayed} played, ${s.rainedOut} rained out`,
            bar: (
              <StackBar
                max={most((x) => x.gamesPlayed + x.rainedOut)}
                segments={[
                  {
                    label: "Played",
                    value: s.gamesPlayed,
                    className: SERIES_1,
                  },
                  {
                    label: "Rained out",
                    value: s.rainedOut,
                    className: SERIES_2,
                  },
                ]}
              />
            ),
          }))}
        />
        {!share && (
          <Chart
            title="Money"
            caption="Money in and out each season, from the books"
            series={[
              { key: "in", label: "Money in", className: SERIES_1 },
              { key: "out", label: "Money out", className: SERIES_2 },
            ]}
            rows={seasons.map((s) => ({
              name: s.name,
              value: `${money(s.incomeCents)} in, ${money(s.expenseCents)} out`,
              bar: (
                <PairBars
                  max={most((x) => Math.max(x.incomeCents, x.expenseCents))}
                  bars={[
                    {
                      label: `Money in: ${money(s.incomeCents)}`,
                      value: s.incomeCents,
                      className: SERIES_1,
                    },
                    {
                      label: `Money out: ${money(s.expenseCents)}`,
                      value: s.expenseCents,
                      className: SERIES_2,
                    },
                  ]}
                />
              ),
            }))}
          />
        )}
      </section>

      {SECTIONS.filter((s) => lines.some((l) => l.section === s)).map(
        (section) => (
          <Lines
            key={section}
            section={section}
            lines={lines.filter((l) => l.section === section)}
            currentName={current.name}
            previousName={previous?.name ?? null}
          />
        ),
      )}
    </div>
  );
}

function Chart({
  title,
  caption,
  series,
  rows,
}: {
  title: string;
  caption: string;
  series: Parameters<typeof Legend>[0]["series"];
  rows: { name: string; value: string; bar: React.ReactNode }[];
}) {
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-h3">{title}</figcaption>
      <Legend series={series} />
      <table className="w-full">
        <caption className="sr-only">{caption}</caption>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-t border-border">
              <th scope="row" className={`${th} w-3/5`}>
                <span className="flex flex-col gap-1">
                  {r.name}
                  {r.bar}
                </span>
              </th>
              <td className={num}>{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function Lines({
  section,
  lines,
  currentName,
  previousName,
}: {
  section: string;
  lines: readonly ReportLine[];
  currentName: string;
  previousName: string | null;
}) {
  const id = `section-${section.toLowerCase()}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="text-h2">
        {section}
      </h2>
      <ScrollTable label={`${section} by season`}>
        <table className="w-full">
          <caption className="sr-only">
            {section}: {currentName}
            {previousName ? ` compared with ${previousName}` : ""}
          </caption>
          <thead className="text-small text-text-muted">
            <tr>
              <th scope="col" className={th}>
                Measure
              </th>
              <th scope="col" className={numHead}>
                {currentName}
              </th>
              {previousName && (
                <th scope="col" className={`${numHead} hidden sm:table-cell`}>
                  {previousName}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const c = change(l, previousName);
              return (
                <tr key={l.label} className="border-t border-border">
                  <th scope="row" className={th}>
                    <span className="flex flex-col">
                      {l.label}
                      <span className={`text-small ${TONE[c.tone]}`}>
                        <span aria-hidden="true">{c.arrow} </span>
                        {c.words}
                      </span>
                    </span>
                  </th>
                  <td className={num}>{show(l.kind, l.current)}</td>
                  {previousName && (
                    <td className={`${num} hidden sm:table-cell`}>
                      {show(l.kind, l.previous)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollTable>
    </section>
  );
}
