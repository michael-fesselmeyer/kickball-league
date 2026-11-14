import type * as SharpModule from "sharp";
import { describe, expect, it, vi } from "vitest";
import { MAX_INPUT_PIXELS, prepareUpload } from "./store-file";

// Records the options each sharp call gets, and still runs sharp.
const calls = vi.hoisted(() => [] as unknown[]);
vi.mock("sharp", async (importOriginal) => {
  const actual = await importOriginal<typeof SharpModule>();
  const wrapped = (...args: Parameters<typeof actual.default>) => {
    calls.push(args[1]);
    return actual.default(...args);
  };
  return { default: Object.assign(wrapped, actual.default) };
});

describe("prepareUpload", () => {
  it("decodes a receipt photo under a pixel limit, so a huge claimed size is refused early", async () => {
    const { default: sharp } = await import("sharp");
    const photo = await sharp({
      create: { width: 40, height: 30, channels: 3, background: "#808080" },
    })
      .jpeg()
      .toBuffer();
    calls.length = 0;
    const prepared = await prepareUpload(
      new Blob([new Uint8Array(photo)], { type: "image/jpeg" }),
    );
    expect(prepared.ok).toBe(true);
    expect(calls.at(-1)).toMatchObject({ limitInputPixels: MAX_INPUT_PIXELS });
    expect(MAX_INPUT_PIXELS).toBeLessThanOrEqual(50_000_000);
  });
});
