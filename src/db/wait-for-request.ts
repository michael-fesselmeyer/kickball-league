import { io } from "next/cache";

/**
 * Holds a query until a real request needs its answer
 * ([ADR 0047](../../docs/adr/0047-queries-wait-for-a-real-request.md)).
 *
 * With Partial Prefetching on, Next.js renders every dynamic page twice: the
 * page itself, and a prerender of its App Shell that it embeds for the
 * client's cached navigation. A prerender keeps only static and `use cache`
 * output, so an uncached query there is sent, paid for and thrown away.
 * `io()` stops a prerender at this point, so the query is never sent; in a
 * real request and inside a `use cache` scope it resolves, and outside
 * Next.js (scripts, tests) it does nothing.
 */
export function waitForRequest(): Promise<void> {
  try {
    // When the prerender ends, the promise rejects, and the query with it.
    return io();
  } catch {
    // `io()` refuses at once inside a page's `after()` callback. Work there
    // runs for a request that has already been answered, so it goes ahead.
    return Promise.resolve();
  }
}

/**
 * The same database client, with `query` waiting for a real request first.
 * Drizzle sends every statement through `query`, on node-postgres and on
 * Neon's HTTP driver alike. A transaction's statements run on a connection
 * from `connect()` and are not held; transactions run only in Server Actions,
 * Route Handlers and jobs, which are real requests.
 */
export function queriesWaitForRequest<Client extends object>(
  client: Client,
): Client {
  return new Proxy(client, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (property !== "query" || typeof value !== "function") {
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async (...args: unknown[]) => {
        await waitForRequest();
        return value.apply(target, args);
      };
    },
  });
}
