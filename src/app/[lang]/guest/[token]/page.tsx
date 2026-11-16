import type { Metadata } from "next";
import { Suspense } from "react";
import { WaiverText } from "@/components/waiver-text";
import { db } from "@/db/client";
import { guestTeamByToken } from "@/db/queries/tournaments";
import { LINK_TOKEN, signedLine } from "@/domain/tournaments/tournament";
import { GuestSignForm } from "./sign-form";

export const metadata: Metadata = {
  title: "Sign the waiver",
  robots: { index: false, follow: false },
};

type Props = PageProps<"/[lang]/guest/[token]">;

/**
 * The waiver link a guest captain shares with their team. The secret in the
 * link is the only key: no account, and nothing is shown that the link's
 * holders could not already know, only the team's name, the tournament and
 * how many have signed.
 */
export default function GuestWaiverPage(props: Props) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <Suspense fallback={<p className="min-h-40">Loading…</p>}>
        <GuestWaiver {...props} />
      </Suspense>
    </main>
  );
}

function Broken() {
  return (
    <>
      <h1 className="text-h1">This link doesn&apos;t work</h1>
      <p>
        It may have been copied only in part, or the tournament&apos;s guest
        details were deleted after the event. Ask your captain for the link
        again.
      </p>
    </>
  );
}

async function GuestWaiver({ params }: Props) {
  const { token } = await params;
  if (!LINK_TOKEN.test(token)) return <Broken />;
  const team = await guestTeamByToken(db, token);
  if (!team) return <Broken />;
  const over = team.cancelledAt !== null || team.endsAt <= new Date();
  return (
    <>
      <header className="flex flex-col gap-2">
        <p className="sticker self-start">Guest waiver</p>
        <h1 className="text-h1">{team.eventTitle}</h1>
        <p className="text-body-lg">
          Playing with <strong>{team.name}</strong>? Read the waiver and sign
          with your full name.
        </p>
        <p className="text-small text-text-muted">
          {signedLine(team.signed, team.rosterSize)} We keep your name and the
          time you signed, and delete them after the event.
        </p>
      </header>
      {over ? (
        <p role="status" className="rounded-card border border-border p-4">
          This tournament is over, so the waiver is closed.
        </p>
      ) : !team.waiver ? (
        <p role="status" className="rounded-card border border-border p-4">
          The league hasn&apos;t published its waiver yet. Check back soon.
        </p>
      ) : (
        <>
          <section
            aria-labelledby="waiver-title"
            className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
          >
            <h2 id="waiver-title" className="text-h2">
              {team.waiver.title}
            </h2>
            <WaiverText body={team.waiver.bodyMd} />
          </section>
          <GuestSignForm token={token} shownSha256={team.waiver.bodySha256} />
        </>
      )}
    </>
  );
}
