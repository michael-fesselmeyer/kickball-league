import { describe, expect, it } from "vitest";
import { PERSONA_EMAILS } from "@/lib/demo/personas";
import { keepOffPersonRows } from "./keep-off";
import { generateSeed } from "./generate";
import { disciplinePlayerRows } from "./discipline";

describe("keepOffPersonRows", () => {
  const data = generateSeed();
  const rows = keepOffPersonRows(data);

  it("adds one invented person with fixed ids, apart from everyone else", () => {
    expect(rows.user.email).toMatch(/@example\.test$/);
    expect(PERSONA_EMAILS).not.toContain(rows.user.email);
    expect(keepOffPersonRows(generateSeed(7)).user).toEqual(rows.user);
    const seeded = new Set(data.users.map((u) => u.id));
    expect(seeded.has(rows.user.id)).toBe(false);
    expect(rows.user.id).not.toBe(disciplinePlayerRows(data).user.id);
    expect(rows.profile.globalRole).toBe("player");
  });

  it("registers them for the fall season as a free agent, so they can sub", () => {
    expect(rows.registration).toMatchObject({
      seasonId: data.season.id,
      kind: "free_agent",
      status: "active",
    });
  });
});
