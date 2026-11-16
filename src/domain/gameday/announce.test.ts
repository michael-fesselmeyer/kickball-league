import { describe, expect, it } from "vitest";
import { clockAnnouncement, markReached, permitAnnouncement } from "./announce";
import type { Clock } from "./game-clock";
import type { Watch } from "./permit-end";

const clock = (level: Clock["level"], minutesLeft: number): Clock => ({
  level,
  minutesLeft,
  message: `${minutesLeft} left, as the screen shows`,
});
const watch = (
  level: Watch["level"],
  minutesLeft: number,
  reason: Watch["reason"] = null,
): Watch => ({ level, minutesLeft, reason, rule: "", message: "" });

describe("markReached", () => {
  it("is silent above 30 minutes and names the smallest mark reached", () => {
    expect(markReached(90)).toBeNull();
    expect(markReached(31)).toBeNull();
    expect(markReached(30)).toBe(30);
    expect(markReached(16)).toBe(30);
    expect(markReached(15)).toBe(15);
    expect(markReached(6)).toBe(15);
    expect(markReached(5)).toBe(5);
    expect(markReached(0)).toBe(5);
  });
});

describe("clockAnnouncement", () => {
  it("says nothing while the game runs with time to spare", () => {
    expect(clockAnnouncement(clock("running", 60))).toBe("");
  });

  it("changes only at the marks, not every minute", () => {
    const said = (m: number) => clockAnnouncement(clock("running", m));
    expect(said(30)).toBe("30 minutes or less left on the game clock.");
    expect(said(29)).toBe(said(16));
    expect(said(15)).toBe("15 minutes or less left on the game clock.");
    expect(said(14)).toBe(said(6));
    expect(said(5)).toBe("5 minutes or less left on the game clock.");
    expect(said(1)).toBe(said(5));
  });

  it("announces the last inning and the end", () => {
    expect(clockAnnouncement(clock("last_inning", 8))).toBe(
      "Last inning: no new inning starts. 15 minutes or less left.",
    );
    expect(clockAnnouncement(clock("last_inning", 0))).toBe(
      "Last inning: time is up.",
    );
    expect(clockAnnouncement(clock("over", 7))).toBe(
      "The game is over: no new inning starts.",
    );
  });
});

describe("permitAnnouncement", () => {
  it("says nothing with plenty of permit left", () => {
    expect(permitAnnouncement(watch("ok", 120))).toBe("");
  });

  it("changes only at the marks while all is well", () => {
    expect(permitAnnouncement(watch("ok", 30))).toBe(
      "30 minutes or less left in the permit.",
    );
    expect(permitAnnouncement(watch("ok", 17))).toBe(
      permitAnnouncement(watch("ok", 30)),
    );
    expect(permitAnnouncement(watch("ok", 15))).toBe(
      "15 minutes or less left in the permit.",
    );
    expect(permitAnnouncement(watch("ok", 5))).toBe(
      "5 minutes or less left in the permit.",
    );
  });

  it("warns when the game would run past the permit, and why", () => {
    expect(permitAnnouncement(watch("watch", 90, "time_limit"))).toBe(
      "Heads up: the time limit would run past the permit.",
    );
    expect(permitAnnouncement(watch("watch", 12, "pace"))).toBe(
      "Heads up: at this pace the game would run past the permit. 15 minutes or less left on the permit.",
    );
  });

  it("says when the permit has ended, however long ago", () => {
    expect(permitAnnouncement(watch("over", 0, "over"))).toBe(
      "The permit has ended.",
    );
  });
});

describe("permitAnnouncement when sunset ends play (#467)", () => {
  it("names the daylight, not the permit", () => {
    expect(permitAnnouncement(watch("ok", 15), "daylight")).toBe(
      "15 minutes or less left in the daylight.",
    );
    expect(permitAnnouncement(watch("watch", 90, "time_limit"), "daylight")).toBe(
      "Heads up: the time limit would run past the daylight.",
    );
    expect(permitAnnouncement(watch("over", 0), "daylight")).toBe(
      "The daylight has run out.",
    );
  });
});
