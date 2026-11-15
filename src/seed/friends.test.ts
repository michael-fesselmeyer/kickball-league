import { describe, expect, it } from "vitest";
import { parseFriendForm } from "@/domain/friends/friend-form";
import { SEED_FRIENDS } from "./friends";

describe("seeded friends directory", () => {
  it("passes the admin form's checks, on invented example.test sites", () => {
    for (const entry of SEED_FRIENDS) {
      const fields = {
        name: entry.name,
        activity: entry.activity,
        area: entry.area,
        description: entry.description,
        url: entry.url,
        linksBack: entry.linksBack,
        runByPlayer: entry.runByPlayer,
        featured: entry.featured,
      };
      const parsed = parseFriendForm({
        ...fields,
        area: fields.area ?? "",
        description: fields.description ?? "",
      });
      expect(parsed).toEqual({ ok: true, value: fields });
      expect(new URL(fields.url).hostname).toMatch(/\.example\.test$/);
    }
  });

  it("has a featured club one of our players runs, for the events page", () => {
    expect(SEED_FRIENDS.some((f) => f.runByPlayer && f.featured)).toBe(true);
  });

  it("has more than one activity, so the page shows its grouping", () => {
    expect(new Set(SEED_FRIENDS.map((f) => f.activity)).size).toBeGreaterThan(
      1,
    );
  });
});
