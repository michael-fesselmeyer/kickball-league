import type { Metadata } from "next";
import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import {
  gearCandidates,
  kitDetail,
  upcomingGearGames,
} from "@/db/queries/equipment";
import { activeLeague } from "@/lib/league/active";
import { bringBy, whereabouts } from "@/domain/equipment/equipment";
import { type EquipmentKitId, type GameId, parseId } from "@/domain/ids";
import { kickoff, shortDay } from "@/domain/schedule/format";
import { requirePermission } from "@/lib/auth/permission";
import {
  assignKitAction,
  resolveReportAction,
  retireKitAction,
  setHolderAction,
  unassignKitAction,
  updateKitAction,
} from "../actions";
import { FIELD, KitFields } from "../kit-fields";
import {
  ADMIN_GEAR_ERRORS,
  ADMIN_GEAR_NOTICES,
  historyWords,
  missingWords,
} from "../words";

export const metadata: Metadata = { title: "Kit" };

const ROLES = { ref: "ref", captain: "captain", admin: "admin" } as const;

/**
 * One kit for admins (issue #286): where it is, its open reports, the games
 * it goes to and who brings it, a correction of where it is, its details
 * and its history.
 */
export default function KitPage(
  props: PageProps<"/app/admin/equipment/[kit]">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<p className="min-h-svh">Loading the kit…</p>}>
        <Kit {...props} />
      </Suspense>
    </main>
  );
}

async function Kit({
  params,
  searchParams,
}: PageProps<"/app/admin/equipment/[kit]">) {
  const { kit: rawKit } = await params;
  await requirePermission("equipment.manage", {
    next: `/app/admin/equipment/${rawKit}`,
  });
  const kitId = parseId<EquipmentKitId>(rawKit);
  if (!kitId) notFound();
  const query = await searchParams;
  const league = await activeLeague();
  if (!league) notFound();
  const now = new Date();
  const pickedGame = parseId<GameId>(query.game);
  const [found, games, candidates] = await Promise.all([
    kitDetail(db, league.id, kitId, now),
    upcomingGearGames(db, league.id, now),
    pickedGame ? gearCandidates(db, pickedGame) : Promise.resolve([]),
  ]);
  if (!found) notFound();
  const { kit } = found;
  const tz = league.timeZone;
  const when = (d: Date) => `${shortDay(d, tz)}, ${kickoff(d, tz)}`;
  const error =
    typeof query.error === "string" ? ADMIN_GEAR_ERRORS[query.error] : null;
  const notice =
    typeof query.notice === "string" ? ADMIN_GEAR_NOTICES[query.notice] : null;
  const game = games.find((g) => g.gameId === pickedGame);
  // People the kit could be with: whoever brings it to a game to come.
  const people = [
    ...new Map(found.upcoming.map((a) => [a.userId, a.name])).entries(),
  ].filter(([id]) => id !== kit.holderId);

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href="/app/admin/equipment" className="underline">
          League gear
        </Link>
        <h1 className="text-h1">{kit.name}</h1>
        <p id="where" className="text-lg">
          {whereabouts({
            holderId: kit.holderId,
            holderName: kit.holderName,
            homeLocation: kit.homeLocation,
            pendingToName: kit.pending ? (kit.pending.toName ?? "") : null,
          })}
        </p>
        {kit.retired && <p className="text-text-muted">Retired.</p>}
        {notice && (
          <p role="status" className="rounded-lg border border-success p-3">
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-lg border border-danger p-3">
            {error}
          </p>
        )}
      </header>

      {found.reports.length > 0 && (
        <section aria-labelledby="reports" className="flex flex-col gap-2">
          <h2 id="reports" className="text-h2">
            Missing items
          </h2>
          <ul>
            {found.reports.map((r) => (
              <li
                key={r.id}
                className="flex flex-col gap-2 border-t border-border py-3"
              >
                <p>{missingWords(r.missing, r.note)}</p>
                <p className="text-small text-text-muted">
                  {r.reporterName ?? "Someone"}, {when(r.createdAt)}
                </p>
                <form action={resolveReportAction.bind(null, kit.id, r.id)}>
                  <SubmitButton className="btn btn-secondary">
                    Mark sorted
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!kit.retired && (
        <section aria-labelledby="games" className="flex flex-col gap-3">
          <h2 id="games" className="text-h2">
            Games it goes to
          </h2>
          {found.upcoming.length === 0 ? (
            <p className="text-text-muted">Not assigned to a game yet.</p>
          ) : (
            <ul>
              {found.upcoming.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-2 border-t border-border py-2"
                >
                  <span>
                    <strong>{a.name}</strong> brings it to {a.place} by{" "}
                    {kickoff(bringBy(a.startsAt), tz)}
                    <span className="block text-small text-text-muted">
                      {when(a.startsAt)} · {a.teamAName} vs {a.teamBName}
                    </span>
                  </span>
                  <form action={unassignKitAction.bind(null, kit.id, a.id)}>
                    <SubmitButton className="btn btn-secondary">
                      Take off
                      <span className="sr-only">
                        {" "}
                        {a.teamAName} vs {a.teamBName}
                      </span>
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          )}

          <h3 id="assign" className="text-h3">
            Assign to a game
          </h3>
          {games.length === 0 ? (
            <p className="text-text-muted">No games in the next three weeks.</p>
          ) : (
            <form method="get" className="flex flex-col gap-2">
              <label className="flex flex-col gap-1">
                <span>Game</span>
                <select
                  name="game"
                  defaultValue={game?.gameId ?? ""}
                  className={FIELD}
                >
                  <option value="" disabled>
                    Pick a game
                  </option>
                  {games.map((g) => (
                    <option key={g.gameId} value={g.gameId}>
                      {when(g.startsAt)} · {g.place} · {g.teamAName} vs{" "}
                      {g.teamBName}
                    </option>
                  ))}
                </select>
              </label>
              <SubmitButton className="btn self-start btn-secondary">
                Choose who brings it
              </SubmitButton>
            </form>
          )}
          {game && (
            <form
              action={assignKitAction.bind(null, kit.id)}
              className="flex flex-col gap-2"
            >
              <input type="hidden" name="gameId" value={game.gameId} />
              <fieldset className="flex flex-col gap-1">
                <legend className="font-bold">
                  Who brings it to {game.teamAName} vs {game.teamBName}?
                </legend>
                {candidates.length === 0 && (
                  <p className="text-text-muted">
                    That game has no ref or captains yet.
                  </p>
                )}
                {candidates.map((c) => (
                  <label
                    key={c.userId}
                    className="flex min-h-11 items-center gap-2"
                  >
                    <input
                      type="radio"
                      name="userId"
                      value={c.userId}
                      required
                    />
                    {c.name}
                    <span className="text-small text-text-muted">
                      {ROLES[c.role]}
                    </span>
                  </label>
                ))}
              </fieldset>
              <SubmitButton className="btn self-start btn-primary">
                Assign {kit.name}
              </SubmitButton>
            </form>
          )}
        </section>
      )}

      {!kit.retired && (
        <section aria-labelledby="correct" className="flex flex-col gap-2">
          <h2 id="correct" className="text-h2">
            Where is it really?
          </h2>
          <p className="text-text-muted">
            If a handoff happened without the app, say where the kit is now.
          </p>
          <div className="flex flex-wrap gap-2">
            {kit.holderId !== null && (
              <form action={setHolderAction.bind(null, kit.id, "")}>
                <SubmitButton className="btn btn-secondary">
                  It&apos;s back home
                </SubmitButton>
              </form>
            )}
            {people.map(([id, name]) => (
              <form key={id} action={setHolderAction.bind(null, kit.id, id)}>
                <SubmitButton className="btn btn-secondary">
                  It&apos;s with {name}
                </SubmitButton>
              </form>
            ))}
          </div>
        </section>
      )}

      {!kit.retired && (
        <section aria-labelledby="details" className="flex flex-col gap-3">
          <h2 id="details" className="text-h2">
            Details
          </h2>
          <KitFields
            action={updateKitAction.bind(null, kit.id)}
            submit="Save kit"
            kit={kit}
          />
          {kit.holderId === null && !kit.pending && (
            <form action={retireKitAction.bind(null, kit.id)}>
              <SubmitButton className="btn btn-secondary">
                Retire {kit.name}
              </SubmitButton>
            </form>
          )}
        </section>
      )}

      <section aria-labelledby="history" className="flex flex-col gap-2">
        <h2 id="history" className="text-h2">
          History
        </h2>
        {found.history.length === 0 ? (
          <p className="text-text-muted">Nothing yet.</p>
        ) : (
          <ol>
            {found.history.map((line, i) => (
              <li
                key={`${line.at.getTime()}-${i}`}
                className="flex flex-col border-t border-border py-2"
              >
                <span>{historyWords(line)}</span>
                <span className="text-small text-text-muted">
                  {when(line.at)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
