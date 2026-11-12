import { loadEnv } from "./lib/env";

/** Validated server environment. Importing this module fails fast if anything is missing. */
export const env = loadEnv(process.env);
