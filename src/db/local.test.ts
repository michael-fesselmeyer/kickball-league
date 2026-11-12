import { describe, expect, it } from "vitest";
import { isLocalDatabase } from "./local";

describe("isLocalDatabase", () => {
  it.each([
    "postgresql://ci:ci@localhost:5432/ci",
    "postgres://ci:ci@127.0.0.1/ci",
    "postgresql://ci:ci@[::1]:5432/ci",
  ])("is true for a Postgres on this machine: %s", (url) => {
    expect(isLocalDatabase(url)).toBe(true);
  });

  it.each([
    "postgresql://user:pw@db.example.test/app?sslmode=require",
    "postgresql://user:pw@localhost.example.test/app",
    "not a url",
  ])("is false for anything else: %s", (url) => {
    expect(isLocalDatabase(url)).toBe(false);
  });
});
