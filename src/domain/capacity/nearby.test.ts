import { describe, expect, it } from "vitest";
import snapshot from "@/data/nyc-park-fields.json";
import {
  distanceKm,
  fieldLabel,
  milesText,
  nearbyFields,
  type ParkField,
} from "./nearby";

const HOME = { lat: 40.7206, lng: -73.9513 };

const field = (over: Partial<ParkField>): ParkField => ({
  id: "B999-BASEBALL-1",
  park: "Example Park",
  borough: "B",
  kind: "diamond",
  kickball: false,
  adult: true,
  surface: "Natural",
  lit: false,
  lat: HOME.lat,
  lng: HOME.lng,
  ...over,
});

describe("nearby fields", () => {
  it("measures great-circle distance", () => {
    expect(distanceKm(HOME, HOME)).toBe(0);
    // One degree of latitude is about 111 km.
    expect(distanceKm(HOME, { ...HOME, lat: HOME.lat + 1 })).toBeCloseTo(
      111.2,
      0,
    );
  });

  it("names a field within its park", () => {
    expect(fieldLabel("B058-ZN03-BASEBALL-1")).toBe("Baseball 1");
    expect(fieldLabel("B058-ZN02-FOOTBALL-01")).toBe("Football 1");
    expect(fieldLabel("Q099-SOCCER")).toBe("Soccer");
    expect(fieldLabel("X010-SOCCER-01A")).toBe("Soccer 1A");
    expect(fieldLabel("M001-MPPA-2")).toBe("Multipurpose 2");
  });

  it("lists the nearest first, kickball fields first at the same distance, within range", () => {
    const fields = [
      field({ id: "B1-BASEBALL-1", lat: HOME.lat + 0.02 }),
      field({ id: "B2-BASEBALL-1", lat: HOME.lat + 0.01 }),
      field({ id: "B3-SOFTBALL-1", lat: HOME.lat + 0.01, kickball: true }),
      field({ id: "B4-BASEBALL-1", lat: HOME.lat + 1 }),
    ];
    const near = nearbyFields(fields, [HOME]);
    expect(near.map((f) => f.id)).toEqual([
      "B3-SOFTBALL-1",
      "B2-BASEBALL-1",
      "B1-BASEBALL-1",
    ]);
    expect(near[0]?.label).toBe("Softball 1");
    expect(nearbyFields(fields, [HOME], { limit: 1 })).toHaveLength(1);
    expect(nearbyFields(fields, [])).toEqual([]);
  });

  it("measures from the nearest of the league's parks", () => {
    const far = { lat: HOME.lat + 1, lng: HOME.lng };
    const near = nearbyFields([field({ lat: far.lat })], [HOME, far]);
    expect(near[0]?.km).toBe(0);
  });

  it("speaks in miles", () => {
    expect(milesText(0.05)).toBe("under 0.1 mi");
    expect(milesText(1.609344)).toBe("1.0 mi");
  });

  it("has McCarren Park's diamonds in the NYC Open Data snapshot", () => {
    expect(snapshot.sourceUrl).toContain("data.cityofnewyork.us");
    expect(snapshot.fetchedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const near = nearbyFields(snapshot.fields as ParkField[], [HOME], {
      withinKm: 0.5,
    });
    const mccarren = near.filter((f) => f.park === "McCarren Park");
    expect(mccarren.some((f) => f.kind === "diamond" && f.kickball)).toBe(true);
    for (const f of snapshot.fields) {
      expect(["diamond", "large"]).toContain(f.kind);
      expect(f.surface).toMatch(/^(Natural|Synthetic|Clay)/);
    }
  });
});
