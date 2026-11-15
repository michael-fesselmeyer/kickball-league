import type { Metadata } from "next";
import { SubmitButton } from "@/components/submit-button";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import {
  attendanceGame,
  type GamePerson,
  gameAttendanceList,
} from "@/db/queries/attendance";
import {
  MARK_DAYS_AFTER,
  markOpen,
  scanOpen,
} from "@/domain/attendance/attendance";
import { can } from "@/domain/authz/permissions";
import { type GameId, parseId } from "@/domain/ids";
import { fullWhen } from "@/domain/schedule/format";
import { requirePermission } from "@/lib/auth/permission";
import { saveAttendanceAction } from "./actions";

export const metadata: Metadata = {
  title: "Check-in",
  robots: { index: false },
};

type Props = PageProps<"/app/games/[game]/attendance">;

/**
 * A game's check-in (ADR 0063), for its captains, its ref and admins: the
 * code players scan, who has checked in, anyone playing without the
 * season's waiver signed, and boxes to tick players in or out by hand.
 */
export default function AttendancePage(props: Props) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8">
      <Suspense fallback={<p className="min-h-svh">Loading the game…</p>}>
        <Attendance {...props} />
      </Suspense>
    </main>
  );
}

const ERRORS: Record<string, string> = {
  called_off: "This game was called off.",
  not_yet: "Check-in opens on game day.",
  closed: `Check-in closed ${MARK_DAYS_AFTER} days after the game. Ask an admin to correct it.`,
  unknown_person: "Pick people from the two teams in this game.",
};

async function Attendance({ params, searchParams }: Props) {
  const { game: rawId } = await params;
  const query = await searchParams;
  const gameId = parseId<GameId>(rawId);
  const g = gameId ? await attendanceGame(db, gameId) : null;
  if (!g) notFound();
  const subject = await requirePermission("attendance.take", {
    next: `/app/games/${rawId}/attendance`,
    game: { id: g.id, teamSeasonIds: [g.teamAId, g.teamBId] },
  });
  const now = new Date();
  const open = markOpen(g, now, can(subject, "score.override"));
  const scanning = scanOpen(g, now).ok;
  const people = await gameAttendanceList(db, g);
  const unsigned = people.filter((p) => p.checkedIn && !p.waiverSigned);
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const saved = typeof query.saved === "string" ? query.saved : null;
  const teams = [
    { id: g.teamAId, name: g.teamAName },
    { id: g.teamBId, name: g.teamBName },
  ];
  const checkedIn = people.filter((p) => p.checkedIn).length;

  return (
    <>
      <header className="flex flex-col gap-1">
        <p className="text-text-muted">
          {g.teamAName} vs {g.teamBName}
          {g.startsAt ? ` · ${fullWhen(g.startsAt, g.timeZone)}` : ""}
        </p>
        <h1 className="text-h1">Check-in</h1>
        <p className="text-small text-text-muted">
          {checkedIn} checked in. Players scan the code to check themselves in,
          or tick them here.
        </p>
      </header>
      {scanning && (
        <Link
          href={`/app/games/${g.id}/attendance/code`}
          className="btn self-start btn-primary"
        >
          Show the check-in code
        </Link>
      )}
      {unsigned.length > 0 && (
        <div role="alert" className="rounded-lg border border-danger p-3">
          <p className="font-bold">
            {unsigned.length === 1
              ? "1 player checked in hasn't signed this season's waiver:"
              : `${unsigned.length} players checked in haven't signed this season's waiver:`}
          </p>
          <ul className="list-disc pl-5">
            {unsigned.map((p) => (
              <li key={p.userId}>{p.name}</li>
            ))}
          </ul>
          <p className="text-small">
            They sign it in the app before they play.
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      {saved !== null && !error && (
        <p role="status" className="rounded-lg border border-success p-3">
          {saved === "0" ? "No changes to save." : "Check-in saved."}
        </p>
      )}
      <form
        action={saveAttendanceAction.bind(null, g.id)}
        className="flex flex-col gap-5"
      >
        {teams.map((t) => (
          <TeamList
            key={t.id}
            name={t.name}
            people={people.filter((p) => p.teamSeasonId === t.id)}
            disabled={!open.ok}
          />
        ))}
        {open.ok ? (
          <SubmitButton className="btn self-start btn-primary">
            Save check-in
          </SubmitButton>
        ) : (
          <p className="text-text-muted">{ERRORS[open.error]}</p>
        )}
      </form>
    </>
  );
}

function TeamList({
  name,
  people,
  disabled,
}: {
  name: string;
  people: GamePerson[];
  disabled: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-h2">{name}</legend>
      {people.length === 0 ? (
        <p className="text-small text-text-muted">No players on this roster.</p>
      ) : (
        people.map((p) => (
          <label key={p.userId} className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              name="played"
              value={p.userId}
              defaultChecked={p.checkedIn !== null}
              disabled={disabled}
              className="size-5"
            />
            {p.checkedIn && <input type="hidden" name="was" value={p.userId} />}
            <span className="flex flex-col">
              <span>
                {p.name}
                {p.sub && (
                  <span className="text-small text-text-muted"> · sub</span>
                )}
              </span>
              {(p.checkedIn?.method === "scan" || !p.waiverSigned) && (
                <span className="text-small text-text-muted">
                  {p.checkedIn?.method === "scan" && "Scanned in"}
                  {p.checkedIn?.method === "scan" && !p.waiverSigned && " · "}
                  {!p.waiverSigned && (
                    <span className="font-bold text-danger">No waiver</span>
                  )}
                </span>
              )}
            </span>
          </label>
        ))
      )}
    </fieldset>
  );
}
