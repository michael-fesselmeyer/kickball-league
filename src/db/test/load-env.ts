import { existsSync } from "node:fs";

// CI sets DATABASE_URL directly. Locally, read .env.local. (Next's
// loadEnvConfig skips .env.local when NODE_ENV is "test", as it is here.)
if (!process.env.DATABASE_URL && existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}
