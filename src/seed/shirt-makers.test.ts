import { describe, expect, it } from "vitest";
import { parseMakerForm } from "@/domain/shirts/makers";
import { SEED_SHIRT_MAKERS } from "./shirt-makers";

describe("seeded shirt makers", () => {
  it("pass the admin form's checks, on invented example.test sites", () => {
    for (const m of SEED_SHIRT_MAKERS) {
      const parsed = parseMakerForm({
        name: m.name,
        url: m.url,
        makes: m.makes,
        minimumOrder: m.minimumOrder?.toString() ?? "",
      });
      expect(parsed).toEqual({ ok: true, value: m });
      expect(new URL(m.url).hostname).toMatch(/\.example\.test$/);
    }
  });
});
