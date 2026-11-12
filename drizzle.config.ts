import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";
import { envSchema } from "./src/lib/env";

// drizzle-kit runs outside Next, so load .env.local the same way Next does.
loadEnvConfig(process.cwd());

// Only the database URL is needed here; validate it with the app's own rule.
const { DATABASE_URL } = envSchema
  .pick({ DATABASE_URL: true })
  .parse(process.env);

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  casing: "snake_case",
  dbCredentials: { url: DATABASE_URL },
  strict: true,
  verbose: true,
});
