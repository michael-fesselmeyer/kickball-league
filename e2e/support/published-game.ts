import { Client } from "pg";

/**
 * A game on Summer 2026's published schedule tomorrow at 6 pm, league time,
 * for flows that need a game day still to come. Summer 2026 is over and no
 * other flow publishes a new version of it, so the game stays on the
 * published schedule for the whole flow. Returns the game, its day
 * (YYYY-MM-DD), a seeded player on its first team, and `remove`, which
 * deletes the game, its slot and any status set for the day.
 */
export async function addPublishedGameTomorrow(): Promise<{
  gameId: string;
  date: string;
  teams: string;
  playerEmail: string;
  remove: () => Promise<void>;
}> {
  const row = await withDb(async (db) => {
    const { rows } = await db.query<{
      game: string;
      slot: string;
      day: string;
      teams: string;
      email: string;
      season: string;
    }>(
      `with s as (
         select s.id, s.league_id, l.timezone from season s
           join league l on l.id = s.league_id
          where s.slug = 'summer-2026'
       ), entries as (
         select ts.id, t.name,
                exists (
                  select 1 from roster_membership rm
                   where rm.team_season_id = ts.id and rm.status = 'active'
                ) as has_player
           from team_season ts
           join team t on t.id = ts.team_id
          where ts.season_id = (select id from s)
       ),
       -- The first team has a player on its active roster, to sign in.
       a as (
         select id, name from entries
          order by has_player desc, name limit 1
       ),
       b as (
         select id, name from entries
          where id <> (select id from a) order by name limit 1
       ),
       v as (
         select id from schedule_version
          where season_id = (select id from s) and status = 'published'
       ), f as (
         select f.id from field f join venue ve on ve.id = f.venue_id
          where ve.league_id = (select league_id from s)
          order by f.name limit 1
       ), t as (
         select (date_trunc('day', now() at time zone timezone)
                   + interval '1 day 18 hours') at time zone timezone
                  as starts_at,
                to_char(date_trunc('day', now() at time zone timezone)
                          + interval '1 day', 'YYYY-MM-DD') as day
           from s
       ), new_slot as (
         insert into slot (season_id, field_id, starts_at, ends_at, time_index)
         select (select id from s), (select id from f), starts_at,
                starts_at + interval '1 hour', 0
           from t
         returning id
       ), new_game as (
         insert into game (season_id, team_a_id, team_b_id, kind, slot_id)
         select (select id from s), (select id from a), (select id from b),
                'regular', (select id from new_slot)
         returning id, slot_id
       ), placed as (
         insert into game_placement (schedule_version_id, game_id, slot_id)
         select (select id from v), id, slot_id from new_game
         returning game_id, slot_id
       )
       select placed.game_id as game, placed.slot_id as slot,
              (select day from t) as day,
              (select name from a) || ' vs ' || (select name from b) as teams,
              (select u.email from roster_membership rm
                 join registration r on r.id = rm.registration_id
                 join "user" u on u.id = r.user_id
                where rm.team_season_id = (select id from a)
                  and rm.status = 'active'
                order by u.email limit 1) as email,
              (select id from s) as season
         from placed`,
    );
    const [found] = rows;
    if (!found) throw new Error("Could not add a Summer 2026 game tomorrow");
    if (!found.email)
      throw new Error("No Summer 2026 team has a player to sign in");
    return found;
  });
  return {
    gameId: row.game,
    date: row.day,
    teams: row.teams,
    playerEmail: row.email,
    remove: () =>
      withDb(async (db) => {
        await db.query(
          "delete from game_day_status where season_id = $1 and date = $2",
          [row.season, row.day],
        );
        await db.query("delete from game_placement where game_id = $1", [
          row.game,
        ]);
        await db.query("delete from game where id = $1", [row.game]);
        await db.query("delete from slot where id = $1", [row.slot]);
      }),
  };
}

async function withDb<T>(body: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return await body(db);
  } finally {
    await db.end();
  }
}
