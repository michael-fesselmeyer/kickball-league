import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { booksSeasons } from "@/db/queries/books";
import { currentLeague } from "@/db/queries/seasons";

/**
 * The league and the season a books screen is about, from the path. Call
 * after the permission check. Unknown seasons are a 404.
 */
export async function booksSeason(slug: string) {
  const league = await currentLeague(db);
  if (!league) notFound();
  const seasons = await booksSeasons(db, league.id);
  const season = seasons.find((s) => s.slug === slug);
  if (!season) notFound();
  return { league, season, seasons };
}

/** The newest season's slug, where /app/books and its links land. */
export async function newestSeasonSlug(): Promise<string | null> {
  const league = await currentLeague(db);
  if (!league) return null;
  return (await booksSeasons(db, league.id))[0]?.slug ?? null;
}

/** A form's text field, trimmed; "" when missing. */
export const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
};

/** A form's file, or null when none was chosen. */
export const upload = (form: FormData, name: string): File | null => {
  const value = form.get(name);
  return value instanceof File && value.size > 0 ? value : null;
};
