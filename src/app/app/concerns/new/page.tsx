import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";
import {
  CONCERN_ERRORS,
  type ConcernError,
  MAX_BODY,
  PARK_RULES,
  PLAYER_CATEGORIES,
} from "@/domain/concerns/concerns";
import { requirePermission } from "@/lib/auth/permission";
import { sendConcernAction } from "../actions";

export const metadata: Metadata = { title: "Raise a concern" };

export default function NewConcernPage(props: PageProps<"/app/concerns/new">) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <NewConcern {...props} />
      </Suspense>
    </main>
  );
}

const EXTRA: Record<string, string> = {
  game: "That doesn't look like a game in this league.",
  limit: "That's a lot of concerns for one day. Try again tomorrow.",
  league: "The league isn't open for concerns just now.",
};
const field = "rounded-md border border-border bg-surface px-2 py-2";

async function NewConcern({ searchParams }: PageProps<"/app/concerns/new">) {
  await requirePermission("concern.send", { next: "/app/concerns/new" });
  const { error } = await searchParams;
  const message =
    typeof error === "string"
      ? (CONCERN_ERRORS[error as ConcernError] ?? EXTRA[error])
      : undefined;
  return (
    <>
      <header className="flex flex-col gap-2">
        <Link href="/app/concerns" className="underline">
          Your concerns
        </Link>
        <h1 className="text-h1">Raise a concern</h1>
        <p className="text-text-muted">
          About a game, a team or the league. Only the league&apos;s admins read
          it. It is never shown to the other team, your captain or the public.
          You&apos;ll get a note that it arrived, and another when it&apos;s
          closed.
        </p>
      </header>
      {message && (
        <p role="alert" className="text-danger">
          {message}
        </p>
      )}
      <form action={sendConcernAction} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          What is it about?
          <select name="category" required defaultValue="" className={field}>
            <option value="" disabled>
              Choose one
            </option>
            {Object.entries(PLAYER_CATEGORIES).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          If it&apos;s about the park, which rule? (optional)
          <select name="parkRule" defaultValue="" className={field}>
            <option value="">Not about the park</option>
            {Object.entries(PARK_RULES).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          A game link (optional)
          <input
            name="game"
            className={field}
            placeholder="Paste the game's page address"
          />
        </label>
        <label className="flex flex-col gap-1">
          What happened
          <textarea
            name="body"
            rows={6}
            required
            maxLength={MAX_BODY}
            className={field}
          />
        </label>
        <SubmitButton className="btn self-start btn-primary">
          Send to the league
        </SubmitButton>
      </form>
    </>
  );
}
