"use server";

import { redirect } from "next/navigation";
import { txDb } from "@/db/client";
import { grantGoodwill } from "@/db/queries/credit";
import { parseGoodwillForm } from "@/domain/money/credit";
import { requirePermissionToChange } from "@/lib/auth/permission";

const PAGE = "/app/admin/credit";

/** An admin gives a player league credit, with a note they will see. */
export async function grantGoodwillAction(form: FormData): Promise<void> {
  const subject = await requirePermissionToChange("refund.issue", {
    next: PAGE,
  });
  const text = (key: string) => {
    const value = form.get(key);
    return typeof value === "string" ? value : "";
  };
  const parsed = parseGoodwillForm({
    email: text("email"),
    amount: text("amount"),
    note: text("note"),
  });
  if (!parsed.ok) {
    const field = Object.keys(parsed.error)[0] ?? "email";
    redirect(`${PAGE}?error=${field}`);
  }
  const actorId = subject.userId;
  const result = await txDb.transaction((tx) =>
    grantGoodwill(tx, { ...parsed.value, actorId }),
  );
  if (!result.ok) redirect(`${PAGE}?error=${result.error}`);
  redirect(`${PAGE}?notice=granted`);
}
