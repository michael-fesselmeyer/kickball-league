import { dayHeading, kickoff, shortDay } from "@/domain/schedule/format";
import {
  opponentOf,
  placeLine,
  type PublicGame,
} from "@/domain/schedule/public-game";
import { dark, light, type Theme } from "@/design/tokens";
import { SITE } from "@/lib/site";

/**
 * The schedule widget's page: a whole HTML document with its styles inline
 * and no script, so a sponsor's or team's site that frames it loads one small
 * file (docs/architecture.md, section 3). Every value from the database is
 * escaped. Links open the league's site in a new tab, never inside the frame.
 */

const escapeHtml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const vars = (t: Theme) =>
  `--bg:${t.surface};--text:${t.text};--muted:${t["text-muted"]};--brand:${t.brand};--line:${t.border};--accent:${t.accent}`;

/** System fonts only: a web font would cost more than the whole page. */
const STYLE = `:root{${vars(light)};color-scheme:light dark}@media (prefers-color-scheme:dark){:root{${vars(dark)}}}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}main{padding:12px 14px;border-top:4px solid var(--accent)}h1{margin:0 0 2px;font-size:17px;line-height:1.25}p{margin:0}.sub{color:var(--muted);font-size:13px}ol{list-style:none;margin:8px 0;padding:0}li{padding:8px 0;border-top:1px solid var(--line)}li:first-child{border-top:0}.when{font-weight:700}.where{display:block;color:var(--muted);font-size:13px}a{color:var(--brand);text-underline-offset:2px}a:focus-visible{outline:3px solid var(--brand);outline-offset:2px}.more{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:13px}.more a{display:inline-block;padding:6px 0}`;

function documentHtml(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><base target="_blank"><style>${STYLE}</style></head><body><main>${body}</main></body></html>`;
}

const link = (href: string, text: string) =>
  `<a href="${escapeHtml(href)}" rel="noopener">${escapeHtml(text)}</a>`;

const time = (instant: Date, text: string) =>
  `<time datetime="${instant.toISOString()}">${escapeHtml(text)}</time>`;

const where = (g: PublicGame) => {
  const place = placeLine(g);
  return place ? `<span class="where">${escapeHtml(place)}</span>` : "";
};

const footer = (origin: string, schedule: { href: string; label: string }) =>
  `<p class="more">${link(schedule.href, schedule.label)}${link(`${origin}/`, SITE.name)}</p>`;

/** A team's next games, each against its opponent. */
export function teamWidgetHtml({
  origin,
  team,
  entryId,
  seasonSlug,
  games,
  timeZone,
}: {
  origin: string;
  team: { name: string; slug: string };
  /** The team's entry in the season, to tell its side of each game. */
  entryId: string | null;
  seasonSlug: string | null;
  games: readonly PublicGame[];
  timeZone: string;
}): string {
  const teamUrl = `${origin}/teams/${team.slug}`;
  const items = games
    .map((g) => {
      const start = g.startsAt as Date;
      const other = entryId ? opponentOf(g, entryId) : null;
      const matchup = other
        ? `vs ${escapeHtml(other.name)}`
        : `${escapeHtml(g.teamA.name)} vs ${escapeHtml(g.teamB.name)}`;
      const label = `${shortDay(start, timeZone)}, ${kickoff(start, timeZone)}`;
      return `<li><span class="when">${time(start, label)}</span> ${matchup}${g.kind === "playoff" ? " (playoffs)" : ""}${where(g)}</li>`;
    })
    .join("");
  const body =
    items.length > 0
      ? `<ol>${items}</ol>`
      : `<p class="sub">No games on the schedule right now.</p>`;
  return documentHtml(
    `${team.name}: next games`,
    `<h1>${link(teamUrl, team.name)}</h1><p class="sub">Next games</p>${body}${footer(
      origin,
      {
        href: seasonSlug
          ? `${origin}/seasons/${seasonSlug}/schedule/${team.slug}`
          : teamUrl,
        label: "Full schedule",
      },
    )}`,
  );
}

/** The league's next game day, every game on it. */
export function leagueWidgetHtml({
  origin,
  season,
  day,
  games,
  timeZone,
}: {
  origin: string;
  season: { name: string; slug: string } | null;
  /** The game day as YYYY-MM-DD in the league's time zone. */
  day: string | null;
  games: readonly PublicGame[];
  timeZone: string;
}): string {
  const items = games
    .map((g) => {
      const start = g.startsAt as Date;
      return `<li><span class="when">${time(start, kickoff(start, timeZone))}</span> ${escapeHtml(g.teamA.name)} vs ${escapeHtml(g.teamB.name)}${g.kind === "playoff" ? " (playoffs)" : ""}${where(g)}</li>`;
    })
    .join("");
  const sub =
    day && items.length > 0
      ? `<p class="sub">Next game day: ${escapeHtml(dayHeading(day))}</p><ol>${items}</ol>`
      : `<p class="sub">No games on the schedule right now.</p>`;
  return documentHtml(
    `${SITE.name}: next games`,
    `<h1>${link(`${origin}/`, SITE.name)}</h1>${sub}${footer(
      origin,
      season
        ? {
            href: `${origin}/seasons/${season.slug}/schedule`,
            label: `${season.name} schedule`,
          }
        : { href: `${origin}/`, label: "Seasons" },
    )}`,
  );
}

/** A plain page for a team the widget doesn't know. */
export function notFoundWidgetHtml(origin: string): string {
  return documentHtml(
    `${SITE.name}: schedule`,
    `<h1>${link(`${origin}/`, SITE.name)}</h1><p class="sub">This team isn't on the league's schedule.</p>`,
  );
}

/**
 * Headers for every widget response. Framing is allowed by the route's own
 * Content-Security-Policy (embedHeaders in src/lib/security-headers.ts);
 * caching follows the cached data's PUBLIC_PAGE_LIFE, as for the public pages.
 */
export const WIDGET_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "X-Robots-Tag": "noindex",
} as const;
