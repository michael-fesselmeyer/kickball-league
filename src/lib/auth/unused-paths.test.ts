import { betterAuth } from "better-auth";
import { describe, expect, it } from "vitest";
import { UNUSED_AUTH_PATHS } from "./config";

const BASE = "http://localhost:3000";

/** Better Auth with its in-memory store; enough to route requests. */
const instance = (disabledPaths: string[]) =>
  betterAuth({
    baseURL: BASE,
    // A placeholder of the required length, not a real value.
    secret: "x".repeat(32),
    disabledPaths,
    telemetry: { enabled: false },
  });

type Endpoint = { path?: string; options?: { method?: string | string[] } };

/** Each route Better Auth serves, with the method it answers. */
function routes(auth: ReturnType<typeof instance>) {
  const found = new Map<string, string>();
  for (const endpoint of Object.values(auth.api) as Endpoint[]) {
    if (!endpoint.path) continue;
    const method = endpoint.options?.method;
    found.set(endpoint.path, Array.isArray(method) ? method[0]! : method!);
  }
  return found;
}

const call = (
  auth: ReturnType<typeof instance>,
  path: string,
  method: string,
) =>
  auth.handler(
    new Request(`${BASE}/api/auth${path}`, {
      method,
      headers: { "content-type": "application/json", origin: BASE },
      ...(method === "GET" ? {} : { body: "{}" }),
    }),
  );

describe("UNUSED_AUTH_PATHS", () => {
  it("names routes Better Auth really serves", () => {
    const served = routes(instance([]));
    for (const path of UNUSED_AUTH_PATHS)
      expect(served.has(path), path).toBe(true);
  });

  it("answers 404 on each once switched off, signed in or not", async () => {
    const open = instance([]);
    const closed = instance([...UNUSED_AUTH_PATHS]);
    const served = routes(open);
    for (const path of UNUSED_AUTH_PATHS) {
      const method = served.get(path)!;
      expect((await call(open, path, method)).status, path).not.toBe(404);
      expect((await call(closed, path, method)).status, path).toBe(404);
    }
  });
});
