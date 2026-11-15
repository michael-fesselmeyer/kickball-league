import { describe, expect, it } from "vitest";
import { minimumLine, parseMakerForm } from "./makers";

const form = {
  name: " Corner Print Shop ",
  url: "cornerprint.example.test/jerseys",
  makes: " Custom jerseys ",
  minimumOrder: "12",
};

describe("parseMakerForm", () => {
  it("reads a good form and makes the link https", () => {
    const r = parseMakerForm(form);
    expect(r).toEqual({
      ok: true,
      value: {
        name: "Corner Print Shop",
        url: "https://cornerprint.example.test/jerseys",
        makes: "Custom jerseys",
        minimumOrder: 12,
      },
    });
  });
  it("allows no minimum", () => {
    const r = parseMakerForm({ ...form, minimumOrder: " " });
    expect(r.ok && r.value.minimumOrder).toBe(null);
  });
  it("refuses plain http, odd hosts and credentials in the link", () => {
    for (const url of [
      "http://shop.example.test",
      "https://user:pw@shop.example.test",
      "https://192.168.0.1/x",
      "https://localhost",
      "javascript:alert(1)",
    ])
      expect(parseMakerForm({ ...form, url }).ok).toBe(false);
  });
  it("refuses missing fields and a bad minimum", () => {
    expect(parseMakerForm({ ...form, name: " " })).toEqual({
      ok: false,
      error: "name_missing",
    });
    expect(parseMakerForm({ ...form, makes: "" })).toEqual({
      ok: false,
      error: "makes_missing",
    });
    for (const minimumOrder of ["0", "1001", "ten", "-3"])
      expect(parseMakerForm({ ...form, minimumOrder })).toEqual({
        ok: false,
        error: "bad_minimum",
      });
  });
});

describe("minimumLine", () => {
  it("reads naturally", () => {
    expect(minimumLine(null)).toBe("No minimum order");
    expect(minimumLine(1)).toBe("Minimum 1 piece");
    expect(minimumLine(12)).toBe("Minimum 12 pieces");
  });
});
