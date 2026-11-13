import { describe, expect, it, vi } from "vitest";
import { readUnlessBuildHasNoDatabase } from "./build-phase";

const down = () => Promise.reject(new Error("connect ECONNREFUSED"));

describe("readUnlessBuildHasNoDatabase", () => {
  it("returns what it read", async () => {
    expect(
      await readUnlessBuildHasNoDatabase(() => Promise.resolve([1, 2])),
    ).toEqual([1, 2]);
  });

  it("lets a build with no database carry on without data", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      await readUnlessBuildHasNoDatabase(down, "phase-production-build"),
    ).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("still fails at request time", async () => {
    await expect(
      readUnlessBuildHasNoDatabase(down, "phase-production-server"),
    ).rejects.toThrow("ECONNREFUSED");
    await expect(readUnlessBuildHasNoDatabase(down, undefined)).rejects.toThrow(
      "ECONNREFUSED",
    );
  });
});
