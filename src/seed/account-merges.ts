import { inArray, or } from "drizzle-orm";
import type { Db } from "@/db/queries/schedule";
import { accountMerge } from "@/db/schema";
import type { UserId } from "@/domain/ids";

/**
 * Clears merge records for people a reset is about to delete: a merge
 * record points at both accounts and would block deleting either.
 */
export async function removeAccountMerges(
  db: Db,
  userIds: UserId[],
): Promise<void> {
  if (userIds.length === 0) return;
  await db
    .delete(accountMerge)
    .where(
      or(
        inArray(accountMerge.keptUserId, userIds),
        inArray(accountMerge.mergedUserId, userIds),
      ),
    );
}
