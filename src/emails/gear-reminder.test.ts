import { describe, expect, it } from "vitest";
import { MESSAGE_KINDS } from "@/domain/notifications/kinds";
import { rendererFor } from "./templates";

const render = rendererFor({ siteUrl: "https://league.example.test" });
const payload = {
  kitName: "Kit A",
  place: "McCarren Park, Field 2",
  // Tuesday, November 17, 2026, 7:00 PM in New York.
  startsAt: "2026-11-18T00:00:00.000Z",
  timeZone: "America/New_York",
  teams: "Aces vs Bees",
  from: { kind: "with", name: "Jo S." },
};

describe("gear reminder email", () => {
  it("is a non-urgent kind", () => {
    expect(MESSAGE_KINDS.gear_reminder.urgency).toBe("non_urgent");
  });

  it("says which kit, where it goes by when, and who has it", () => {
    const result = render("gear_reminder", payload);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.subject).toBe(
      "Bring Kit A to McCarren Park, Field 2 by 6:30 PM on Tue, Nov 17",
    );
    expect(result.value.text).toContain("Jo S. has Kit A right now");
    expect(result.value.text).toContain(
      "Bring it to McCarren Park, Field 2 by 6:30 PM on Tue, Nov 17",
    );
    expect(result.value.text).toContain("https://league.example.test/app#gear");
  });

  it("tells someone picking up from home where the kit lives", () => {
    const result = render("gear_reminder", {
      ...payload,
      from: { kind: "at_home", homeLocation: "the park house locker" },
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.text).toContain("Kit A is at the park house locker");
  });

  it("refuses a payload without a place", () => {
    expect(render("gear_reminder", { ...payload, place: "" }).ok).toBe(false);
  });
});
