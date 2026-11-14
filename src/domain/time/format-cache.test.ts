import { describe, expect, it } from "vitest";
import { dateTimeFormat } from "./format-cache";

describe("dateTimeFormat", () => {
  it("reuses one formatter for the same locale and options", () => {
    const a = dateTimeFormat("en-CA", { timeZone: "America/New_York" });
    const b = dateTimeFormat("en-CA", { timeZone: "America/New_York" });
    expect(a).toBe(b);
  });

  it("keeps formatters for different zones apart", () => {
    const at = new Date("2027-01-01T03:00:00Z");
    expect(
      dateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(at),
    ).toBe("2026-12-31");
    expect(dateTimeFormat("en-CA", { timeZone: "UTC" }).format(at)).toBe(
      "2027-01-01",
    );
  });
});
