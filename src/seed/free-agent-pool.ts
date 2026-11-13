import type { Db } from "@/db/queries/schedule";
import {
  freeAgentProfile,
  friendGroup,
  profile,
  registration,
  user,
} from "@/db/schema";
import type { FriendGroupId, RegistrationId, UserId } from "@/domain/ids";
import { parseQuiz } from "@/domain/matcher/quiz";
import { SEED_EMAIL_DOMAIN, type SeedData } from "./generate";

/**
 * A free-agent pool for the seeded spring season, for the quiz and the
 * matcher: people who signed up alone or with friends, most of them with
 * quiz answers, two friend groups and two volunteer captains. Every name is
 * invented. Fixed ids in their own range, so the generated league's ids stay
 * the same.
 */

const poolId = <T extends string>(n: number) =>
  `fa171000-0000-4000-8000-${String(n).padStart(12, "0")}` as T;

type Agent = {
  first: string;
  last: string;
  side: "woman" | "man";
  group?: "a" | "b";
  /** Quiz answers, or null for someone who has not taken it yet. */
  quiz: {
    experience: string;
    positions: string[];
    availability: string;
    vibe: string;
    captain: string;
  } | null;
};

const q = (
  experience: string,
  availability: string,
  vibe: string,
  captain = "no",
  positions: string[] = [],
) => ({ experience, positions, availability, vibe, captain });

export const FREE_AGENTS: readonly Agent[] = [
  {
    first: "Juniper",
    last: "Ashgrove",
    side: "woman",
    group: "a",
    quiz: q("some", "every_week", "social", "yes", ["pitcher"]),
  },
  {
    first: "Tobin",
    last: "Ashgrove",
    side: "man",
    group: "a",
    quiz: q("a_little", "most_weeks", "social"),
  },
  {
    first: "Marisol",
    last: "Quillfeather",
    side: "woman",
    group: "a",
    quiz: q("new", "most_weeks", "social", "no", ["outfield"]),
  },
  {
    first: "Dashiell",
    last: "Brambleton",
    side: "man",
    quiz: q("competitive", "every_week", "competitive", "help", ["catcher"]),
  },
  {
    first: "Wren",
    last: "Halloway",
    side: "woman",
    quiz: q("regular", "every_week", "both", "no", ["infield"]),
  },
  {
    first: "Osric",
    last: "Pennyworth",
    side: "man",
    group: "b",
    quiz: q("some", "some_weeks", "both"),
  },
  {
    first: "Calla",
    last: "Pennyworth",
    side: "woman",
    group: "b",
    quiz: q("a_little", "some_weeks", "both", "no", ["outfield"]),
  },
  {
    first: "Ignatius",
    last: "Fairweather",
    side: "man",
    quiz: q("regular", "most_weeks", "competitive", "yes", [
      "infield",
      "pitcher",
    ]),
  },
  {
    first: "Saffron",
    last: "Mirefield",
    side: "woman",
    quiz: q("new", "every_week", "social"),
  },
  {
    first: "Bartholomew",
    last: "Kettleby",
    side: "man",
    quiz: q("some", "most_weeks", "social", "no", ["outfield"]),
  },
  { first: "Philippa", last: "Duskwood", side: "woman", quiz: null },
  { first: "Lazlo", last: "Thistlewood", side: "man", quiz: null },
];

/** Fixed codes for the seeded groups; they use the friend-code alphabet. */
const CODES = { a: "KCK234", b: "PAX789" } as const;

export function generateFreeAgentPool(data: SeedData) {
  const seasonId = data.nextSeason.id;
  let n = 0;
  const next = <T extends string>() => poolId<T>(++n);
  const groups = {
    a: { id: next<FriendGroupId>(), seasonId, code: CODES.a },
    b: { id: next<FriendGroupId>(), seasonId, code: CODES.b },
  };
  const rows = FREE_AGENTS.map((a, i) => {
    const userId = next<UserId>();
    const registrationId = next<RegistrationId>();
    const parsed = a.quiz ? parseQuiz(a.quiz) : null;
    if (parsed && !parsed.ok) throw new Error(`Bad seed quiz: ${parsed.error}`);
    return {
      user: {
        id: userId,
        name: `${a.first} ${a.last}`,
        email:
          `${a.first}.${a.last}.fa${i + 1}@${SEED_EMAIL_DOMAIN}`.toLowerCase(),
        emailVerified: true,
      },
      profile: {
        userId,
        firstName: a.first,
        lastName: a.last,
        gender: a.side,
        lineupGender: a.side,
        shirtSize: "m" as const,
        globalRole: "player" as const,
      },
      registration: {
        id: registrationId,
        seasonId,
        userId,
        kind: "free_agent" as const,
        status:
          i % 4 === 3 ? ("pending_payment" as const) : ("active" as const),
        friendGroupId: a.group ? groups[a.group].id : null,
      },
      quiz: parsed?.ok
        ? {
            registrationId,
            answers: parsed.value.answers,
            skillScore: parsed.value.skillScore,
            vibeScore: parsed.value.vibeScore,
            wouldCaptain: parsed.value.wouldCaptain,
            notes: parsed.value.notes,
          }
        : null,
    };
  });
  return { groups: Object.values(groups), rows };
}

export async function addFreeAgentPool(db: Db, data: SeedData): Promise<void> {
  const pool = generateFreeAgentPool(data);
  await db.insert(user).values(pool.rows.map((r) => r.user));
  await db.insert(profile).values(pool.rows.map((r) => r.profile));
  await db.insert(friendGroup).values(pool.groups);
  await db.insert(registration).values(pool.rows.map((r) => r.registration));
  await db
    .insert(freeAgentProfile)
    .values(pool.rows.flatMap((r) => (r.quiz ? [r.quiz] : [])));
}
