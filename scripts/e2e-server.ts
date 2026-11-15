/**
 * Starts `next start` for the end-to-end run and passes its error output
 * through `redactLogLine`, so a failed query never prints a session token
 * into the CI log. Takes the same arguments as `next start`.
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { createRequire } from "node:module";
import { redactLogLine } from "../src/lib/redact-log";

const nextBin = createRequire(`${process.cwd()}/package.json`).resolve(
  "next/dist/bin/next",
);

const server = spawn(
  process.execPath,
  [nextBin, "start", ...process.argv.slice(2)],
  { stdio: ["ignore", "ignore", "pipe"] },
);

createInterface({ input: server.stderr }).on("line", (line) => {
  process.stderr.write(`${redactLogLine(line)}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.kill(signal));
}
server.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
