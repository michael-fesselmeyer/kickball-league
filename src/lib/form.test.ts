import { describe, expect, it } from "vitest";
import { formStrings } from "./form";

describe("formStrings", () => {
  it("reads named text fields, blank when missing or a file", () => {
    const form = new FormData();
    form.set("name", "Spring");
    form.set("upload", new Blob(["x"]));
    expect(formStrings(form, ["name", "upload", "missing"] as const)).toEqual({
      name: "Spring",
      upload: "",
      missing: "",
    });
  });
});
