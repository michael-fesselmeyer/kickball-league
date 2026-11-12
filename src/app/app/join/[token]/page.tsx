import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { db } from "@/db/client";
import { inviteByToken } from "@/db/queries/invites";
import { formatCents } from "@/domain/registration/pricing";
import { requirePermission } from "@/lib/auth/permission";
import { joinTeamAction } from "./actions";

export const metadata: Metadata = {
  title: "Join a team",
  // Invite links are private; keep them out of search results.
  robots: { index: false, follow: false },
};

export default function JoinPage(props: PageProps<"/app/join/[token]">) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-12">
      <Suspense fallback={<p>Loading the invite…</p>}>
        <Join {...props} />
      </Suspense>
    </main>
  );
}

const ERRORS: Record<string, string> = {
  invalid: "This link does not work. Ask your captain for a new one.",
  expired: "This link has expired. Ask your captain for a new one.",
  revoked: "Your captain replaced this link. Ask them for the new one.",
  closed: "Registration for this season is closed.",
  full: "This team's roster is full.",
  already_member: "You are already on this team.",
  on_another_team:
    "You are already on another team this season. Ask the league to move you.",
};

async function Join({ params, searchParams }: PageProps<"/app/join/[token]">) {
  const { token } = await params;
  const query = await searchParams;
  await requirePermission("registration.join", { next: `/app/join/${token}` });
  const found = await inviteByToken(db, token, new Date());
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;

  if (!found || found.state !== "open")
    return (
      <>
        <h1 className="text-h1">Join a team</h1>
        <p role="alert">
          {ERRORS[found ? found.state : "invalid"] ?? ERRORS.invalid}
        </p>
        <Link href="/app" className="underline">
          Home
        </Link>
      </>
    );

  return (
    <>
      <header className="flex flex-col gap-1">
        <p className="text-text-muted">{found.seasonName}</p>
        <h1 className="text-h1">Join {found.teamName}</h1>
      </header>
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      <p>
        {found.members} {found.members === 1 ? "player has" : "players have"}{" "}
        joined so far.
        {found.paymentMode === "split" && found.shareCents !== null
          ? ` Your share is ${formatCents(found.shareCents)}.`
          : ""}{" "}
        After joining you sign the season waiver and pay.
      </p>
      <form action={joinTeamAction.bind(null, token)}>
        <button type="submit" className="btn btn-primary">
          Join {found.teamName}
        </button>
      </form>
    </>
  );
}
