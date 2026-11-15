import { customType } from "drizzle-orm/pg-core";

/**
 * Raw bytes, for the stored copy of a synced photo (and the owners' books
 * files, ./books.ts). Sent as Postgres's hex
 * text form, which every driver passes through unchanged; read back as a
 * Buffer (node-postgres) or that same hex text (Neon's HTTP driver).
 */
export const bytea = customType<{ data: Buffer; driverData: Buffer | string }>({
  dataType: () => "bytea",
  toDriver: (value) => `\\x${value.toString("hex")}`,
  fromDriver: (value) =>
    typeof value === "string"
      ? Buffer.from(value.replace(/^\\x/, ""), "hex")
      : Buffer.from(value),
});
