import type { Pickup } from "@/db/queries/subs";

/**
 * Approved subs in a game, by team, for both captains and the ref: the
 * rulebook asks that the other side knows who is a pickup.
 */
export function Pickups({
  pickups,
  teams,
}: {
  pickups: readonly Pickup[] | undefined;
  teams: readonly { id: string; name: string }[];
}) {
  if (!pickups || pickups.length === 0) return null;
  const parts = teams.flatMap((t) => {
    const names = pickups
      .filter((p) => p.teamSeasonId === t.id)
      .map((p) => p.name);
    return names.length > 0 ? [`${t.name}: ${names.join(", ")}`] : [];
  });
  return (
    <span className="block w-full text-small">
      <span className="font-bold">Pickups</span>{" "}
      <span className="text-text-muted">{parts.join(" · ")}</span>
    </span>
  );
}
