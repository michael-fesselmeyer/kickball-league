import { Client } from "pg";

/**
 * Six open slots (two kickoff times on three fields) on one evening after
 * Fall 2026's last regular game, which is the permit an admin adds for
 * playoff day: the seeded season has no free slot after its last game.
 * Returns the day as YYYY-MM-DD.
 */
export async function addPlayoffSlots(): Promise<string> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query(
      `with season_row as (
         select s.id, s.league_id, l.timezone from season s
           join league l on l.id = s.league_id
          where s.slug = 'fall-2026' and l.is_default
       ), fields as (
         select f.id, row_number() over (order by f.name) as n
           from field f join venue v on v.id = f.venue_id
          where v.name = 'McCarren Park'
            and v.league_id = (select league_id from season_row)
          order by f.name
          limit 3
       )
       insert into slot (season_id, field_id, starts_at, ends_at, time_index)
       select s.id, f.id,
              (timestamp '2026-11-04 18:00' + (t.i * interval '1 hour'))
                at time zone s.timezone,
              (timestamp '2026-11-04 19:00' + (t.i * interval '1 hour'))
                at time zone s.timezone,
              t.i
         from season_row s, fields f, (values (0), (1)) as t(i)
       on conflict do nothing`,
    );
  } finally {
    await db.end();
  }
  return "2026-11-04";
}
