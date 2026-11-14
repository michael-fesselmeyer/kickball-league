import { asc, eq, inArray, type SQL, sql } from "drizzle-orm";
import type { UserId } from "@/domain/ids";
import {
  fillProfile,
  type MergeBlocker,
  MERGED_NAME,
  mergedEmail,
  normalizeEmail,
  PERSON_COLUMNS,
  type PersonRule,
  registrationToKeep,
  roleBlocks,
  signatureToKeep,
} from "@/domain/account-merge/rules";
import { err, ok, type Result } from "@/domain/result";
import { accountMerge } from "../schema/account-merge";
import { session, user } from "../schema/auth";
import { profile } from "../schema/profile";
import { invite } from "../schema/team";
import { recordAudit } from "./audit";
import { mergeEmergencyContact } from "./emergency";
import type { Db } from "./schedule";

/**
 * Merging a duplicate account into another (ADR 0041). An admin picks the
 * account to keep and the one to merge away; every record that points at a
 * person moves to the kept account in one transaction, following the rules
 * in src/domain/account-merge/rules.ts. The merged-away account keeps its
 * row, renamed and with an address that cannot receive mail, so it can no
 * longer sign in; its old address becomes an alias of the kept account.
 */

/** Reads the rows of a raw query on either database driver. */
async function rowsOf<T>(db: Db, query: SQL): Promise<T[]> {
  const result: unknown = await db.execute(query);
  return (result as { rows?: T[] }).rows ?? [];
}

/** Runs a statement that ends in `returning 1` and counts its rows. */
async function counted(db: Db, statement: SQL): Promise<number> {
  const [row] = await rowsOf<{ n: number }>(
    db,
    sql`with changed as (${statement}) select count(*)::int as n from changed`,
  );
  return row?.n ?? 0;
}

const id = (name: string) => sql.raw(`"${name.replace(/"/g, "")}"`);

function split(column: string): [string, string] {
  const [table, col] = column.split(".");
  if (!table || !col) throw new Error(`Bad person column ${column}`);
  return [table, col];
}

/** The clause that finds a merged-away row with a twin on the kept account. */
function clashExists(
  table: string,
  col: string,
  rule: Extract<PersonRule, { kind: "dedupe" }>,
  keptId: UserId,
) {
  const same = rule.by.map(
    (b) => sql` and k.${id(b)} is not distinct from m.${id(b)}`,
  );
  return sql`exists (select 1 from ${id(table)} k where k.${id(col)} = ${keptId}${
    rule.where ? sql.raw(` and (${rule.where})`) : sql``
  }${sql.join(same, sql``)})`;
}

const matches = (rule: Extract<PersonRule, { kind: "dedupe" }>) =>
  rule.where ? sql.raw(` and (${rule.where})`) : sql``;

export type AccountSummary = {
  id: UserId;
  email: string;
  name: string;
  createdAt: Date;
  role: string;
  /** This account was merged away into another one. */
  mergedInto: UserId | null;
};

/**
 * The account an email address belongs to, following aliases: an address
 * that was merged away finds the account it was merged into.
 */
export async function accountByEmail(
  db: Db,
  raw: string,
): Promise<(AccountSummary & { viaAlias: boolean }) | null> {
  const email = normalizeEmail(raw);
  if (!email) return null;
  const [direct] = await db
    .select({ id: user.id })
    .from(user)
    .where(sql`lower(${user.email}) = ${email}`);
  let found = direct?.id ?? null;
  let viaAlias = false;
  if (!found) {
    const [alias] = await db
      .select({ id: accountMerge.keptUserId })
      .from(accountMerge)
      .where(eq(accountMerge.mergedEmail, email));
    found = alias?.id ?? null;
    viaAlias = found !== null;
  }
  if (!found) return null;
  const summary = await accountSummary(db, found);
  return summary ? { ...summary, viaAlias } : null;
}

export async function accountSummary(
  db: Db,
  userId: UserId,
): Promise<AccountSummary | null> {
  const [row] = await db
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
      first: profile.firstName,
      last: profile.lastName,
      role: profile.globalRole,
    })
    .from(user)
    .leftJoin(profile, eq(profile.userId, user.id))
    .where(eq(user.id, userId));
  if (!row) return null;
  const [merged] = await db
    .select({ into: accountMerge.keptUserId })
    .from(accountMerge)
    .where(eq(accountMerge.mergedUserId, userId));
  return {
    id: row.id,
    email: row.email,
    name: [row.first, row.last].filter(Boolean).join(" ") || row.name,
    createdAt: row.createdAt,
    role: row.role ?? "player",
    mergedInto: merged?.into ?? null,
  };
}

/** The canonical address for a sign-in: an alias gives the kept account's. */
export async function canonicalEmail(
  db: Db,
  raw: string,
): Promise<string | null> {
  const email = normalizeEmail(raw);
  const [row] = await db
    .select({ email: user.email })
    .from(accountMerge)
    .innerJoin(user, eq(user.id, accountMerge.keptUserId))
    .where(eq(accountMerge.mergedEmail, email));
  return row?.email ?? null;
}

type Pair = { keptId: UserId; mergedId: UserId };

/** Registrations both accounts hold for the same season. */
async function sharedRegistrations(db: Db, { keptId, mergedId }: Pair) {
  return rowsOf<{
    season: string;
    keptId: string;
    mergedId: string;
    keptEmpty: boolean;
    mergedEmpty: boolean;
  }>(
    db,
    sql`
      with mine as (
        select r.id, r.season_id, r.user_id,
          not exists (select 1 from purchase_item pi where pi.registration_id = r.id)
          and not exists (select 1 from referral f where f.registration_id = r.id)
          and not exists (
            select 1 from roster_membership rm
             where rm.registration_id = r.id and rm.status = 'active'
          ) as empty
          from registration r where r.user_id in (${keptId}, ${mergedId})
      )
      select s.name as season, k.id as "keptId", m.id as "mergedId",
             k.empty as "keptEmpty", m.empty as "mergedEmpty"
        from mine k join mine m on m.season_id = k.season_id
        join season s on s.id = k.season_id
       where k.user_id = ${keptId} and m.user_id = ${mergedId}
       order by s.starts_on`,
  );
}

/** Waivers both accounts signed for the same season. */
async function sharedSignatures(db: Db, { keptId, mergedId }: Pair) {
  return rowsOf<{
    keptId: string;
    mergedId: string;
    keptAt: Date;
    mergedAt: Date;
  }>(
    db,
    sql`
      select k.id as "keptId", m.id as "mergedId",
             k.signed_at as "keptAt", m.signed_at as "mergedAt"
        from waiver_signature k
        join waiver_signature m
          on m.waiver_id = k.waiver_id
         and m.season_id is not distinct from k.season_id
       where k.user_id = ${keptId} and m.user_id = ${mergedId}`,
  );
}

export type MergeLine = { label: string; count: number };

export type MergePreview = {
  kept: AccountSummary;
  merged: AccountSummary;
  /** Records that move, by kind. */
  moves: MergeLine[];
  /** Records both accounts hold where the database allows one, and how each is settled. */
  conflicts: MergeLine[];
  blockers: MergeBlocker[];
};

/** Every count the preview and the summary show, in one query. */
async function moveCounts(db: Db, mergedId: UserId): Promise<MergeLine[]> {
  const parts = Object.entries(PERSON_COLUMNS)
    .filter(([, rule]) => rule.kind !== "skip")
    .map(([column, rule]) => {
      const [table, col] = split(column);
      const label = rule.kind === "skip" ? "" : rule.label;
      return sql`select ${label}::text as label, count(*)::int as n from ${id(table)} where ${id(col)} = ${mergedId}`;
    });
  const rows = await rowsOf<{ label: string; n: number }>(
    db,
    sql.join(parts, sql` union all `),
  );
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.label, (totals.get(r.label) ?? 0) + r.n);
  return [...totals.entries()]
    .filter(([, n]) => n > 0)
    .map(([label, count]) => ({ label, count }));
}

async function conflictCounts(
  db: Db,
  pair: Pair,
  shared: {
    registrations: Awaited<ReturnType<typeof sharedRegistrations>>;
    signatures: Awaited<ReturnType<typeof sharedSignatures>>;
  },
): Promise<MergeLine[]> {
  const { keptId, mergedId } = pair;
  const lines: MergeLine[] = [];
  for (const [column, rule] of Object.entries(PERSON_COLUMNS)) {
    if (rule.kind !== "dedupe") continue;
    const [table, col] = split(column);
    const [row] = await rowsOf<{ n: number }>(
      db,
      sql`select count(*)::int as n from ${id(table)} m where m.${id(col)} = ${mergedId}${matches(rule)} and ${clashExists(table, col, rule, keptId)}`,
    );
    if (row && row.n > 0) lines.push({ label: rule.clash, count: row.n });
  }
  const registrations = shared.registrations.filter(
    (r) => r.keptEmpty || r.mergedEmpty,
  );
  if (registrations.length > 0)
    lines.push({
      label:
        "Both registered for the same season; the registration with a payment or team spot stays and the empty one is removed",
      count: registrations.length,
    });
  if (shared.signatures.length > 0)
    lines.push({
      label:
        "Both signed the same season's waiver; the earliest signature is kept",
      count: shared.signatures.length,
    });
  const [special] = await rowsOf<{
    votes: number;
    selfVotes: number;
    referred: number;
    selfReferrals: number;
    single: number;
  }>(
    db,
    sql`select
      (select count(*)::int from award_vote m where m.voter_id = ${mergedId}
         and exists (select 1 from award_vote k where k.voter_id = ${keptId}
                      and k.award_poll_id = m.award_poll_id)) as votes,
      (select count(*)::int from award_vote v
        where (v.voter_id = ${mergedId} and v.nominee_user_id = ${keptId})
           or (v.voter_id = ${keptId} and v.nominee_user_id = ${mergedId})) as "selfVotes",
      (select count(*)::int from referral m where m.referred_user_id = ${mergedId}
         and exists (select 1 from referral k where k.referred_user_id = ${keptId})) as referred,
      (select count(*)::int from referral f
        where (f.referrer_user_id = ${keptId} and f.referred_user_id = ${mergedId})
           or (f.referrer_user_id = ${mergedId} and f.referred_user_id = ${keptId})) as "selfReferrals",
      ((select count(*)::int from alert_setting where user_id = ${keptId}) *
         (select count(*)::int from alert_setting where user_id = ${mergedId})
       + (select count(*)::int from calendar_feed where user_id = ${keptId}) *
         (select count(*)::int from calendar_feed where user_id = ${mergedId})
       + (select count(*)::int from referral_code where user_id = ${keptId}) *
         (select count(*)::int from referral_code where user_id = ${mergedId})) as single`,
  );
  if (special?.votes)
    lines.push({
      label:
        "Both voted in the same awards poll; the kept account's vote counts",
      count: special.votes,
    });
  if (special?.selfVotes)
    lines.push({
      label:
        "One account voted for the other; a vote for yourself isn't allowed, so it is removed",
      count: special.selfVotes,
    });
  if (special?.referred)
    lines.push({
      label:
        "Both were referred by someone; the kept account's referral stands (an uncredited one is removed, a credited one stays as history)",
      count: special.referred,
    });
  if (special?.selfReferrals)
    lines.push({
      label:
        "One account referred the other; an uncredited referral is removed, a credited one stays as history",
      count: special.selfReferrals,
    });
  if (special?.single)
    lines.push({
      label:
        "Both have alert settings, a calendar feed or a referral link; the kept account's stay",
      count: special.single,
    });
  return lines;
}

async function blockersFor(
  db: Db,
  kept: AccountSummary,
  merged: AccountSummary,
  actorId: UserId,
  registrations: Awaited<ReturnType<typeof sharedRegistrations>>,
): Promise<MergeBlocker[]> {
  const blockers: MergeBlocker[] = [];
  if (kept.id === merged.id) return [{ kind: "same_account" }];
  if (merged.id === actorId) blockers.push({ kind: "acting_admin" });
  if (kept.mergedInto) blockers.push({ kind: "already_merged", which: "kept" });
  if (merged.mergedInto)
    blockers.push({ kind: "already_merged", which: "merged" });
  if (roleBlocks(kept.role, merged.role))
    blockers.push({ kind: "higher_role", role: merged.role });
  for (const r of registrations)
    if (
      registrationToKeep({ empty: r.keptEmpty }, { empty: r.mergedEmpty }) ===
      "blocked"
    )
      blockers.push({ kind: "both_registered", season: r.season });
  const rebates = await rowsOf<{ season: string }>(
    db,
    sql`select distinct s.name as season
          from credit_entry k
          join credit_entry m on m.rebate_id = k.rebate_id
          join season_rebate sr on sr.id = k.rebate_id
          join season s on s.id = sr.season_id
         where k.user_id = ${kept.id} and m.user_id = ${merged.id}`,
  );
  for (const r of rebates)
    blockers.push({ kind: "both_rebated", season: r.season });
  return blockers;
}

/** What a merge would do, without changing anything. */
export async function mergePreview(
  db: Db,
  input: Pair & { actorId: UserId },
): Promise<MergePreview | null> {
  const [kept, merged] = await Promise.all([
    accountSummary(db, input.keptId),
    accountSummary(db, input.mergedId),
  ]);
  if (!kept || !merged) return null;
  if (kept.id === merged.id)
    return {
      kept,
      merged,
      moves: [],
      conflicts: [],
      blockers: [{ kind: "same_account" }],
    };
  const [registrations, signatures, moves] = await Promise.all([
    sharedRegistrations(db, input),
    sharedSignatures(db, input),
    moveCounts(db, input.mergedId),
  ]);
  const [conflicts, blockers] = await Promise.all([
    conflictCounts(db, input, { registrations, signatures }),
    blockersFor(db, kept, merged, input.actorId, registrations),
  ]);
  return { kept, merged, moves, conflicts, blockers };
}

const PROFILE_FIELDS = [
  "firstName",
  "lastName",
  "phoneE164",
  "phoneVerifiedAt",
  "gender",
  "lineupGender",
  "shirtSize",
  "birthDate",
  "stripeCustomerId",
] as const;

/** Deletes a registration that holds nothing, with its non-active spots. */
async function dropEmptyRegistration(db: Db, registrationId: string) {
  await db.execute(
    sql`delete from roster_membership where registration_id = ${registrationId} and status <> 'active'`,
  );
  await db.execute(sql`delete from registration where id = ${registrationId}`);
}

export type MergeError = "unknown_account" | "blocked";

/**
 * Merges `mergedId` into `keptId`. Call it inside a transaction: both
 * accounts are locked, every rule runs, and the merge record and the audit
 * row are written together, or nothing changes.
 */
export async function mergeAccounts(
  db: Db,
  input: Pair & {
    actorId: UserId;
    now: Date;
    /** The auth secret, to carry a sealed emergency contact across. */
    secret: string;
  },
): Promise<
  Result<{ moved: Record<string, number> }, MergeError | MergeBlocker[]>
> {
  const { keptId, mergedId, now } = input;
  await db
    .select({ id: user.id })
    .from(user)
    .where(inArray(user.id, [keptId, mergedId]))
    .orderBy(asc(user.id))
    .for("update");
  const preview = await mergePreview(db, input);
  if (!preview) return err("unknown_account");
  if (preview.blockers.length > 0) return err(preview.blockers);
  const { kept, merged } = preview;
  const moved: Record<string, number> = {};
  const tally = (label: string, n: number) => {
    if (n > 0) moved[label] = (moved[label] ?? 0) + n;
  };

  // Sign-in: the merged-away account's sessions end.
  tally(
    "sessions ended",
    await counted(
      db,
      sql`delete from session where user_id = ${mergedId} returning 1`,
    ),
  );

  // Registrations for the same season: the empty one gives way.
  for (const r of await sharedRegistrations(db, input)) {
    const keep = registrationToKeep(
      { empty: r.keptEmpty },
      { empty: r.mergedEmpty },
    );
    if (keep === "blocked")
      return err([{ kind: "both_registered", season: r.season }]);
    await dropEmptyRegistration(db, keep === "kept" ? r.mergedId : r.keptId);
    tally("duplicate registrations removed", 1);
  }

  // Waivers signed twice: the earliest signature stays.
  for (const s of await sharedSignatures(db, input)) {
    const keep = signatureToKeep(
      { signedAt: new Date(s.keptAt) },
      { signedAt: new Date(s.mergedAt) },
    );
    const [winner, loser] =
      keep === "kept" ? [s.keptId, s.mergedId] : [s.mergedId, s.keptId];
    await db.execute(
      sql`update registration set waiver_signature_id = ${winner} where waiver_signature_id = ${loser}`,
    );
    await db.execute(sql`delete from waiver_signature where id = ${loser}`);
    tally("duplicate waiver signatures removed", 1);
  }

  // Referrals that would now point at one person twice.
  tally(
    "referrals removed",
    await counted(
      db,
      sql`delete from referral f
           where f.status = 'pending'
             and ((f.referrer_user_id = ${keptId} and f.referred_user_id = ${mergedId})
               or (f.referrer_user_id = ${mergedId} and f.referred_user_id = ${keptId})
               or (f.referred_user_id = ${mergedId}
                   and exists (select 1 from referral k where k.referred_user_id = ${keptId})))
           returning 1`,
    ),
  );
  tally(
    "referrals made",
    await counted(
      db,
      sql`update referral set referrer_user_id = ${keptId}
           where referrer_user_id = ${mergedId} and referred_user_id <> ${keptId}
           returning 1`,
    ),
  );
  tally(
    "referral that brought them",
    await counted(
      db,
      sql`update referral set referred_user_id = ${keptId}
           where referred_user_id = ${mergedId} and referrer_user_id <> ${keptId}
             and not exists (select 1 from referral k where k.referred_user_id = ${keptId})
           returning 1`,
    ),
  );

  // Awards: one vote per poll, and never a vote for yourself.
  tally(
    "award votes removed",
    await counted(
      db,
      sql`delete from award_vote m
           where (m.voter_id = ${mergedId}
                  and exists (select 1 from award_vote k where k.voter_id = ${keptId}
                               and k.award_poll_id = m.award_poll_id))
              or (m.voter_id = ${mergedId} and m.nominee_user_id = ${keptId})
              or (m.voter_id = ${keptId} and m.nominee_user_id = ${mergedId})
           returning 1`,
    ),
  );
  tally(
    "award votes",
    await counted(
      db,
      sql`update award_vote set voter_id = ${keptId} where voter_id = ${mergedId} returning 1`,
    ),
  );
  tally(
    "award votes received",
    await counted(
      db,
      sql`update award_vote set nominee_user_id = ${keptId} where nominee_user_id = ${mergedId} returning 1`,
    ),
  );

  // One row per person: the kept account's wins.
  for (const table of ["alert_setting", "calendar_feed", "referral_code"]) {
    const rule = PERSON_COLUMNS[`${table}.user_id`];
    const label = rule && rule.kind !== "skip" ? rule.label : table;
    await db.execute(
      sql`delete from ${id(table)} where user_id = ${mergedId}
            and exists (select 1 from ${id(table)} k where k.user_id = ${keptId})`,
    );
    tally(
      label,
      await counted(
        db,
        sql`update ${id(table)} set user_id = ${keptId} where user_id = ${mergedId} returning 1`,
      ),
    );
  }

  // Profile: the kept profile stays and fills its gaps from the other.
  const [keptProfile] = await db
    .select()
    .from(profile)
    .where(eq(profile.userId, keptId));
  const [mergedProfile] = await db
    .select()
    .from(profile)
    .where(eq(profile.userId, mergedId));
  if (mergedProfile) {
    if (keptProfile) {
      const fill = fillProfile(keptProfile, mergedProfile, PROFILE_FIELDS);
      if (Object.keys(fill).length > 0) {
        await db.update(profile).set(fill).where(eq(profile.userId, keptId));
        tally("profile details filled in", Object.keys(fill).length);
      }
    } else {
      const carried = Object.fromEntries(
        PROFILE_FIELDS.map((f) => [f, mergedProfile[f]]),
      );
      await db.insert(profile).values({
        ...carried,
        userId: keptId,
        globalRole: mergedProfile.globalRole,
      });
    }
    await db.delete(profile).where(eq(profile.userId, mergedId));
  }

  // The emergency contact is sealed to its owner: carried over, sealed
  // again, only when the kept account has none.
  tally(
    "emergency contact",
    await mergeEmergencyContact(db, {
      keptId,
      mergedId,
      secret: input.secret,
      now,
    }),
  );

  // Everything else, by rule.
  for (const [column, rule] of Object.entries(PERSON_COLUMNS)) {
    if (rule.kind === "skip" || rule.kind === "special") continue;
    const [table, col] = split(column);
    if (rule.kind === "dedupe") {
      const clash = clashExists(table, col, rule, keptId);
      if (rule.resolve === "drop")
        tally(
          `${rule.label} (duplicates removed)`,
          await counted(
            db,
            sql`delete from ${id(table)} m where m.${id(col)} = ${mergedId}${matches(rule)} and ${clash} returning 1`,
          ),
        );
      else if (rule.resolve === "close" && rule.close)
        tally(
          `${rule.label} (duplicates closed)`,
          await counted(
            db,
            sql`update ${id(table)} m set ${sql.raw(rule.close)} where m.${id(col)} = ${mergedId}${matches(rule)} and ${clash} returning 1`,
          ),
        );
      tally(
        rule.label,
        await counted(
          db,
          sql`update ${id(table)} m set ${id(col)} = ${keptId}
               where m.${id(col)} = ${mergedId}${
                 rule.resolve === "leave"
                   ? sql` and not (${sql.raw(rule.where ?? "true")} and ${clash})`
                   : sql``
               }
               returning 1`,
        ),
      );
      continue;
    }
    if (rule.kind === "move")
      tally(
        rule.label,
        await counted(
          db,
          sql`update ${id(table)} set ${id(col)} = ${keptId} where ${id(col)} = ${mergedId} returning 1`,
        ),
      );
  }
  // Registrations, waivers and credit move like any other row now that
  // their clashes are settled.
  for (const column of [
    "registration.user_id",
    "waiver_signature.user_id",
    "credit_entry.user_id",
  ]) {
    const rule = PERSON_COLUMNS[column];
    const [table, col] = split(column);
    tally(
      rule && rule.kind !== "skip" ? rule.label : column,
      await counted(
        db,
        sql`update ${id(table)} set ${id(col)} = ${keptId} where ${id(col)} = ${mergedId} returning 1`,
      ),
    );
  }

  // Invitations sent to the old address now name the kept one.
  const oldEmail = normalizeEmail(merged.email);
  tally(
    "invitations re-addressed",
    await counted(
      db,
      sql`update ${invite} set email = ${kept.email}
           where lower(email) = ${oldEmail} returning 1`,
    ),
  );

  // The merged-away account can no longer sign in; its address is an alias.
  await db
    .update(user)
    .set({
      name: MERGED_NAME,
      email: mergedEmail(mergedId),
      emailVerified: false,
      image: null,
    })
    .where(eq(user.id, mergedId));
  await db.delete(session).where(eq(session.userId, mergedId));
  await db.insert(accountMerge).values({
    keptUserId: keptId,
    mergedUserId: mergedId,
    mergedEmail: oldEmail,
    summary: moved,
    mergedBy: input.actorId,
    createdAt: now,
  });
  await recordAudit(db, {
    actorId: input.actorId,
    action: "account.merge",
    entityType: "user",
    entityId: keptId,
    before: { mergedUserId: mergedId },
    after: { moved },
  });
  return ok({ moved });
}

/** Recent merges, newest first, for the admin screen. */
export async function recentMerges(db: Db, limit = 20) {
  return db
    .select({
      id: accountMerge.id,
      keptUserId: accountMerge.keptUserId,
      keptEmail: user.email,
      mergedEmail: accountMerge.mergedEmail,
      createdAt: accountMerge.createdAt,
    })
    .from(accountMerge)
    .innerJoin(user, eq(user.id, accountMerge.keptUserId))
    .orderBy(sql`${accountMerge.createdAt} desc`)
    .limit(limit);
}
