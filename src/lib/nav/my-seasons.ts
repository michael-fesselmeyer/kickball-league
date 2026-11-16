import { cache } from "react";
import { db } from "@/db/client";
import { myCurrentSeasons } from "@/db/queries/registration";
import type { LeagueId, UserId } from "@/domain/ids";

/**
 * This person's current seasons in the league on show, with their team.
 * The app's navigation and the home page both need it; React's `cache`
 * makes that one query per render.
 */
export const mySeasons = cache((userId: UserId, leagueId: LeagueId | null) =>
  myCurrentSeasons(db, userId, leagueId),
);
