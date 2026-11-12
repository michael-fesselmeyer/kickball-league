// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TeamSeasonId } from "@/domain/ids";
import { Pickups } from "./pickups";

afterEach(cleanup);

const aces = "aces" as TeamSeasonId;
const bees = "bees" as TeamSeasonId;
const teams = [
  { id: aces, name: "Aces" },
  { id: bees, name: "Bees" },
];

describe("Pickups", () => {
  it("renders nothing when neither team has a pickup", () => {
    const { container } = render(<Pickups pickups={[]} teams={teams} />);
    expect(container.textContent).toBe("");
    render(<Pickups pickups={undefined} teams={teams} />);
    expect(container.textContent).toBe("");
  });

  it("lists each team's pickups under its name", () => {
    const { container } = render(
      <Pickups
        pickups={[
          { teamSeasonId: bees, name: "Cara S." },
          { teamSeasonId: aces, name: "Fran S." },
          { teamSeasonId: bees, name: "Cal S." },
        ]}
        teams={teams}
      />,
    );
    expect(container.textContent).toBe(
      "Pickups Aces: Fran S. · Bees: Cara S., Cal S.",
    );
  });
});
