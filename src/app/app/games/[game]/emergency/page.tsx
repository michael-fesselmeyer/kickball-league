import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { gameEmergencyCards } from "@/db/queries/emergency";
import { type GameId, parseId, type UserId } from "@/domain/ids";
import { formatPhone } from "@/domain/profile/profile-form";
import { fullWhen } from "@/domain/schedule/format";
import { env } from "@/env";
import { requirePermission } from "@/lib/auth/permission";

export const metadata: Metadata = {
  title: "Emergency contacts",
  robots: { index: false },
};

/**
 * A game's emergency contacts (ADR 0041), for its two captains and its ref,
 * on game day only: who to call for each player, and the first-aid notes
 * players chose to share. The home screen saves this page on the phone with
 * the next game until midnight. Every load is recorded in the audit log.
 */
export default function EmergencyPage(
  props: PageProps<"/app/games/[game]/emergency">,
) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8">
      <Suspense
        fallback={<p className="min-h-svh">Loading emergency contacts…</p>}
      >
        <Contacts {...props} />
      </Suspense>
    </main>
  );
}

async function Contacts({ params }: PageProps<"/app/games/[game]/emergency">) {
  const { game: rawId } = await params;
  const subject = await requirePermission("public.view", {
    next: `/app/games/${rawId}/emergency`,
  });
  const gameId = parseId<GameId>(rawId);
  const viewerId = parseId<UserId>(subject.userId);
  if (!gameId || !viewerId) notFound();
  const found = await gameEmergencyCards(db, {
    gameId,
    subject,
    viewerId,
    secret: env.BETTER_AUTH_SECRET,
    now: new Date(),
  });
  if (!found.ok) {
    // Only the game's captains and ref learn that the page exists.
    if (found.error !== "not_game_day") notFound();
    return (
      <>
        <h1 className="text-h1">Emergency contacts</h1>
        <p>
          Players&apos; emergency contacts show here on game day only, to the
          two captains and the ref.
        </p>
        <Link href="/app" className="underline">
          Back to your home screen
        </Link>
      </>
    );
  }
  const g = found.value;
  const [a, b] = g.teams;

  return (
    <>
      <header className="flex flex-col gap-1">
        <p className="text-text-muted">
          {a?.name} vs {b?.name} · {fullWhen(g.startsAt, g.timeZone)}
        </p>
        <h1 className="text-h1">Emergency contacts</h1>
        <p className="text-small text-text-muted">
          For you, the other captain and the ref, today only. Opening this page
          is recorded. Call 911 first in an emergency.
        </p>
      </header>
      {g.teams.map((t) => (
        <section
          key={t.teamSeasonId}
          aria-labelledby={`team-${t.teamSeasonId}`}
          className="flex flex-col gap-2"
        >
          <h2 id={`team-${t.teamSeasonId}`} className="text-h2">
            {t.name}
          </h2>
          {t.players.length === 0 ? (
            <p className="text-text-muted">No players on this roster.</p>
          ) : (
            <ul className="flex flex-col">
              {t.players.map((p) => (
                <li
                  key={p.userId}
                  className="flex flex-col gap-1 border-t border-border py-2"
                >
                  <strong>
                    {p.name}
                    {p.sub && (
                      <span className="text-small font-normal text-text-muted">
                        {" "}
                        (sub)
                      </span>
                    )}
                  </strong>
                  {p.card ? (
                    <>
                      <span>
                        {p.card.name}
                        {p.card.relationship && (
                          <span className="text-text-muted">
                            {" "}
                            · {p.card.relationship}
                          </span>
                        )}
                        {" · "}
                        <a
                          href={`tel:${p.card.phone}`}
                          className="font-bold underline"
                          aria-label={`Call ${p.card.name} for ${p.name}, ${formatPhone(p.card.phone)}`}
                        >
                          {formatPhone(p.card.phone)}
                        </a>
                      </span>
                      {p.card.firstAid && (
                        <p className="text-small">
                          <span className="font-bold">First aid: </span>
                          {p.card.firstAid}
                        </p>
                      )}
                    </>
                  ) : (
                    <span className="text-small text-text-muted">
                      No emergency contact on file.
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
      <Link href="/app" className="underline">
        Back to your home screen
      </Link>
    </>
  );
}
