import { describe, expect, it } from "vitest";
import { rendererFor } from "./templates";

const render = rendererFor({ siteUrl: "https://league.example.test" });

const base = {
  kind: "soon" as "soon" | "overdue",
  title: "Order shirts",
  notes: "Sizes from the roster.",
  seasonName: "Spring 2027",
  seasonSlug: "spring-2027",
  due: "Due in 3 days",
  dueOn: "Saturday, March 20",
  unassigned: false,
};

function email(over: Partial<typeof base> = {}) {
  const result = render("checklist_reminder", { ...base, ...over });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe("checklist_reminder", () => {
  it("tells the owner what is due and links the checklist", () => {
    const sent = email();
    expect(sent.subject).toBe("Due in 3 days: Order shirts");
    expect(sent.text).toContain(
      "Due in 3 days (Saturday, March 20) on the Spring 2027 checklist.",
    );
    expect(sent.text).toContain("Sizes from the roster.");
    expect(sent.text).toContain(
      "https://league.example.test/app/admin/seasons/spring-2027/checklist",
    );
    expect(sent.text).toContain("you own a task on the season checklist");
  });

  it("says when it is overdue, and asks the owners to pick someone", () => {
    const sent = email({
      kind: "overdue",
      due: "2 days overdue",
      unassigned: true,
    });
    expect(sent.subject).toBe("Overdue: Order shirts");
    expect(sent.text).toContain("Nobody has taken it yet.");
    expect(sent.text).toContain("you are an owner of the league");
  });
});
