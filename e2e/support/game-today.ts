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
  return addGameInDays(teamA, teamB, 0, 12);
}

/**
 * The same exhibition game `days` days from today, kicking off at `hour`
 * league time, for flows that need a game still to come.
 */
export async function addGameInDays(
  teamA: string,
  teamB: string,
  days: number,
  hour: number,
): Promise<{ gameId: string; remove: () => Promise<void> }> {
  const ids = await withDb(async (db) => {
    const { rows } = await db.query<{ game: string; slot: string }>(
      `with teams as (
         select ts.id, t.name, s.id as season_id, l.timezone, l.id as league_id
           from team_season ts
           join team t on t.id = ts.team_id
           join season s on s.id = ts.season_id
           join league l on l.id = s.league_id
          where s.slug = 'fall-2026' and l.slug = 'demo-league'
            and t.name in ($1, $2)
       ), noon as (
         select (date_trunc('day', now() at time zone timezone)
                   + make_interval(days => $3::int, hours => $4::int))
                  at time zone timezone as starts_at,
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
      [teamA, teamB, days, hour],
    );
    const [row] = rows;
    if (!row)
      throw new Error(`Could not add ${teamA} vs ${teamB} in ${days} days`);
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

/**
 * Two games at noon a week from today, league time, at the same time on the
 * first two fields, for flows that staff games still to come. They sit in
 * a small draft season of their own (four fall teams), not in Fall 2026:
 * publishing a season's schedule takes the slot off any of its games the
 * schedule doesn't place, and other flows publish Fall 2026's (a rain-out's
 * makeups). Players see nothing of a draft season. `remove` deletes it all.
 */
export async function addGamesNextWeek(
  pairs: readonly [readonly [string, string], readonly [string, string]],
): Promise<{
  day: string;
  slug: string;
  name: string;
  remove: () => Promise<void>;
}> {
  const tag = Math.random().toString(36).slice(2, 8);
  const slug = `next-week-${tag}`;
  const name = `Next week ${tag}`;
  const made = await withDb(async (db) => {
    const { rows: seasons } = await db.query<{
      id: string;
      league_id: string;
      day: string;
    }>(
      `insert into season (league_id, name, slug, starts_on, ends_on,
                           fee_model, player_fee_cents, roster_min, roster_max)
       select s.league_id, $1, $2, current_date, current_date + 14,
              s.fee_model, s.player_fee_cents, s.roster_min, s.roster_max
         from season s where s.slug = 'fall-2026'
          and s.league_id = (select id from league where is_default)
       returning id, league_id,
         to_char((now() at time zone (select timezone from league
                    where id = league_id))::date + 7, 'YYYY-MM-DD') as day`,
      [name, slug],
    );
    const [created] = seasons;
    if (!created) throw new Error("Could not add next week's season");
    const games: string[] = [];
    const slots: string[] = [];
    for (const [i, [teamA, teamB]] of pairs.entries()) {
      const { rows } = await db.query<{ game: string; slot: string }>(
        `with entries as (
           insert into team_season (team_id, season_id)
           select t.id, $1 from team t
            where t.league_id = $2 and t.name in ($3, $4)
           on conflict do nothing
           returning id, team_id
         ), teams as (
           select ts.id, t.name from team_season ts
             join team t on t.id = ts.team_id
            where ts.season_id = $1 and t.name in ($3, $4)
           union all
           select e.id, t.name from entries e join team t on t.id = e.team_id
         ), noon as (
           select ((($6::date)::timestamp + interval '12 hours')
                    at time zone l.timezone) as starts_at
             from league l where l.id = $2
         ), place as (
           select f.id as field_id from field f
             join venue v on v.id = f.venue_id
            where v.league_id = $2
            order by f.name offset $5 limit 1
         ), new_slot as (
           insert into slot (season_id, field_id, starts_at, ends_at, time_index)
           select $1, (select field_id from place), starts_at,
                  starts_at + interval '1 hour', $5
             from noon
           returning id
         )
         insert into game (season_id, team_a_id, team_b_id, kind, slot_id)
         select $1,
                (select id from teams where name = $3 limit 1),
                (select id from teams where name = $4 limit 1),
                'exhibition', new_slot.id
           from new_slot
         returning id as game, slot_id as slot`,
        [created.id, created.league_id, teamA, teamB, i, created.day],
      );
      const [row] = rows;
      if (!row) throw new Error(`Could not add ${teamA} vs ${teamB} next week`);
      games.push(row.game);
      slots.push(row.slot);
    }
    return { seasonId: created.id, day: created.day, games, slots };
  });
  return {
    day: made.day,
    slug,
    name,
    remove: () =>
      withDb(async (db) => {
        await db.query("delete from game where season_id = $1", [
          made.seasonId,
        ]);
        await db.query("delete from slot where season_id = $1", [
          made.seasonId,
        ]);
        await db.query("delete from team_season where season_id = $1", [
          made.seasonId,
        ]);
        await db.query("delete from season where id = $1", [made.seasonId]);
      }),
  };
}

/**
 * A game three hours from now between two fall teams, with the demo ref
 * down to ref it, for the flows that drop and take a game. It sits in a
 * small private season of its own that is under way, not in Fall 2026:
 * publishing a season's schedule takes the slot off any game the schedule
 * doesn't place, and other flows publish Fall 2026's. Nobody but admins
 * sees a private season. `remove` deletes it all.
 */
export async function addRefereedGameSoon(
  teamA: string,
  teamB: string,
): Promise<{ gameId: string; remove: () => Promise<void> }> {
  const tag = Math.random().toString(36).slice(2, 8);
  const made = await withDb(async (db) => {
    const { rows } = await db.query<{ season: string; game: string }>(
      `with new_season as (
         insert into season (league_id, name, slug, status, visibility,
                             starts_on, ends_on, fee_model, player_fee_cents,
                             roster_min, roster_max)
         select s.league_id, $3, $4, 'in_progress', 'private',
                current_date, current_date + 7,
                s.fee_model, s.player_fee_cents, s.roster_min, s.roster_max
           from season s where s.slug = 'fall-2026'
            and s.league_id = (select id from league where is_default)
         returning id, league_id
       ), entries as (
         insert into team_season (team_id, season_id)
         select t.id, new_season.id from team t, new_season
          where t.league_id = new_season.league_id and t.name in ($1, $2)
         returning id, team_id
       ), place as (
         select f.id as field_id from field f
           join venue v on v.id = f.venue_id
          where v.league_id = (select league_id from new_season)
          order by f.name desc limit 1
       ), new_slot as (
         insert into slot (season_id, field_id, starts_at, ends_at, time_index)
         select new_season.id, (select field_id from place),
                date_trunc('hour', now()) + interval '3 hours',
                date_trunc('hour', now()) + interval '4 hours', 0
           from new_season
         returning id, season_id
       ), new_game as (
         insert into game (season_id, team_a_id, team_b_id, kind, slot_id)
         select new_slot.season_id,
                (select e.id from entries e join team t on t.id = e.team_id
                  where t.name = $1),
                (select e.id from entries e join team t on t.id = e.team_id
                  where t.name = $2),
                'exhibition', new_slot.id
           from new_slot
         returning id, season_id
       ), ref as (
         insert into referee_assignment (game_id, user_id, status, responded_at)
         select new_game.id, u.id, 'accepted', now()
           from new_game, "user" u
          where u.email = 'reese.ref@example.test'
         returning game_id
       )
       select new_game.season_id as season, new_game.id as game
         from new_game, ref`,
      [teamA, teamB, `Pickup ${tag}`, `pickup-${tag}`],
    );
    const [row] = rows;
    if (!row) throw new Error(`Could not add ${teamA} vs ${teamB} soon`);
    return row;
  });
  return {
    gameId: made.game,
    remove: () =>
      withDb(async (db) => {
        await db.query("delete from game where season_id = $1", [made.season]);
        await db.query("delete from slot where season_id = $1", [made.season]);
        await db.query("delete from team_season where season_id = $1", [
          made.season,
        ]);
        await db.query("delete from season where id = $1", [made.season]);
      }),
  };
}

/**
 * A game that kicked off an hour ago and has no score, with no ref, between
 * two fall teams, for a flow that scores or rules on a game of its own. It
 * sits in a small private season of its own, not in Fall 2026, so no
 * standings, schedule or list that other flows read changes; nobody but
 * admins sees a private season. `remove` deletes it all, scores included.
 */
export async function addStartedGame(
  teamA: string,
  teamB: string,
): Promise<{ gameId: string; remove: () => Promise<void> }> {
  const tag = Math.random().toString(36).slice(2, 8);
  const made = await withDb(async (db) => {
    const { rows } = await db.query<{ season: string; game: string }>(
      `with new_season as (
         insert into season (league_id, name, slug, status, visibility,
                             starts_on, ends_on, fee_model, player_fee_cents,
                             roster_min, roster_max)
         select s.league_id, $3, $4, 'in_progress', 'private',
                current_date - 1, current_date + 7,
                s.fee_model, s.player_fee_cents, s.roster_min, s.roster_max
           from season s where s.slug = 'fall-2026'
            and s.league_id = (select id from league where is_default)
         returning id, league_id
       ), entries as (
         insert into team_season (team_id, season_id)
         select t.id, new_season.id from team t, new_season
          where t.league_id = new_season.league_id and t.name in ($1, $2)
         returning id, team_id
       ), place as (
         select f.id as field_id from field f
           join venue v on v.id = f.venue_id
          where v.league_id = (select league_id from new_season)
          order by f.name desc limit 1
       ), new_slot as (
         insert into slot (season_id, field_id, starts_at, ends_at, time_index)
         select new_season.id, (select field_id from place),
                date_trunc('minute', now()) - interval '60 minutes',
                date_trunc('minute', now()), 0
           from new_season
         returning id, season_id
       ), new_game as (
         insert into game (season_id, team_a_id, team_b_id, kind, slot_id)
         select new_slot.season_id,
                (select e.id from entries e join team t on t.id = e.team_id
                  where t.name = $1),
                (select e.id from entries e join team t on t.id = e.team_id
                  where t.name = $2),
                'exhibition', new_slot.id
           from new_slot
         returning id, season_id
       )
       select season_id as season, id as game from new_game`,
      [teamA, teamB, `Started ${tag}`, `started-${tag}`],
    );
    const [row] = rows;
    if (!row) throw new Error(`Could not add ${teamA} vs ${teamB} started`);
    return row;
  });
  return {
    gameId: made.game,
    remove: () =>
      withDb(async (db) => {
        await db.query(
          `delete from score_response where score_report_id in
             (select id from score_report where game_id = $1)`,
          [made.game],
        );
        for (const table of ["score_report", "game_period", "offline_receipt"])
          await db.query(`delete from ${table} where game_id = $1`, [
            made.game,
          ]);
        await db.query("delete from game where season_id = $1", [made.season]);
        await db.query("delete from slot where season_id = $1", [made.season]);
        await db.query("delete from team_season where season_id = $1", [
          made.season,
        ]);
        await db.query("delete from season where id = $1", [made.season]);
      }),
  };
}

/**
 * A game under way (it kicked off 30 minutes ago) that Reese Ref referees,
 * with a kicking order saved for `teamA`: three of its fall players,
 * registered in a small private season of their own so nothing else they
 * see changes. Nobody but admins sees a private season. Returns the order's
 * names as "First L.", and `remove` deletes it all, ejection reports
 * included.
 */
export async function addGameUnderWayWithOrder(
  teamA: string,
  teamB: string,
): Promise<{
  gameId: string;
  order: string[];
  remove: () => Promise<void>;
}> {
  const tag = Math.random().toString(36).slice(2, 8);
  const made = await withDb(async (db) => {
    const { rows } = await db.query<{ season: string; game: string }>(
      `with new_season as (
         insert into season (league_id, name, slug, status, visibility,
                             starts_on, ends_on, fee_model, player_fee_cents,
                             roster_min, roster_max)
         select s.league_id, $3, $4, 'in_progress', 'private',
                current_date - 1, current_date + 7,
                s.fee_model, s.player_fee_cents, s.roster_min, s.roster_max
           from season s where s.slug = 'fall-2026'
            and s.league_id = (select id from league where is_default)
         returning id, league_id
       ), entries as (
         insert into team_season (team_id, season_id)
         select t.id, new_season.id from team t, new_season
          where t.league_id = new_season.league_id and t.name in ($1, $2)
         returning id, team_id
       ), place as (
         select f.id as field_id from field f
           join venue v on v.id = f.venue_id
          where v.league_id = (select league_id from new_season)
          order by f.name desc limit 1
       ), new_slot as (
         insert into slot (season_id, field_id, starts_at, ends_at, time_index)
         select new_season.id, (select field_id from place),
                now() - interval '30 minutes',
                now() + interval '60 minutes', 0
           from new_season
         returning id, season_id
       ), new_game as (
         insert into game (season_id, team_a_id, team_b_id, kind, slot_id)
         select new_slot.season_id,
                (select e.id from entries e join team t on t.id = e.team_id
                  where t.name = $1),
                (select e.id from entries e join team t on t.id = e.team_id
                  where t.name = $2),
                'exhibition', new_slot.id
           from new_slot
         returning id, season_id
       ), ref as (
         insert into referee_assignment (game_id, user_id, status, responded_at)
         select new_game.id, u.id, 'accepted', now()
           from new_game, "user" u
          where u.email = 'reese.ref@example.test'
         returning game_id
       )
       select new_game.season_id as season, new_game.id as game
         from new_game, ref`,
      [teamA, teamB, `Under way ${tag}`, `under-way-${tag}`],
    );
    const [row] = rows;
    if (!row) throw new Error(`Could not add ${teamA} vs ${teamB} under way`);
    // Three of team A's fall players, on its roster in the new season.
    const players = await db.query<{ user_id: string; name: string }>(
      `select r.user_id,
              coalesce(p.first_name || coalesce(' ' || left(p.last_name, 1) || '.', ''),
                       nullif(u.name, ''), 'A player') as name
         from roster_membership rm
         join registration r on r.id = rm.registration_id
         join team_season ts on ts.id = rm.team_season_id
         join team t on t.id = ts.team_id
         join season s on s.id = ts.season_id and s.slug = 'fall-2026'
         join "user" u on u.id = r.user_id
         left join profile p on p.user_id = r.user_id
        where t.name = $1 and rm.status = 'active' and rm.role = 'player'
        order by r.user_id
        limit 3`,
      [teamA],
    );
    if (players.rows.length < 3)
      throw new Error(`${teamA} has too few players`);
    const team = await db.query<{ id: string }>(
      `select ts.id from team_season ts join team t on t.id = ts.team_id
        where ts.season_id = $1 and t.name = $2`,
      [row.season, teamA],
    );
    const teamSeasonId = team.rows[0]?.id;
    for (const p of players.rows) {
      const reg = await db.query<{ id: string }>(
        `insert into registration (season_id, user_id, kind, status)
         values ($1, $2, 'team_member', 'active') returning id`,
        [row.season, p.user_id],
      );
      await db.query(
        `insert into roster_membership (team_season_id, registration_id, role, status)
         values ($1, $2, 'player', 'active')`,
        [teamSeasonId, reg.rows[0]?.id],
      );
    }
    const lineup = await db.query<{ id: string }>(
      `insert into game_lineup (game_id, team_season_id, run_breaks)
       values ($1, $2, 0) returning id`,
      [row.game, teamSeasonId],
    );
    for (const [i, p] of players.rows.entries())
      await db.query(
        `insert into game_lineup_spot (lineup_id, position, user_id)
         values ($1, $2, $3)`,
        [lineup.rows[0]?.id, i + 1, p.user_id],
      );
    return { ...row, order: players.rows.map((p) => p.name) };
  });
  return {
    gameId: made.game,
    order: made.order,
    remove: () =>
      withDb(async (db) => {
        await db.query("delete from game where season_id = $1", [made.season]);
        await db.query("delete from slot where season_id = $1", [made.season]);
        await db.query(
          `delete from roster_membership where team_season_id in
             (select id from team_season where season_id = $1)`,
          [made.season],
        );
        await db.query("delete from registration where season_id = $1", [
          made.season,
        ]);
        await db.query("delete from team_season where season_id = $1", [
          made.season,
        ]);
        await db.query("delete from season where id = $1", [made.season]);
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
