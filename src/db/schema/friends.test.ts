import { describe, expect, it } from "vitest";
import { ACTIVITIES } from "@/domain/friends/friend-form";
import { friendActivity } from "./friends";

describe("friend_activity", () => {
  it("matches the activities the form offers, in the same order", () => {
    expect(friendActivity.enumValues).toEqual([...ACTIVITIES]);
  });
});
