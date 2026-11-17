import {
  and,
  asc,
  count,
  eq,
  isNotNull,
  isNull,
  lt,
  ne,
  sql,
} from "drizzle-orm";
import {
  grantActingAdmin,
  queueActingAdminNotices,
} from "@/db/queries/acting-admin";
import {
  answerAlertCard,
  saveTurnDowns,
  setTopic,
} from "@/db/queries/alert-choices";
import { castVote, openPoll } from "@/db/queries/captain-polls";
import { giveCard } from "@/db/queries/cards";
import { nextGameDayStart } from "@/db/queries/demo";
import { addGroup, addOverlap } from "@/db/queries/field-groups";
import { saveAnswer } from "@/db/queries/interest";
import { openCheckIns, submitCheckIn } from "@/db/queries/leadership";
import { setMoveInterest } from "@/db/queries/move";
import { createBracket } from "@/db/queries/playoffs";
import type { Db } from "@/db/queries/schedule";
import { logSpare } from "@/db/queries/shirt-late";
import {
  captainPollOption,
  event,
  eventRsvp,
  field,
  guestTeam,
  guestWaiverSignature,
  game,
  interestForm,
  interestOption,
  leadershipCheckIn,
  league,
  profile,
  refereeAssignment,
  registration,
  rosterMembership,
  ruleSet,
  season,
  seasonShirts,
  slot,
  teamSeason,
  tournament,
  venue,
  waiver,
} from "@/db/schema";
import type { LeagueId, SeasonId, TeamSeasonId, UserId } from "@/domain/ids";
import { newLinkToken } from "@/domain/tournaments/tournament";
import type { Locale } from "@/i18n/locales";
import { PERSONA_IDS } from "./demo-personas";

const DAY = 24 * 60 * 60_000;

/**
 * Demo-only data for the features that merged after the walkthrough was
 * last updated (docs/demo.md): a captain poll with votes, a drafted
 * double-elimination bracket, groups that share the fields, an acting admin,
 * ref cards, alert choices, players open to a new team, a leadership
 * check-in, late-joiner shirts and more interest sign-ups. Everything is
 * invented, and it goes through the app's own writes, so each screen reads
 * it as it would real use.
 *
 * It runs only in `npm run demo:reset`, after the league has moved to the
 * current week, so its dates are relative to `now`. The base seed, which
 * the end-to-end tests use, stays as it is: several of those tests start
 * these features from empty.
 */
export async function addDemoShowcase(
  db: Db,
  leagueId: LeagueId,
  now: Date,
): Promise<string[]> {
  const ctx = await showcaseContext(db, leagueId, now);
  if (!ctx) return [];
  const done: string[] = [];
  const step = async (name: string, run: () => Promise<boolean>) => {
    if (await run()) done.push(name);
  };
  await step("late-joiner shirts", () => addLateShirts(db, ctx));
  await step("captain poll", () => addCaptainPoll(db, ctx));
  await step("playoff draft", () => addPlayoffDraft(db, ctx));
  await step("shared fields", () => addFieldGroups(db, ctx));
  await step("acting admin", () => addActingAdmin(db, ctx));
  await step("ref cards", () => addRefCards(db, ctx));
  await step("alert choices", () => addAlertChoices(db, ctx));
  await step("open to a new team", () => addMoveInterest(db, ctx));
  await step("leadership check-in", () => addLeadershipCheckIn(db, ctx));
  await step("interest sign-ups", () => addInterestAnswers(db, ctx));
  await step("charity tournament", () => addTournamentTeams(db, ctx));
  return done;
}

type Team = { id: TeamSeasonId; captainId: UserId | null; players: UserId[] };

type Context = {
  leagueId: LeagueId;
  timeZone: string;
  now: Date;
  seasonId: SeasonId;
  /** The demo captain's team first, then the others in a fixed order. */
  teams: Team[];
  pastSeasonId: SeasonId | null;
  adminId: UserId;
};

async function showcaseContext(
  db: Db,
  leagueId: LeagueId,
  now: Date,
): Promise<Context | null> {
  const [found] = await db
    .select({ seasonId: season.id, timeZone: league.timezone })
    .from(season)
    .innerJoin(league, eq(season.leagueId, league.id))
    .where(and(eq(season.leagueId, leagueId), eq(season.status, "in_progress")))
    .limit(1);
  if (!found) return null;
  const [past] = await db
    .select({ id: season.id })
    .from(season)
    .where(and(eq(season.leagueId, leagueId), eq(season.status, "completed")))
    .orderBy(sql`${season.startsOn} desc`)
    .limit(1);
  const members = await db
    .select({
      teamSeasonId: rosterMembership.teamSeasonId,
      userId: registration.userId,
      role: rosterMembership.role,
    })
    .from(rosterMembership)
    .innerJoin(
      registration,
      eq(rosterMembership.registrationId, registration.id),
    )
    .innerJoin(teamSeason, eq(rosterMembership.teamSeasonId, teamSeason.id))
    .where(
      and(
        eq(teamSeason.seasonId, found.seasonId),
        eq(rosterMembership.status, "active"),
      ),
    )
    .orderBy(asc(rosterMembership.teamSeasonId), asc(registration.createdAt));
  const byTeam = new Map<TeamSeasonId, Team>();
  for (const m of members) {
    const team = byTeam.get(m.teamSeasonId) ?? {
      id: m.teamSeasonId,
      captainId: null,
      players: [],
    };
    if (m.role === "captain") team.captainId = m.userId;
    else if (!team.players.includes(m.userId)) team.players.push(m.userId);
    byTeam.set(m.teamSeasonId, team);
  }
  const teams = [...byTeam.values()].sort(
    (a, b) =>
      Number(b.captainId === PERSONA_IDS.captain) -
      Number(a.captainId === PERSONA_IDS.captain),
  );
  return {
    leagueId,
    timeZone: found.timeZone,
    now,
    seasonId: found.seasonId,
    teams,
    pastSeasonId: past?.id ?? null,
    adminId: PERSONA_IDS.admin,
  };
}

/** The players who aren't the demo personas, from every team but the captain's. */
const otherPlayers = (ctx: Context) =>
  ctx.teams.slice(1).flatMap((t) => t.players);

/**
 * The seed records the season's shirt order as placed but leaves every
 * sign-up's shirt unordered, so the late-joiner list showed the whole
 * league. Everyone who signed up before the order is now on it; three
 * players who joined since wait for a shirt, and a few spares from an
 * earlier order are in stock to hand out.
 */
async function addLateShirts(db: Db, ctx: Context): Promise<boolean> {
  const [order] = await db
    .select({ placedAt: seasonShirts.placedAt })
    .from(seasonShirts)
    .where(eq(seasonShirts.seasonId, ctx.seasonId));
  if (!order) return false;
  const late = ctx.teams.slice(1, 4).flatMap((t) => t.players.slice(-1));
  await db
    .update(registration)
    .set({ shirtStatus: "ordered" })
    .where(
      and(
        eq(registration.seasonId, ctx.seasonId),
        eq(registration.shirtStatus, "none"),
        late.length ? sql`${registration.userId} not in ${late}` : undefined,
      ),
    );
  for (const [size, quantity] of [
    ["m", 3],
    ["l", 2],
    ["xl", 1],
  ] as const)
    await logSpare(db, {
      leagueId: ctx.leagueId,
      size,
      quantity,
      note: "Left over from the summer order.",
      actorId: ctx.adminId,
    });
  return true;
}

/**
 * An open poll for the season's captains, with five of the eight teams
 * already in. The demo captain's team hasn't voted, so the walkthrough can.
 */
async function addCaptainPoll(db: Db, ctx: Context): Promise<boolean> {
  const pollId = await openPoll(db, {
    seasonId: ctx.seasonId,
    actorId: ctx.adminId,
    poll: {
      title: "Where should the end-of-season party be?",
      detail:
        "We have three places that can hold the whole league after the final. One vote per team; talk it over with your players first.",
      options: [
        "The bar by the park",
        "The bowling alley",
        "A picnic in the park",
      ],
      includeCoCaptains: true,
      results: "after_voting",
      opensAt: new Date(ctx.now.getTime() - 2 * DAY),
      // 9 pm on the third day from now, as an admin would set it.
      closesAt: zoned(
        localParts(new Date(ctx.now.getTime() + 3 * DAY), ctx.timeZone).date,
        21,
        ctx.timeZone,
      ),
    },
  });
  const options = await db
    .select({ id: captainPollOption.id })
    .from(captainPollOption)
    .where(eq(captainPollOption.captainPollId, pollId))
    .orderBy(asc(captainPollOption.position));
  const picks = [0, 0, 1, 2, 0];
  for (const [i, team] of ctx.teams.slice(1, 6).entries()) {
    const option = options[picks[i] ?? 0];
    if (!team.captainId || !option) continue;
    const voted = await castVote(db, {
      pollId,
      teamSeasonId: team.id,
      optionId: option.id,
      voterId: team.captainId,
      now: new Date(ctx.now.getTime() - (30 - i * 5) * 60 * 60_000),
    });
    if (!voted.ok) throw new Error(`Demo poll vote failed: ${voted.error}`);
  }
  return true;
}

/**
 * A draft playoff bracket from today's standings: the top four in a
 * double-elimination Gold bracket, the next four in a single-elimination
 * Silver bracket with a third-place game. It stays a draft, so the public
 * site shows nothing until an admin publishes it in the walkthrough.
 */
async function addPlayoffDraft(db: Db, ctx: Context): Promise<boolean> {
  const [last] = await db
    .select({
      day: sql<string>`max((${slot.startsAt} at time zone ${ctx.timeZone})::date)::text`,
    })
    .from(game)
    .innerJoin(slot, eq(game.slotId, slot.id))
    .where(and(eq(game.seasonId, ctx.seasonId), eq(game.kind, "regular")));
  if (!last?.day) return false;
  // Two playoff evenings, a week and two after the last regular game, with
  // three kickoffs on each field: the field time an admin adds for playoffs.
  const fromDate = addDays(last.day, 7);
  const fields = await db
    .select({ id: field.id })
    .from(field)
    .innerJoin(venue, eq(field.venueId, venue.id))
    .where(eq(venue.leagueId, ctx.leagueId))
    .orderBy(asc(field.name))
    .limit(3);
  const evenings = [fromDate, addDays(last.day, 14)];
  await db.insert(slot).values(
    evenings.flatMap((day) =>
      fields.flatMap((f) =>
        [0, 1, 2].map((i) => ({
          seasonId: ctx.seasonId,
          fieldId: f.id,
          startsAt: zoned(day, 19 + i, ctx.timeZone),
          endsAt: zoned(day, 20 + i, ctx.timeZone),
          timeIndex: i,
        })),
      ),
    ),
  );
  const drafted = await createBracket(db, {
    seasonId: ctx.seasonId,
    actorId: ctx.adminId,
    teams: 4,
    fromDate,
    format: "double_elimination",
    tiers: [
      { teams: 4, fromDate, format: "double_elimination" },
      { teams: 4, fromDate, format: "single_elimination", thirdPlace: true },
    ],
  });
  if (!drafted.ok) {
    console.warn(`No demo playoff draft: ${drafted.error}.`);
    return false;
  }
  return true;
}

function addDays(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The instant of `hour`:00 on `day` in the league's time zone. */
function zoned(day: string, hour: number, timeZone: string): Date {
  const guess = new Date(`${day}T${String(hour).padStart(2, "0")}:00:00Z`);
  const local = new Date(
    guess.toLocaleString("en-US", { timeZone, hour12: false }),
  );
  const utc = new Date(
    guess.toLocaleString("en-US", { timeZone: "UTC", hour12: false }),
  );
  return new Date(guess.getTime() - (local.getTime() - utc.getTime()));
}

/**
 * Two groups that share the league's fields: a soccer club on the first
 * field just before the league's games, and a weekend youth league. The
 * soccer club has asked for the field later than usual on the next game
 * day, so the handover and the permits screen have an overlap to show.
 */
async function addFieldGroups(db: Db, ctx: Context): Promise<boolean> {
  const fields = await db
    .select({ id: field.id })
    .from(field)
    .innerJoin(venue, eq(field.venueId, venue.id))
    .where(eq(venue.leagueId, ctx.leagueId))
    .orderBy(asc(field.name));
  const [first, second] = fields;
  const next = await nextGameDayStart(db, ctx.leagueId, ctx.now);
  if (!first || !next) return false;
  const local = localParts(next, ctx.timeZone);
  const soccer = await addGroup(
    db,
    {
      leagueId: ctx.leagueId,
      fieldId: first.id,
      group: {
        name: "Riverside Adult Soccer (example)",
        weekdays: [local.weekday],
        startsAt: "18:00",
        endsAt: "20:00",
        contact: "fields@riverside-soccer.example.test",
      },
    },
    ctx.adminId,
  );
  if (!soccer.ok) throw new Error(`Demo field group failed: ${soccer.error}`);
  const youth = await addGroup(
    db,
    {
      leagueId: ctx.leagueId,
      fieldId: (second ?? first).id,
      group: {
        name: "Little Sluggers Youth Baseball (example)",
        weekdays: [6],
        startsAt: "09:00",
        endsAt: "13:00",
        contact: null,
      },
    },
    ctx.adminId,
  );
  if (!youth.ok) throw new Error(`Demo field group failed: ${youth.error}`);
  const overlap = await addOverlap(
    db,
    {
      leagueId: ctx.leagueId,
      groupId: soccer.value,
      on: local.date,
      note: "Their playoff runs late: they have the field until 8:30 pm, so the first game there starts a little late.",
    },
    ctx.adminId,
  );
  if (!overlap.ok) throw new Error(`Demo overlap failed: ${overlap.error}`);
  return true;
}

function localParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    weekday: Math.max(0, weekdays.indexOf(get("weekday") ?? "")),
  };
}

/**
 * The admins are away, so the demo captain is acting admin for two weeks
 * that started yesterday, with game day, scores and rain-outs. Viewing as
 * Captain shows the handed-over tools; the start notice is in the demo's
 * mail. (Owners grant it on Acting admins, which the demo's Admin, not an
 * owner, can't open.)
 */
async function addActingAdmin(db: Db, ctx: Context): Promise<boolean> {
  const granted = await grantActingAdmin(db, {
    leagueId: ctx.leagueId,
    userId: PERSONA_IDS.captain,
    powers: ["game_day", "scores", "rainouts"],
    startsAt: new Date(ctx.now.getTime() - DAY),
    endsAt: new Date(ctx.now.getTime() + 13 * DAY),
    actorId: ctx.adminId,
    now: new Date(ctx.now.getTime() - DAY),
  });
  if (!granted.ok)
    throw new Error(`Demo acting admin failed: ${granted.error}`);
  // The daily job's start notice, as it went out yesterday.
  await queueActingAdminNotices(db, new Date(ctx.now.getTime() - DAY));
  return true;
}

/**
 * Two cards the demo ref gave in games already played: a yellow for
 * arguing and, in another game, a red for a repeat. They show on the
 * admins' cards screen and on each game's score page.
 */
async function addRefCards(db: Db, ctx: Context): Promise<boolean> {
  const games = await db
    .select({
      id: game.id,
      teamAId: game.teamAId,
      teamBId: game.teamBId,
      startsAt: slot.startsAt,
    })
    .from(game)
    .innerJoin(refereeAssignment, eq(refereeAssignment.gameId, game.id))
    .innerJoin(slot, eq(game.slotId, slot.id))
    .where(
      and(
        eq(game.seasonId, ctx.seasonId),
        eq(game.status, "final"),
        eq(refereeAssignment.userId, PERSONA_IDS.ref),
        lt(slot.startsAt, ctx.now),
      ),
    )
    .orderBy(asc(slot.startsAt));
  const cards = [
    { color: "yellow", note: "Kept arguing a call at first base." },
    {
      color: "red",
      note: "A second warning for the same thing; sat out the last inning.",
    },
  ] as const;
  let given = 0;
  for (const [i, card] of cards.entries()) {
    const g = games[i];
    const teamId = g?.teamBId ?? g?.teamAId;
    const team = ctx.teams.find((t) => t.id === teamId);
    const player = team?.players[2];
    if (!g || !team || !player) continue;
    const result = await giveCard(db, {
      gameId: g.id,
      givenBy: PERSONA_IDS.ref,
      card: { ...card, userId: player, teamSeasonId: team.id },
      // During the game, an hour after kickoff.
      now: new Date(g.startsAt.getTime() + 60 * 60_000),
      isAdmin: true,
    });
    if (!result.ok) throw new Error(`Demo card failed: ${result.error}`);
    given++;
  }
  return given > 0;
}

/**
 * How players answered the alert cards and the email footers: most said
 * yes to game reminders, some want only their team's news or a weekly
 * roundup, a couple snoozed, and two turned league news off from an email.
 */
async function addAlertChoices(db: Db, ctx: Context): Promise<boolean> {
  const players = otherPlayers(ctx);
  if (players.length === 0) return false;
  const at = (i: number) => new Date(ctx.now.getTime() - (i + 1) * 3_600_000);
  for (const [i, userId] of players.slice(0, 40).entries()) {
    await answerAlertCard(
      db,
      userId,
      "first_rsvp",
      i % 5 === 4 ? "no" : "yes",
      {
        now: at(i),
      },
    );
    if (i % 3 === 0)
      await answerAlertCard(
        db,
        userId,
        "joined_team",
        i % 6 === 0 ? "yes" : "no",
        {
          now: at(i),
        },
      );
  }
  for (const userId of players.slice(40, 46))
    await saveTurnDowns(db, userId, { teamOnly: true });
  for (const userId of players.slice(46, 50))
    await saveTurnDowns(db, userId, { weeklyNews: true });
  for (const userId of players.slice(50, 52))
    await saveTurnDowns(db, userId, {
      snoozedUntil: new Date(ctx.now.getTime() + 10 * DAY),
    });
  for (const userId of players.slice(52, 54))
    await setTopic(db, userId, "announcement", "email", false, "email_link");
  return true;
}

/**
 * Three players on other teams are quietly open to a new team next season.
 * The demo captain sees only a count until one accepts an invite; admins
 * see who and why.
 */
async function addMoveInterest(db: Db, ctx: Context): Promise<boolean> {
  const notes = [
    "My friends are moving to a later game time.",
    null,
    "Looking for a more competitive team.",
  ];
  const audiences = ["both", "captains", "admins"] as const;
  let added = 0;
  for (const [i, team] of ctx.teams.slice(4, 7).entries()) {
    const userId = team.players[4];
    if (!userId) continue;
    await setMoveInterest(db, {
      userId,
      leagueId: ctx.leagueId,
      audience: audiences[i] ?? "both",
      note: notes[i] ?? null,
      now: new Date(ctx.now.getTime() - (i + 2) * DAY),
    });
    added++;
  }
  // The demo captain leads the team again in the season that's signing
  // up, so the team page shows the recruiting count.
  const [mine] = await db
    .select({ id: teamSeason.id, seasonId: teamSeason.seasonId })
    .from(teamSeason)
    .innerJoin(season, eq(teamSeason.seasonId, season.id))
    .where(
      and(
        eq(season.leagueId, ctx.leagueId),
        eq(season.status, "registration_open"),
        eq(
          teamSeason.teamId,
          db
            .select({ teamId: teamSeason.teamId })
            .from(teamSeason)
            .where(eq(teamSeason.id, ctx.teams[0]?.id ?? ctx.seasonId)),
        ),
      ),
    )
    .limit(1);
  if (mine) {
    const [entry] = await db
      .insert(registration)
      .values({
        seasonId: mine.seasonId,
        userId: PERSONA_IDS.captain,
        kind: "team_member",
        status: "active",
      })
      .returning({ id: registration.id });
    if (entry)
      await db.insert(rosterMembership).values({
        teamSeasonId: mine.id,
        registrationId: entry.id,
        role: "captain",
        status: "active",
        startedAt: new Date(ctx.now.getTime() - 3 * DAY),
        sharesContact: true,
      });
  }
  return added > 0;
}

/**
 * The last finished season's leadership check-in, open for another week.
 * About half of most rosters have answered, including some who volunteer
 * or suggest a teammate. The demo ref played that season, so viewing as
 * Ref shows a player's private check-in still to do.
 */
async function addLeadershipCheckIn(db: Db, ctx: Context): Promise<boolean> {
  if (!ctx.pastSeasonId) return false;
  const opened = await openCheckIns(db, {
    seasonId: ctx.pastSeasonId,
    days: 7,
    actorId: ctx.adminId,
    now: new Date(ctx.now.getTime() - 2 * DAY),
  });
  if (!opened.ok) throw new Error(`Demo check-in failed: ${opened.error}`);
  const checkIns = await db
    .select({
      id: leadershipCheckIn.id,
      teamSeasonId: leadershipCheckIn.teamSeasonId,
    })
    .from(leadershipCheckIn)
    .innerJoin(teamSeason, eq(leadershipCheckIn.teamSeasonId, teamSeason.id))
    .where(eq(teamSeason.seasonId, ctx.pastSeasonId))
    .orderBy(asc(leadershipCheckIn.teamSeasonId));
  for (const [t, checkIn] of checkIns.entries()) {
    const roster = await db
      .select({ userId: registration.userId, role: rosterMembership.role })
      .from(rosterMembership)
      .innerJoin(
        registration,
        eq(rosterMembership.registrationId, registration.id),
      )
      .where(
        and(
          eq(rosterMembership.teamSeasonId, checkIn.teamSeasonId),
          eq(rosterMembership.status, "active"),
        ),
      )
      .orderBy(asc(registration.createdAt));
    const players = roster.filter(
      (m) => m.role === "player" && m.userId !== PERSONA_IDS.ref,
    );
    // Teams answer at different rates, so the screen shows a spread.
    const answering = players.slice(
      0,
      Math.max(2, players.length - 3 - (t % 4) * 2),
    );
    for (const [i, m] of answering.entries()) {
      const teammate = players[(i + 1) % players.length];
      const done = await submitCheckIn(db, {
        checkInId: checkIn.id,
        userId: m.userId,
        choice: {
          volunteer: i === 0 ? ["co_captain"] : [],
          suggest:
            i % 3 === 1 && teammate && teammate.userId !== m.userId
              ? { userId: teammate.userId, role: "captain" }
              : null,
          steppingDown: false,
        },
        now: new Date(ctx.now.getTime() - DAY + i * 600_000),
      });
      if (!done.ok)
        throw new Error(`Demo check-in answer failed: ${done.error}`);
    }
  }
  return checkIns.length > 0;
}

/**
 * More answers on the interest form, so the Thursday option reaches the
 * teams it needs and the "open a league" step has a reason to be there.
 */
async function addInterestAnswers(db: Db, ctx: Context): Promise<boolean> {
  const [form] = await db
    .select({ id: interestForm.id })
    .from(interestForm)
    .where(eq(interestForm.leagueId, ctx.leagueId))
    .limit(1);
  if (!form) return false;
  const options = await db
    .select({ id: interestOption.id, night: interestOption.night })
    .from(interestOption)
    .where(
      and(
        eq(interestOption.formId, form.id),
        isNull(interestOption.openedLeagueId),
      ),
    );
  const thursday = options.find((o) => o.night === "thursday");
  const sunday = options.find((o) => o.night === "sunday");
  if (!thursday) return false;
  for (let i = 0; i < 34; i++) {
    const saved = await saveAnswer(db, {
      formId: form.id,
      now: new Date(ctx.now.getTime() - (i + 1) * 5 * 3_600_000),
      answer: {
        email: `curious-${i + 1}@example.test`,
        friends: [0, 1, 3, 10][i % 4] ?? 0,
        choices: [
          { optionId: thursday.id, response: i % 7 === 6 ? "unsure" : "yes" },
          ...(sunday && i % 3 === 0
            ? [
                {
                  optionId: sunday.id,
                  response: i % 2 ? "yes" : "unsure",
                } as const,
              ]
            : []),
        ],
      },
    });
    if (!saved.ok)
      throw new Error(`Demo interest answer failed: ${saved.error}`);
  }
  return true;
}

/**
 * The partner tournament fills up: two more guest teams, the first guest
 * team's players signing the waiver from their captain's link, and two
 * dozen of the league's own players going.
 */
async function addTournamentTeams(db: Db, ctx: Context): Promise<boolean> {
  const [found] = await db
    .select({ eventId: tournament.eventId })
    .from(tournament)
    .innerJoin(event, eq(tournament.eventId, event.id))
    .where(eq(event.leagueId, ctx.leagueId))
    .limit(1);
  const [current] = await db
    .select({ id: waiver.id, sha: waiver.bodySha256 })
    .from(waiver)
    .where(eq(waiver.leagueId, ctx.leagueId))
    .orderBy(sql`${waiver.version} desc`)
    .limit(1);
  if (!found || !current) return false;
  const teams = await db
    .insert(guestTeam)
    .values([
      {
        eventId: found.eventId,
        name: "Harbor Hoppers",
        captainName: "Jordan Sample",
        captainEmail: "jordan@example.test",
        rosterSize: 11,
        linkToken: newLinkToken(),
      },
      {
        eventId: found.eventId,
        name: "Sunset Social Club",
        captainName: "Riley Example",
        captainEmail: "riley@example.test",
        rosterSize: 12,
        linkToken: newLinkToken(),
      },
    ])
    .returning({ id: guestTeam.id });
  const [first] = await db
    .select({ id: guestTeam.id })
    .from(guestTeam)
    .where(eq(guestTeam.eventId, found.eventId))
    .orderBy(asc(guestTeam.createdAt), asc(guestTeam.name))
    .limit(1);
  const names = [
    "Avery Example",
    "Blake Sample",
    "Casey Test",
    "Drew Example",
    "Emery Sample",
    "Finley Test",
    "Harper Example",
  ];
  for (const team of [first, teams[0]])
    if (team)
      await db.insert(guestWaiverSignature).values(
        names.slice(0, team === first ? 7 : 4).map((signedName, i) => ({
          guestTeamId: team.id,
          waiverId: current.id,
          signedName,
          signedAt: new Date(ctx.now.getTime() - (i + 1) * 7_200_000),
          bodySha256: current.sha,
        })),
      );
  const going = ctx.teams.flatMap((t) => t.players.slice(0, 3)).slice(0, 24);
  if (going.length)
    await db
      .insert(eventRsvp)
      .values(
        going.map((userId) => ({
          eventId: found.eventId,
          userId,
          status: "going" as const,
        })),
      )
      .onConflictDoNothing();
  return true;
}

/**
 * Some players read the league in another language: their emails and push
 * come in it, so the demo's mail shows a few translated messages. Runs
 * before the live step queues tonight's reminders and alerts.
 */
export async function addDemoLanguages(
  db: Db,
  leagueId: LeagueId,
): Promise<number> {
  const choices: Locale[] = ["es", "es", "es", "zh", "ru", "es"];
  const people = await db
    .select({ userId: registration.userId })
    .from(registration)
    .innerJoin(season, eq(registration.seasonId, season.id))
    .where(
      and(
        eq(season.leagueId, leagueId),
        eq(season.status, "in_progress"),
        ne(registration.userId, PERSONA_IDS.player),
        ne(registration.userId, PERSONA_IDS.captain),
      ),
    )
    .orderBy(asc(registration.userId))
    .limit(choices.length * 2);
  const picked = people.filter((_, i) => i % 2 === 0);
  for (const [i, p] of picked.entries())
    await db
      .update(profile)
      .set({ language: choices[i] ?? "es" })
      .where(eq(profile.userId, p.userId));
  return picked.length;
}

export const forTests = { addDays, localParts, zoned };

/**
 * Leagues a demo visitor opened from the demo league's interest form (the
 * "open as a new league" step). The reseed replaces the form but not the
 * leagues, so without this each rehearsal would leave one behind. Only a
 * league that is still an untouched draft goes: every season a draft with
 * no sign-ups. Returns how many were removed.
 */
export async function removeOpenedDemoLeagues(
  db: Db,
  demoSlug: string,
): Promise<number> {
  const opened = await db
    .select({ id: interestOption.openedLeagueId })
    .from(interestOption)
    .innerJoin(interestForm, eq(interestOption.formId, interestForm.id))
    .innerJoin(league, eq(interestForm.leagueId, league.id))
    .where(
      and(eq(league.slug, demoSlug), isNotNull(interestOption.openedLeagueId)),
    );
  let removed = 0;
  for (const { id } of opened) {
    if (!id) continue;
    const [used] = await db
      .select({ n: count() })
      .from(season)
      .leftJoin(registration, eq(registration.seasonId, season.id))
      .where(
        and(
          eq(season.leagueId, id),
          sql`(${season.status} <> 'draft' or ${registration.id} is not null)`,
        ),
      );
    if ((used?.n ?? 0) > 0) continue;
    await db.delete(season).where(eq(season.leagueId, id));
    await db.delete(ruleSet).where(eq(ruleSet.leagueId, id));
    await db.delete(league).where(eq(league.id, id));
    removed++;
  }
  return removed;
}
