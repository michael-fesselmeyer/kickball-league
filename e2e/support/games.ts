import { Client } from "pg";

/**
 * Puts a seeded game back the way the seed leaves it: scheduled, with no
 * score reported or confirmed, no innings entered, nobody kicking first and
 * no offline entries received. A flow that scores a game calls it first, so
 * it can run again (a retry, or `--repeat-each`) without a reseed.
 * Incidents and ratings stay: they are not part of the score.
 */
export async function unscoreGame(teamA: string, teamB: string): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<{ id: string }>(
      `select g.id from game g
         join team_season tsa on tsa.id = g.team_a_id
         join team ta on ta.id = tsa.team_id
         join team_season tsb on tsb.id = g.team_b_id
         join team tb on tb.id = tsb.team_id
        where ta.name = $1 and tb.name = $2`,
      [teamA, teamB],
    );
    const [only] = rows;
    if (!only || rows.length !== 1)
      throw new Error(`Expected one game ${teamA} vs ${teamB}`);
    await client.query(
      `delete from score_response where score_report_id in
         (select id from score_report where game_id = $1)`,
      [only.id],
    );
    for (const table of ["score_report", "game_period", "offline_receipt"])
      await client.query(`delete from ${table} where game_id = $1`, [only.id]);
    await client.query(
      `update game set status = 'scheduled', score_a = null, score_b = null,
              innings_played = null, forfeit_by = null, finalized_at = null,
              kicks_first = null
        where id = $1`,
      [only.id],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}
