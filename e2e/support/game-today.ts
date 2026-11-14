import { Client } from "pg";

/**
 * An exhibition game at noon today, league time, between two fall teams,
 * for flows that need a game day. It sits outside the published schedule,
 * so no schedule, standings or rain-out screen lists it, and has no ref,
 * so no ref's list changes. `remove` deletes it and its slot.
 */
export async function addGameToday(
  teamA: string,
  teamB: string,
): Promise<{ gameId: string; remove: () => Promise<void> }> {
  const ids = await withDb(async (db) => {
    const { rows } = await db.query<{ game: string; slot: string }>(
      `with teams as (
         select ts.id, t.name, s.id as season_id, l.timezone, l.id as league_id
           from team_season ts
           join team t on t.id = ts.team_id
           join season s on s.id = ts.season_id
           join league l on l.id = s.league_id
          where s.slug = 'fall-2026' and t.name in ($1, $2)
       ), noon as (
         select (date_trunc('day', now() at time zone timezone)
                   + interval '12 hours') at time zone timezone as starts_at,
                season_id, league_id
           from teams limit 1
       ), place as (
         select f.id as field_id from field f
           join venue v on v.id = f.venue_id
          where v.league_id = (select league_id from noon)
          order by f.name limit 1
       ), new_slot as (
         insert into slot (season_id, field_id, starts_at, ends_at, time_index)
         select season_id, (select field_id from place), starts_at,
                starts_at + interval '1 hour', 0
           from noon
         returning id, season_id
       )
       insert into game (season_id, team_a_id, team_b_id, kind, slot_id)
       select new_slot.season_id,
              (select id from teams where name = $1),
              (select id from teams where name = $2),
              'exhibition', new_slot.id
         from new_slot
       returning id as game, slot_id as slot`,
      [teamA, teamB],
    );
    const [row] = rows;
    if (!row) throw new Error(`Could not add ${teamA} vs ${teamB} today`);
    return row;
  });
  return {
    gameId: ids.game,
    remove: () =>
      withDb(async (db) => {
        await db.query("delete from game where id = $1", [ids.game]);
        await db.query("delete from slot where id = $1", [ids.slot]);
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
