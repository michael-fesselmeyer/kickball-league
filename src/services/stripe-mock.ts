type Env = Readonly<Record<string, string | undefined>>;

export type StripeServer = {
  host: string;
  port: number;
  protocol: "http";
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * Where the end-to-end tests send Stripe calls: Stripe's own mock server
 * (stripe-mock) on this machine, so checkout can be tested without reaching
 * Stripe. Set with STRIPE_MOCK_URL, for example http://localhost:12111.
 *
 * Ignored unless the key is a test key and the address is this machine, so it
 * can never redirect live payments. Read from the raw environment like
 * DEMO_MODE, because it is a test switch and not part of the app's settings.
 */
export function stripeMockServer(env: Env): StripeServer | null {
  const raw = env.STRIPE_MOCK_URL;
  if (!raw || !env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" || !LOCAL_HOSTS.has(url.hostname)) return null;
  return {
    host: url.hostname,
    port: Number(url.port || 80),
    protocol: "http",
  };
}
