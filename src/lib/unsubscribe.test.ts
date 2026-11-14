import { describe, expect, it } from "vitest";
import type { UserId } from "@/domain/ids";
import {
  readUnsubscribeToken,
  topicLabel,
  unsubscribePagePath,
  unsubscribeToken,
} from "./unsubscribe";

const SECRET = "test-secret-not-used-anywhere-0000000000";
const PAT = "d3e30000-0000-4000-8000-000000000001" as UserId;
const OTHER = "d3e30000-0000-4000-8000-000000000002" as UserId;

describe("unsubscribe links", () => {
  it("round-trips a person and an offered topic", () => {
    const token = unsubscribeToken(SECRET, PAT, "announcement");
    expect(token).not.toBeNull();
    expect(readUnsubscribeToken(SECRET, token!)).toEqual({
      userId: PAT,
      topic: "announcement",
    });
    expect(unsubscribePagePath(token!)).toMatch(/^\/unsubscribe\//);
  });

  it("refuses a token for another person, topic or secret, or once altered", () => {
    const token = unsubscribeToken(SECRET, PAT, "announcement")!;
    const [hex, , sig] = token.split(".");
    const otherHex = OTHER.replaceAll("-", "");
    expect(
      readUnsubscribeToken(SECRET, `${otherHex}.announcement.${sig}`),
    ).toBeNull();
    expect(readUnsubscribeToken(SECRET, `${hex}.score.${sig}`)).toBeNull();
    expect(readUnsubscribeToken(`${SECRET}x`, token)).toBeNull();
    expect(readUnsubscribeToken(SECRET, `${token}x`)).toBeNull();
    expect(readUnsubscribeToken(SECRET, "not-a-token")).toBeNull();
  });

  it("gives no link for topics a person can't turn off", () => {
    expect(unsubscribeToken(SECRET, PAT, "discipline")).toBeNull();
    expect(unsubscribeToken(SECRET, PAT, "digest")).toBeNull();
    expect(unsubscribeToken(SECRET, PAT, "operations")).toBeNull();
  });

  it("names the topic as the settings page does", () => {
    expect(topicLabel("rainout")).toBe("Rain-outs");
  });
});
