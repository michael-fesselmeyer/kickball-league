import { describe, expect, it } from "vitest";
import { MESSAGE_KINDS } from "@/domain/notifications/kinds";
import { rendererFor } from "./templates";

const render = rendererFor({ siteUrl: "https://league.example.test" });
const payload = {
  gameId: "8b0e7a1e-4a8e-4d55-9a65-0c2d8f2b9a10",
  teams: "Aces vs Bees",
  place: "McCarren Park, Field 2",
  // Tuesday, October 6, 2026: first pitch 6:00 PM, sunset 6:35 PM, play
  // ends 6:20 PM in New York.
  startsAt: "2026-10-06T22:00:00.000Z",
  endsAt: "2026-10-06T22:20:00.000Z",
  endReason: "daylight",
  sunsetAt: "2026-10-06T22:35:00.000Z",
  timeZone: "America/New_York",
  role: "captain",
};

describe("start-on-time email", () => {
  it("is a non-urgent kind", () => {
    expect(MESSAGE_KINDS.start_on_time.urgency).toBe("non_urgent");
  });

  it("says when first pitch is, when play must end and why", () => {
    const result = render("start_on_time", payload);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.subject).toBe(
      "First pitch 6:00 PM on Tue, Oct 6: play ends by 6:20 PM",
    );
    expect(result.value.text).toContain(
      "Sunset is at 6:35 PM, so play must end by 6:20 PM to finish in the light.",
    );
    expect(result.value.text).toContain("the last full inning");
    expect(result.value.text).toContain("Get your team there 15 minutes early");
    expect(result.value.text).toContain(
      `https://league.example.test/app/games/${payload.gameId}/live`,
    );
  });

  it("tells the ref to record first pitch, and names the field time", () => {
    const result = render("start_on_time", {
      ...payload,
      role: "referee",
      endReason: "field_time",
      sunsetAt: null,
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.text).toContain(
      "The field must be clear by 6:20 PM, so play ends then.",
    );
    expect(result.value.text).toContain('tap "First pitch"');
    expect(result.value.text).toContain("you're refereeing this game");
  });

  it("refuses a payload without an end", () => {
    expect(render("start_on_time", { ...payload, endsAt: "" }).ok).toBe(false);
  });
});
