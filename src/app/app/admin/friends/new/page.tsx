import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BLANK_FRIEND_FORM } from "@/domain/friends/friend-form";
import { requirePermission } from "@/lib/auth/permission";
import { createFriendAction } from "../actions";
import { FriendFormFields } from "../friend-form";
import { PageLoading } from "@/components/page-loading";

export const metadata: Metadata = { title: "Add a league" };

export default function NewFriendPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-1">
        <Link
          href="/app/admin/friends"
          className="inline-flex min-h-11 items-center self-start underline"
        >
          Friends of the league
        </Link>
        <h1 className="text-h1">Add a league</h1>
      </header>
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <NewFriend />
      </Suspense>
    </main>
  );
}

async function NewFriend() {
  await requirePermission("friends.manage", {
    next: "/app/admin/friends/new",
  });
  return (
    <FriendFormFields
      action={createFriendAction}
      values={BLANK_FRIEND_FORM}
      submitLabel="Add to the directory"
      hasLogo={false}
    />
  );
}
