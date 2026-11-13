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

  it("has more than one activity, so the page shows its grouping", () => {
    expect(new Set(SEED_FRIENDS.map((f) => f.activity)).size).toBeGreaterThan(
      1,
    );
  });
});
