import { describe, expect, it } from "vitest";
import { required } from "./rows";

describe("required", () => {
  it("returns a row that exists", () => {
    expect(required({ id: 1 }, "test")).toEqual({ id: 1 });
  });

  it("throws, naming the row, when it is missing", () => {
    expect(() => required(undefined, "venue")).toThrow("Expected a venue row");
    expect(() => required(null, "version")).toThrow("Expected a version row");
  });
});
