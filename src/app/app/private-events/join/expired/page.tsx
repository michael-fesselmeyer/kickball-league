import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Invite link" };

/** Where an unknown or old private-event invite link lands. */
export default function ExpiredInvitePage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-10">
      <h1 className="text-h1">This invite link doesn&apos;t work</h1>
      <p>
        The link may be mistyped, or the tournament may have stopped taking
        teams. Ask your organizer for the link again.
      </p>
      <Link href="/app" className="btn self-start btn-secondary">
        Go to your home screen
      </Link>
    </main>
  );
}
