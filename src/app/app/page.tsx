import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { gamesToReferee } from "@/db/queries/referees";
import { openSeasons } from "@/db/queries/registration";
import { currentLeague } from "@/db/queries/seasons";
import { pickupsFor } from "@/db/queries/subs";
import { Pickups } from "@/components/pickups";
import { can } from "@/domain/authz/permissions";
import { parseId, type UserId } from "@/domain/ids";
import { auth } from "@/lib/auth";
import { currentSubject } from "@/lib/auth/permission";
import { signOut } from "./actions";

export const metadata: Metadata = { title: "Home" };

export default function AppHome() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-12">
      <Suspense fallback={<p>Loading your account…</p>}>
        <Account />
      </Suspense>
    </main>
  );
}

async function Account() {
  // proxy.ts only checks that a cookie exists; this verifies the session itself.
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in?next=/app");

  const { name, email } = session.user;
  const subject = await currentSubject();
  const isAdmin = can(subject, "season.manage", {});
  const league = await currentLeague(db);
  const now = new Date();
  const open = league ? await openSeasons(db, league.id, now) : [];
  // Games this person referees that are not final yet.
  const userId = parseId<UserId>(subject.userId);
  const refereeing =
    userId && subject.isReferee
      ? (await gamesToReferee(db, userId)).filter(
          (g) => g.status !== "final" && g.status !== "forfeit",
        )
      : [];
  const pickups = await pickupsFor(
    db,
    refereeing.map((g) => g.id),
  );
  const when = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: league?.timeZone ?? "America/New_York",
    }).format(d);
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-h1">You&apos;re in!</h1>
        <p className="text-text-muted">
          Signed in as <strong className="text-text">{name || email}</strong>.
          Your season stuff will live here.
        </p>
      </div>
      {refereeing.length > 0 && (
        <section aria-labelledby="refereeing" className="flex flex-col gap-2">
          <h2 id="refereeing" className="text-h3">
            Games you&apos;re refereeing
          </h2>
          <ul className="flex flex-col">
            {refereeing.map((g) => (
              <li
                key={g.id}
                className="flex items-center justify-between gap-2 border-t border-border py-2"
              >
                <span>
                  {g.teamAName} vs {g.teamBName}
                  <span className="block text-small text-text-muted">
                    {when(g.startsAt)} · {g.fieldName}
                  </span>
                  <Pickups
                    pickups={pickups.get(g.id)}
                    teams={[
                      { id: g.teamAId, name: g.teamAName },
                      { id: g.teamBId, name: g.teamBName },
                    ]}
                  />
                </span>
                {g.startsAt <= now && (
                  <Link
                    href={`/app/games/${g.id}/score`}
                    className="btn btn-primary"
                  >
                    Score
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {open.map((s) => (
        <Link
          key={s.slug}
          href={`/app/seasons/${s.slug}`}
          className="btn btn-primary"
        >
          {s.name}: register or check your spot
        </Link>
      ))}
      <Link href="/app/subs" className="btn btn-secondary">
        Sub for a team
      </Link>
      <Link href="/app/profile" className="btn btn-secondary">
        Your profile
      </Link>
      {isAdmin && (
        <Link href="/app/admin" className="btn btn-primary">
          League admin
        </Link>
      )}
      <form action={signOut}>
        <button type="submit" className="btn btn-secondary">
          Sign out
        </button>
      </form>
    </>
  );
}
