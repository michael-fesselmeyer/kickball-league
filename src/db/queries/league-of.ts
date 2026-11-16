import { type SQL, sql } from "drizzle-orm";
import type { LeagueId } from "@/domain/ids";
import type { Db } from "./schedule";

/**
 * How to find the league of each kind of record the audit log names, from
 * its id (ADR 0048). An entry about one of these needs no `leagueId`: it is
 * read from the record itself, so it can never be filed in the wrong
 * league's log.
 */
export const LEAGUE_OF = {
  league: (id) => sql`select id from league where id = ${id}`,
  season: (id) => sql`select league_id from season where id = ${id}`,
  team: (id) => sql`select league_id from team where id = ${id}`,
  team_season: (id) =>
    sql`select s.league_id from team_season ts join season s on s.id = ts.season_id where ts.id = ${id}`,
  registration: (id) =>
    sql`select s.league_id from registration r join season s on s.id = r.season_id where r.id = ${id}`,
  game: (id) =>
    sql`select s.league_id from game g join season s on s.id = g.season_id where g.id = ${id}`,
  incident: (id) =>
    sql`select s.league_id from incident i join game g on g.id = i.game_id join season s on s.id = g.season_id where i.id = ${id}`,
  team_formation_request: (id) =>
    sql`select s.league_id from team_formation_request t join season s on s.id = t.season_id where t.id = ${id}`,
  signup_challenge: (id) =>
    sql`select s.league_id from signup_challenge c join season s on s.id = c.season_id where c.id = ${id}`,
  schedule_version: (id) =>
    sql`select s.league_id from schedule_version v join season s on s.id = v.season_id where v.id = ${id}`,
  division: (id) =>
    sql`select s.league_id from division d join season s on s.id = d.season_id where d.id = ${id}`,
  bracket: (id) =>
    sql`select s.league_id from bracket b join season s on s.id = b.season_id where b.id = ${id}`,
  checklist_task: (id) =>
    sql`select s.league_id from checklist_task t join season s on s.id = t.season_id where t.id = ${id}`,
  award_poll: (id) =>
    sql`select s.league_id from award_poll p join season s on s.id = p.season_id where p.id = ${id}`,
  captain_poll: (id) =>
    sql`select s.league_id from captain_poll p join season s on s.id = p.season_id where p.id = ${id}`,
  suspension: (id) =>
    sql`select s.league_id from suspension x join season s on s.id = x.season_id where x.id = ${id}`,
  promo_code: (id) =>
    sql`select s.league_id from promo_code p join season s on s.id = p.season_id where p.id = ${id}`,
  permit_window: (id) =>
    sql`select s.league_id from permit_window p join season s on s.id = p.season_id where p.id = ${id}`,
  expense: (id) =>
    sql`select s.league_id from expense e join season s on s.id = e.season_id where e.id = ${id}`,
  announcement: (id) =>
    sql`select s.league_id from announcement a join season s on s.id = a.season_id where a.id = ${id}`,
  team_constraint: (id) =>
    sql`select s.league_id from team_constraint c join team_season ts on ts.id = c.team_season_id join season s on s.id = ts.season_id where c.id = ${id}`,
  season_survey: (id) =>
    sql`select s.league_id from season_survey v join season s on s.id = v.season_id where v.id = ${id}`,
  volunteer_shift: (id) =>
    sql`select league_id from volunteer_shift where id = ${id}`,
  equipment_kit: (id) =>
    sql`select league_id from equipment_kit where id = ${id}`,
  equipment_handoff: (id) =>
    sql`select k.league_id from equipment_handoff h join equipment_kit k on k.id = h.kit_id where h.id = ${id}`,
  equipment_report: (id) =>
    sql`select k.league_id from equipment_report r join equipment_kit k on k.id = r.kit_id where r.id = ${id}`,
  sponsor: (id) => sql`select league_id from sponsor where id = ${id}`,
  deal: (id) =>
    sql`select sp.league_id from deal d join sponsor sp on sp.id = d.sponsor_id where d.id = ${id}`,
  event: (id) => sql`select league_id from event where id = ${id}`,
  giveaway: (id) =>
    sql`select e.league_id from giveaway g join event e on e.id = g.event_id where g.id = ${id}`,
  merch_item: (id) => sql`select league_id from merch_item where id = ${id}`,
  merch_order: (id) =>
    sql`select i.league_id from merch_order o join merch_item i on i.id = o.item_id where o.id = ${id}`,
  payment: (id) =>
    sql`select p.league_id from payment x join purchase p on p.id = x.purchase_id where x.id = ${id}`,
  friend_league: (id) =>
    sql`select league_id from friend_league where id = ${id}`,
  social_account: (id) =>
    sql`select league_id from social_account where id = ${id}`,
  social_post: (id) =>
    sql`select a.league_id from social_post p join social_account a on a.id = p.account_id where p.id = ${id}`,
  member_photo: (id) =>
    sql`select league_id from member_photo where id = ${id}`,
  insurance_certificate: (id) =>
    sql`select league_id from insurance_certificate where id = ${id}`,
  books_file: (id) => sql`select league_id from books_file where id = ${id}`,
  conduct_code: (id) =>
    sql`select league_id from conduct_code where id = ${id}`,
  waiver: (id) => sql`select league_id from waiver where id = ${id}`,
  venue: (id) => sql`select league_id from venue where id = ${id}`,
  field: (id) =>
    sql`select v.league_id from field f join venue v on v.id = f.venue_id where f.id = ${id}`,
  rule_set: (id) => sql`select league_id from rule_set where id = ${id}`,
  blackout: (id) =>
    sql`select s.league_id from blackout b join season s on s.id = b.season_id where b.id = ${id}`,
  event_ticket: (id) =>
    sql`select e.league_id from event_ticket t join event e on e.id = t.event_id where t.id = ${id}`,
  giveaway_winner: (id) =>
    sql`select e.league_id from giveaway_winner w join giveaway g on g.id = w.giveaway_id join event e on e.id = g.event_id where w.id = ${id}`,
  merch_image: (id) =>
    sql`select i.league_id from merch_image m join merch_item i on i.id = m.item_id where m.id = ${id}`,
  score_report: (id) =>
    sql`select s.league_id from score_report r join game g on g.id = r.game_id join season s on s.id = g.season_id where r.id = ${id}`,
  team_keep_off: (id) =>
    sql`select t.league_id from team_keep_off k join team t on t.id = k.team_id where k.id = ${id}`,
  concern: (id) => sql`select league_id from concern where id = ${id}`,
  interest_form: (id) =>
    sql`select league_id from interest_form where id = ${id}`,
  interest_option: (id) =>
    sql`select f.league_id from interest_option o join interest_form f on f.id = o.form_id where o.id = ${id}`,
  actingAdmin: (id) => sql`select league_id from acting_admin where id = ${id}`,
  purchase: (id) => sql`select league_id from purchase where id = ${id}`,
} satisfies Record<string, (id: string) => SQL>;

export type LeagueRecordKind = keyof typeof LEAGUE_OF;

export const leagueLookup: Readonly<Record<string, (id: string) => SQL>> =
  LEAGUE_OF;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The league each record belongs to, in one query, or null for a record
 * that doesn't exist (or an id that isn't one).
 */
export async function leaguesOfRecords(
  db: Db,
  refs: readonly { kind: LeagueRecordKind; id: string }[],
): Promise<(LeagueId | null)[]> {
  if (refs.length === 0) return [];
  const parts = refs.map(({ kind, id }) =>
    UUID.test(id) ? sql`(${LEAGUE_OF[kind](id)})` : sql`null::uuid`,
  );
  const result: unknown = await db.execute(
    sql`select ${sql.join(
      parts.map((p, i) => sql`${p} as ${sql.identifier(`l${i}`)}`),
      sql`, `,
    )}`,
  );
  // Both database drivers return the rows under `rows`.
  const row = (result as { rows?: Record<string, LeagueId | null>[] })
    .rows?.[0];
  return refs.map((_, i) => row?.[`l${i}`] ?? null);
}
