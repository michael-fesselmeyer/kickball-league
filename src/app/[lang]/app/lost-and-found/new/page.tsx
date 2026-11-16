import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { db } from "@/db/client";
import { placeNames } from "@/db/queries/lost-found";
import { HOME_BAR } from "@/domain/lost-found/rules";
import { requirePermission } from "@/lib/auth/permission";
import { activeLeague } from "@/lib/league/active";
import { postAction } from "../actions";
import { PostForm } from "./post-form";

export const metadata: Metadata = { title: "Post to lost and found" };

export default function NewPostPage(
  props: PageProps<"/[lang]/app/lost-and-found/new">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <Link
        href="/app/lost-and-found"
        className="inline-flex min-h-11 items-center self-start underline"
      >
        Lost and found
      </Link>
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <Form {...props} />
      </Suspense>
    </main>
  );
}

async function Form({
  searchParams,
}: PageProps<"/[lang]/app/lost-and-found/new">) {
  await requirePermission("lost_found.use", {
    next: "/app/lost-and-found/new",
  });
  const league = await activeLeague();
  if (!league) return <p>There&apos;s no league to post to.</p>;
  const kind = (await searchParams).kind === "lost" ? "lost" : "found";
  const places = [...(await placeNames(db, league.id)), HOME_BAR];
  return (
    <>
      <h1 className="text-h1">
        {kind === "found" ? "I found something" : "I lost something"}
      </h1>
      <PostForm action={postAction} kind={kind} places={places} />
    </>
  );
}
