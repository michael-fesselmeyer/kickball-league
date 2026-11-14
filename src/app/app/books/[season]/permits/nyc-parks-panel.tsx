/**
 * "How NYC Parks permits work": the rules owners need when they apply, from
 * NYC Parks' own pages. Static: when the rules change, update this panel and
 * docs/permits/nyc-parks.md together, with the new date.
 */

export const NYC_PARKS_LAST_CHECKED = "2026-11-14";

const PARKS = "https://www.nycgovparks.org";
export const NYC_PARKS_LINKS = {
  apply: `${PARKS}/permits/field-and-court/request`,
  priorities: `${PARKS}/permits/field-and-court/request/priorities`,
  guidelines: `${PARKS}/permits/field-and-court/request/rules`,
  contact: `${PARKS}/permits/field-and-court/contact`,
  rule: `${PARKS}/rules/section-2-12`,
  rules: `${PARKS}/rules`,
  map: `${PARKS}/permits/field-and-court/map`,
  mccarren: `${PARKS}/permits/field-and-court/issued/B058`,
  sound: `${PARKS}/permits/special-events/guide`,
  notices: `${PARKS}/news/notices`,
} as const;

const SEASONS = [
  {
    season: "Spring and summer (Apr 1 – Aug 31)",
    renewal: "Nov 15 – Dec 14",
    fresh: "Dec 30 – Jan 30",
  },
  {
    season: "Fall (Sep 1 – Nov 30)",
    renewal: "Apr 15 – May 14",
    fresh: "May 30 – Jun 30",
  },
  {
    season: "Winter (Dec 1 – Mar 31)",
    renewal: "Sep 15 – Oct 14",
    fresh: "Oct 21 – Nov 8",
  },
] as const;

const FEES = [
  ["Synthetic turf, large or full field", "$41"],
  ["Synthetic turf, multipurpose", "$28"],
  ["Natural grass", "$24"],
  ["Hard top", "$20"],
  ["Field lights, on top of the field fee", "$15"],
] as const;

function Source({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} className="underline" rel="noopener noreferrer">
      {children}
    </a>
  );
}

const dateText = (on: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${on}T12:00:00Z`));

export function NycParksPanel() {
  const L = NYC_PARKS_LINKS;
  return (
    <section
      aria-labelledby="nyc-parks"
      className="flex flex-col gap-4 rounded-lg border border-border p-4"
    >
      <h2 id="nyc-parks" className="text-h2">
        How NYC Parks permits work
      </h2>
      <p className="text-small text-text-muted">
        From NYC Parks&rsquo; own pages, last checked{" "}
        {dateText(NYC_PARKS_LAST_CHECKED)}. Check the links before you apply:
        the rules and fees can change.
      </p>

      <details className="group">
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold">
          When to apply
        </summary>
        <div className="flex flex-col gap-2 pt-2">
          <p>
            Apply online in the{" "}
            <Source href={L.apply}>Field and Court Requests system</Source>, to
            the borough office for the park, at least 7 days before the first
            date. Each season has a renewal period for returning permit holders,
            then a period for new requests, then first come, first served.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-small">
              <caption className="sr-only">
                NYC Parks application periods by season
              </caption>
              <thead>
                <tr className="border-b-2 border-border-strong">
                  <th scope="col" className="py-2 pr-3">
                    To play in
                  </th>
                  <th scope="col" className="py-2 pr-3">
                    Renewals
                  </th>
                  <th scope="col" className="py-2">
                    New requests
                  </th>
                </tr>
              </thead>
              <tbody>
                {SEASONS.map((s) => (
                  <tr key={s.season} className="border-b border-border">
                    <th scope="row" className="py-2 pr-3 font-normal">
                      {s.season}
                    </th>
                    <td className="py-2 pr-3">{s.renewal}</td>
                    <td className="py-2">{s.fresh}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-small">
            Source:{" "}
            <Source href={L.priorities}>Requesting a field permit</Source> and{" "}
            <Source href={L.rule}>Parks rule 2-12</Source>.
          </p>
        </div>
      </details>

      <details>
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold">
          Why the fall has less room
        </summary>
        <ul className="flex list-disc flex-col gap-2 pt-2 pl-5">
          <li>
            Multi-use fields go to bat-and-ball sports in spring and summer, but
            to soccer, football and lacrosse in the fall. Kickball gets one in
            the fall only if no soccer or football league asked for it.
          </li>
          <li>
            Youth game requests are handled before any adult ones, and school
            leagues can get weekday fields from 3 to 6 pm first.
          </li>
          <li>
            Parks can hold field time back for maintenance, and no grass
            ballfields are open from December 1 to March 16.
          </li>
          <li>
            It gets dark early: about 7:30 pm on September 1, 6:40 pm by the end
            of September and 4:30 pm in late November, so weeknight games need a
            lit field. Few fields have lights, and portable lights aren&rsquo;t
            allowed.
          </li>
        </ul>
        <p className="pt-2 text-small">
          Source: <Source href={L.priorities}>Requesting a field permit</Source>
          , <Source href={L.rule}>Parks rule 2-12</Source> and{" "}
          <Source href={L.guidelines}>field guidelines</Source>.
        </p>
      </details>

      <details>
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold">
          Keeping the same fields next year
        </summary>
        <div className="flex flex-col gap-2 pt-2">
          <p>
            A returning adult league that followed the rules gets first claim on
            the same dates and times if it asks during the renewal or
            new-request period. Asking for more hours or more fields makes the
            extra a new request. Permits issued after those periods can&rsquo;t
            be renewed, and one holder can renew at most 50 hours a week.
          </p>
          <p className="text-small">
            Source: <Source href={L.rule}>Parks rule 2-12</Source>.
          </p>
        </div>
      </details>

      <details>
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold">
          Fees and insurance
        </summary>
        <div className="flex flex-col gap-2 pt-2">
          <table className="w-full text-left text-small">
            <caption className="sr-only">
              NYC Parks hourly fees for adult groups
            </caption>
            <thead>
              <tr className="border-b-2 border-border-strong">
                <th scope="col" className="py-2 pr-3">
                  Adult groups, per hour
                </th>
                <th scope="col" className="py-2 text-right">
                  Fee
                </th>
              </tr>
            </thead>
            <tbody>
              {FEES.map(([what, fee]) => (
                <tr key={what} className="border-b border-border">
                  <th scope="row" className="py-2 pr-3 font-normal">
                    {what}
                  </th>
                  <td className="py-2 text-right">{fee}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            Fees are due 14 days before the season starts. With more than 50
            permit hours in a season, the league needs general liability
            insurance of $1,000,000 per occurrence and $2,000,000 in aggregate,
            naming the City of New York as additional insured, with a
            certificate and a notarized broker&rsquo;s form.
          </p>
          <p className="text-small">
            Source:{" "}
            <Source href={L.priorities}>Requesting a field permit</Source> and{" "}
            <Source href={L.rule}>Parks rule 2-12</Source>.
          </p>
        </div>
      </details>

      <details>
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold">
          At the field
        </summary>
        <ul className="flex list-disc flex-col gap-2 pt-2 pl-5">
          <li>
            Have the permit with you; a copy on a phone counts. The league
            answers for its players and spectators.
          </li>
          <li>
            No drinking: alcohol isn&rsquo;t allowed in parks unless Parks says
            so, and glass bottles are banned.
          </li>
          <li>
            Speakers need a sound permit from the local NYPD precinct ($45,
            filed in person at least 5 days ahead), and Parks allows amplified
            sound only in some parks.
          </li>
          <li>
            Leave no litter; one banner on the fence during the game is fine. No
            selling without a separate Parks authorization.
          </li>
          <li>
            Unused permit time can be taken away, and breaking the rules can
            cost the league all its permits. Call the borough office ahead if
            the league can&rsquo;t use a date.
          </li>
        </ul>
        <p className="pt-2 text-small">
          Source: <Source href={L.guidelines}>field guidelines</Source>,{" "}
          <Source href={L.rules}>Parks rules</Source> and{" "}
          <Source href={L.sound}>special event guide</Source>.
        </p>
      </details>

      <details>
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold">
          Rain and refunds
        </summary>
        <div className="flex flex-col gap-2 pt-2">
          <p>
            Parks can cancel permitted play for bad weather or to protect a
            field, and gives no credits or refunds, for that or for unused time.
            Closures are posted on the{" "}
            <Source href={L.notices}>notices page</Source>.
          </p>
          <p className="text-small">
            Source: <Source href={L.rule}>Parks rule 2-12</Source> and{" "}
            <Source href={L.guidelines}>field guidelines</Source>.
          </p>
        </div>
      </details>

      <div className="flex flex-col gap-1">
        <h3 className="text-h3">Brooklyn permit office</h3>
        <p>
          Litchfield Villa, 95 Prospect Park West, Brooklyn, NY 11215.{" "}
          <a href="tel:+17189658975" className="underline">
            (718) 965-8975
          </a>
          .
        </p>
        <p className="text-small">
          See{" "}
          <Source href={L.mccarren}>
            McCarren Park&rsquo;s permits this season
          </Source>{" "}
          and the <Source href={L.map}>field availability map</Source>. Source:{" "}
          <Source href={L.contact}>permit office contacts</Source>.
        </p>
      </div>
    </section>
  );
}
