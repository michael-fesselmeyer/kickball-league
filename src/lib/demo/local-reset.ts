import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * The "Reset demo" button runs the same command as `npm run demo:reset`, so
 * it works where the server runs from a checkout of the code with its tools
 * installed: the local demo (docs/demo.md). Elsewhere the button is hidden.
 */
export function localResetAvailable(cwd: string = process.cwd()): boolean {
  return (
    existsSync(path.join(cwd, "scripts", "reset-demo.ts")) &&
    existsSync(path.join(cwd, "node_modules", ".bin", "tsx"))
  );
}

/**
 * Runs `npm run demo:reset` with this server's own environment (the demo's
 * database and DEMO_MODE), and says whether it finished cleanly. The reset
 * refuses on its own unless demo mode is on.
 */
export function runLocalReset(cwd: string = process.cwd()): Promise<boolean> {
  return new Promise((resolve) => {
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const child = spawn(npm, ["run", "--silent", "demo:reset"], {
      cwd,
      env: process.env,
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}
