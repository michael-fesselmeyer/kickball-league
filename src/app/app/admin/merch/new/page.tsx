import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requirePermission } from "@/lib/auth/permission";
import { createItemAction } from "../actions";
import { EMPTY_ITEM, ItemFormFields } from "../item-form";

export const metadata: Metadata = { title: "New merch item" };

export default function NewMerchItemPage(
  props: PageProps<"/app/admin/merch/new">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <Suspense fallback={<p className="min-h-svh">Loading…</p>}>
        <NewItem {...props} />
      </Suspense>
    </main>
  );
}

async function NewItem({ searchParams }: PageProps<"/app/admin/merch/new">) {
  await requirePermission("merch.manage", { next: "/app/admin/merch/new" });
  const query = await searchParams;
  return (
    <>
      <nav aria-label="Breadcrumb" className="text-small">
        <Link
          href="/app/admin/merch"
          className="inline-flex min-h-11 items-center underline"
        >
          Merch
        </Link>
      </nav>
      <h1 className="text-h1">New item</h1>
      <ItemFormFields
        action={createItemAction}
        values={EMPTY_ITEM}
        error={typeof query.error === "string" ? query.error : null}
        submit="Add item"
      />
    </>
  );
}
