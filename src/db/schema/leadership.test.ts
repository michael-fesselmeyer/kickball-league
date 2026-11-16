import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  leadershipBallotOption,
  leadershipCandidate,
  leadershipParticipation,
} from "./leadership";

const columns = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).columns.map((c) => ({
    name: c.name,
    type: c.getSQLType(),
  }));

const references = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).foreignKeys.map(
    (fk) => getTableConfig(fk.reference().foreignTable).name,
  );

describe("leadership check-in secrecy (ADR 0077)", () => {
  it("keeps who took part to a person, a check-in and a step: no time, no choice", () => {
    expect(columns(leadershipParticipation).map((c) => c.name).sort()).toEqual(
      ["checkInId", "part", "userId"],
    );
    expect(references(leadershipParticipation).sort()).toEqual([
      "leadership_check_in",
      "user",
    ]);
  });

  it("keeps ballot counts with no voter and no time", () => {
    expect(columns(leadershipBallotOption).map((c) => c.name).sort()).toEqual([
      "checkInId",
      "id",
      "userId",
      "votes",
    ]);
  });

  it("gives a candidate row no time a suggester could be matched to", () => {
    // askedAt is set by the daily job in a batch, and answeredAt is the
    // candidate's own answer; neither is written by a teammate's check-in.
    const times = columns(leadershipCandidate)
      .filter((c) => c.type.startsWith("timestamp"))
      .map((c) => c.name)
      .sort();
    expect(times).toEqual(["answeredAt", "askedAt"]);
    expect(references(leadershipCandidate)).not.toContain(
      "leadership_participation",
    );
  });
});
