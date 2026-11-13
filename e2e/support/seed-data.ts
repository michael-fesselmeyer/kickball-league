import { readFile } from "node:fs/promises";
import type { Download, Locator } from "@playwright/test";
import { Client } from "pg";

/**
 * A seeded player who is none of the demo personas, so a flow can change
 * them without touching anyone another flow signs in as.
 */
export async function seededPlayerEmail(): Promise<string> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ email: string }>(
      `select u.email from "user" u join profile p on p.user_id = u.id
        where p.global_role = 'player'
          and u.id::text not like 'd3e30000-%'
        order by u.email limit 1`,
    );
    const row = rows[0];
    if (!row) throw new Error("The seed has no other players");
    return row.email;
  } finally {
    await client.end();
  }
}

/** Clicks a download link and returns the file's name and text. */
export async function download(
  link: Locator,
): Promise<{ name: string; text: string }> {
  const [file] = await Promise.all([
    link.page().waitForEvent("download"),
    link.click(),
  ]);
  return { name: file.suggestedFilename(), text: await textOf(file) };
}

async function textOf(file: Download): Promise<string> {
  const path = await file.path();
  return readFile(path, "utf8");
}
