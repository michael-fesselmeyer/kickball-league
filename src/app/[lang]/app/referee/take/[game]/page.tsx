import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";
import { db } from "@/db/client";
import { gameToTake, leagueOfGame } from "@/db/queries/referee-cover";
import { type GameId, parseId, type UserId } from "@/domain/ids";
import { requirePermission } from "@/lib/auth/permission";
import { takeGameAction } from "../../actions";

export const metadata: Metadata = { title: "Take a game" };

export default function TakePage(
  props: PageProps<"/[lang]/app/referee/take/[game]">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading the game…</PageLoading>}>
        <Take {...props} />
      </Suspense>
    </main>
  );
}

const ERRORS: Record<string, string> = {
  taken: "Someone beat you to it: the game has a ref now. Thanks anyway!",
  started: "This game has started.",
  gone: "This game was called off or moved.",
  not_a_ref:
    "Only the league's refs can take games. Ask an admin to add you to the ref pool.",
  own_team:
    "You play for one of these teams. Tick the box to ref it anyway, or leave it for another ref.",
  plays: "You're playing at that time, so you can't ref it.",
  busy: "You're already reffing another game at that time.",
};

async function Take({
  params,
  searchParams,
}: PageProps<"/[lang]/app/referee/take/[game]">) {
  const { game: rawGameId } = await params;
  const query = await searchParams;
  const gameId = parseId<GameId>(rawGameId);
  if (!gameId) notFound();
  const leagueId = await leagueOfGame(db, gameId);
  if (!leagueId) notFound();
  // A ref of another league finds nothing here.
  const subject = await requirePermission("referee.availability", {
    next: `/app/referee/take/${gameId}`,
    leagueId,
  });
  const userId = parseId<UserId>(subject.userId);
  if (!userId) notFound();
  const game = await gameToTake(db, { gameId, userId, now: new Date() });
  if (!game) notFound();
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href="/app/referee" className="underline">
          Reffing
        </Link>
        <h1 className="text-h1">{game.teams}</h1>
        <p className="text-text-muted">
          {game.when} · {game.seasonName}
        </p>
      </header>
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      {game.state === "yours" ? (
        <p role="status" className="rounded-lg border border-success p-3">
          {query.took ? "It’s yours. Thanks for stepping in! " : ""}
          You&rsquo;re reffing this game. It&rsquo;s on your home screen with
          your other games.
        </p>
      ) : game.state === "open" ? (
        <form
          action={takeGameAction.bind(null, game.id)}
          className="flex flex-col gap-3"
        >
          <p>This game needs a ref. The first ref to take it gets it.</p>
          {game.playsFor.length > 0 && (
            <label className="flex items-start gap-2 rounded-lg border border-warning p-3 text-small">
              <input
                type="checkbox"
                name="ownTeamOk"
                className="mt-1 size-5"
                required
              />
              <span>
                You play for {game.playsFor.join(" and ")} in this game. If you
                ref it, your score report counts as that team&rsquo;s, so only
                the other team can confirm or dispute it. I understand, and I
                want to ref it anyway.
              </span>
            </label>
          )}
          <SubmitButton className="btn self-start btn-primary">
            Take it
          </SubmitButton>
        </form>
      ) : (
        !error && (
          <p className="rounded-lg border border-border p-3">
            {game.state === "taken"
              ? "This game has a ref now. Thanks anyway!"
              : "This game has started or was called off."}
          </p>
        )
      )}
    </>
  );
}
