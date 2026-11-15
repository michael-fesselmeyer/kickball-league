import { Client } from "pg";

/**
 * Two invented accounts for the same person, on the seed's own domain so the
 * next reseed removes them: the one they use, and a duplicate holding league
 * credit and an email setting that clashes with the kept one.
 */
export async function duplicateAccounts(): Promise<{
  keep: string;
  merge: string;
}> {
  const tag = `${Date.now()}`;
  const keep = `robin.kept.${tag}@seed.example`;
  const merge = `robin.second.${tag}@seed.example`;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string; email: string }>(
      `insert into "user" (name, email, email_verified)
       values ('Robin Example', $1, true), ('Robin E', $2, true)
       returning id, email`,
      [keep, merge],
    );
    const kept = rows.find((r) => r.email === keep);
    const dup = rows.find((r) => r.email === merge);
    if (!kept || !dup) throw new Error("Could not make the accounts");
    await client.query(
      `insert into profile (user_id, first_name, last_name)
       values ($1, 'Robin', 'Example'), ($2, 'Robin', null)`,
      [kept.id, dup.id],
    );
    await client.query(
      // Credit is the default league's (ADR 0048).
      `insert into credit_entry (user_id, league_id, delta_cents, reason, note)
       select $1, id, 1000, 'goodwill', 'Thanks for helping out'
         from league where is_default`,
      [dup.id],
    );
    await client.query(
      `insert into notification_preference (user_id, topic, channel, enabled)
       values ($1, 'events', 'email', true), ($2, 'events', 'email', false)`,
      [kept.id, dup.id],
    );
    return { keep, merge };
  } finally {
    await client.end();
  }
}

/**
 * A made-up owner for one flow, on the seed's own domain so the next reseed
 * removes it. A flow that signs in as its own owner (with `pageSignedInAs`)
 * never shares a session with the demo personas another flow is switching
 * between at the same time.
 */
export async function ownerAccount(first: string): Promise<string> {
  const email = `${first.toLowerCase()}.owner.${Date.now()}.${Math.random()
    .toString(36)
    .slice(2, 6)}@seed.example`;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string }>(
      `insert into "user" (name, email, email_verified)
       values ($1, $2, true) returning id`,
      [`${first} Owner`, email],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error("Could not make the owner");
    await client.query(
      `insert into profile (user_id, first_name, last_name)
       values ($1, $2, 'Owner')`,
      [id, first],
    );
    // An owner of the default league (ADR 0048).
    await client.query(
      `insert into league_member (league_id, user_id, role)
       select id, $1, 'owner' from league where is_default`,
      [id],
    );
    return email;
  } finally {
    await client.end();
  }
}
