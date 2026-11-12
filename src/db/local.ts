/**
 * Whether DATABASE_URL points at a Postgres on this machine (a Docker
 * container in development, or the service container in CI). Neon's drivers
 * speak HTTP and WebSocket to Neon's proxy, which a plain Postgres does not
 * have, so the app uses node-postgres there instead (src/db/client.ts).
 */
export function isLocalDatabase(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  } catch {
    return false;
  }
}
