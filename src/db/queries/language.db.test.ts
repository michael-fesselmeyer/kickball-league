import { afterAll, describe, expect, it } from "vitest";
import type { UserId } from "@/domain/ids";
import { ok } from "@/domain/result";
import type { Locale } from "@/i18n/locales";
import { user } from "../schema/auth";
import { profile } from "../schema/profile";
import { closePool, inRolledBackDb } from "../test/transaction";
import { drainOutbox, enqueueMessages, type Renderer } from "./outbox";
import { profileOf, saveLanguage } from "./profile";
import { required } from "./rows";
import type { Db } from "./schedule";

afterAll(closePool);

const NOW = new Date("2026-09-14T15:00:00Z");

async function person(db: Db, withProfile = true): Promise<UserId> {
  const tag = Math.random().toString(36).slice(2, 10);
  const [row] = await db
    .insert(user)
    .values({ name: "Ana", email: `lang-${tag}@example.test` })
    .returning({ id: user.id });
  const id = required(row, "user").id;
  if (withProfile) await db.insert(profile).values({ userId: id });
  return id;
}

describe("a person's language", () => {
  it("is English until they pick, then theirs, with or without a profile", async () => {
    await inRolledBackDb(async (db) => {
      const ana = await person(db);
      expect((await profileOf(db, ana))?.language).toBe("en");
      await saveLanguage(db, ana, "es");
      expect((await profileOf(db, ana))?.language).toBe("es");
      // Someone who never filled in a profile can still pick one.
      const new_ = await person(db, false);
      await saveLanguage(db, new_, "es");
      expect((await profileOf(db, new_))?.language).toBe("es");
    });
  });

  it("refuses a language the site doesn't have", async () => {
    await inRolledBackDb(async (db) => {
      const ana = await person(db);
      await expect(saveLanguage(db, ana, "de" as Locale)).rejects.toThrow();
    });
  });

  it("reaches the email renderer as the message is sent, queued ones included", async () => {
    await inRolledBackDb(async (db) => {
      const ana = await person(db);
      const pat = await person(db);
      await enqueueMessages(
        db,
        [ana, pat].map((userId, i) => ({
          userId,
          topic: "announcement" as const,
          template: "sub_update" as const,
          payload: { name: "x" },
          dedupeKey: `lang-${i}`,
          sendAfter: NOW,
        })),
      );
      // Ana changes her language after the message was queued.
      await saveLanguage(db, ana, "es");
      const seen = new Map<UserId, Locale | undefined>();
      const render: Renderer = (_t, _p, recipient) => {
        if (recipient) seen.set(recipient.userId, recipient.locale);
        return ok({ subject: "Hi", html: "<p>Hi</p>", text: "Hi" });
      };
      await drainOutbox(db, {
        send: async () => ok({ id: "provider-1" }),
        render,
        now: NOW,
      });
      expect(seen.get(ana)).toBe("es");
      expect(seen.get(pat)).toBe("en");
    });
  });
});
