import { describe, expect, it } from "vitest";
import { localDate } from "@/domain/scheduler/slots";
import { localTime } from "@/domain/time/zoned";
import { gameNight } from "./demo-evening";

const NY = "America/New_York";
// Tue Nov 17, 2026 is on Eastern Standard Time (UTC-5).
const at = (time: string) => new Date(`2026-11-17T${time}:00-05:00`);
const local = (d: Date) => `${localDate(d, NY)} ${localTime(d, NY)}`;

describe("gameNight", () => {
  it("puts a build in the small hours at 7 pm tonight, not at 1:20 am", () => {
    const { kickoff, clock } = gameNight(at("02:00"), NY);
    expect(local(kickoff)).toBe("2026-11-17 19:00");
    expect(local(clock)).toBe("2026-11-17 19:40");
  });

  it("puts a morning build at 7 pm the same day", () => {
    const { kickoff, clock } = gameNight(at("10:00"), NY);
    expect(local(kickoff)).toBe("2026-11-17 19:00");
    expect(local(clock)).toBe("2026-11-17 19:40");
  });

  it("starts the game 40 minutes ago during the evening, on a five-minute mark", () => {
    const now = at("19:03");
    const { kickoff, clock } = gameNight(now, NY);
    expect(local(kickoff)).toBe("2026-11-17 18:20");
    expect(clock).toEqual(now);
  });

  it("keeps a late-night build on tonight's game at 9:50 pm", () => {
    const { kickoff, clock } = gameNight(at("23:00"), NY);
    expect(local(kickoff)).toBe("2026-11-17 21:50");
    expect(local(clock)).toBe("2026-11-17 22:30");
  });

  it("switches at 6 pm and 10:30 pm", () => {
    expect(local(gameNight(at("17:59"), NY).kickoff)).toBe("2026-11-17 19:00");
    expect(local(gameNight(at("18:00"), NY).kickoff)).toBe("2026-11-17 17:20");
    expect(local(gameNight(at("22:29"), NY).kickoff)).toBe("2026-11-17 21:45");
    expect(local(gameNight(at("22:30"), NY).kickoff)).toBe("2026-11-17 21:50");
  });

  it("reads the hour in the league's own time zone", () => {
    // 2 am in New York is 11 pm the night before in Los Angeles.
    const { kickoff } = gameNight(at("02:00"), "America/Los_Angeles");
    expect(localDate(kickoff, "America/Los_Angeles")).toBe("2026-11-16");
    expect(localTime(kickoff, "America/Los_Angeles")).toBe("21:50");
  });
});
