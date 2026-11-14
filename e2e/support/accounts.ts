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
      `insert into profile (user_id, first_name, last_name, global_role)
       values ($1, 'Robin', 'Example', 'player'), ($2, 'Robin', null, 'player')`,
      [kept.id, dup.id],
    );
    await client.query(
      `insert into credit_entry (user_id, delta_cents, reason, note)
       values ($1, 1000, 'goodwill', 'Thanks for helping out')`,
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
