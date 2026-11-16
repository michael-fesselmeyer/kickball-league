/**
 * Google sign-in inside the iOS and Android apps (ADR 0075), the app's
 * side. Google refuses sign-in in an app's web view, so this opens the
 * system browser sheet instead: ASWebAuthenticationSession on iOS (the
 * shell's WebAuthSession plugin, mobile/native/ios), or a Custom Tab on
 * Android (the Browser plugin), which returns through the app's own URL
 * scheme. The sheet comes back with a one-time code, and the web view
 * trades it, with the verifier only this page holds, for its own session.
 *
 * Plugins are reached through `window.Capacitor`, which the shell puts on
 * the page; the site imports no Capacitor package. Browser-only code: load
 * it with `import()` on the tap, so the sign-in page carries none of it.
 */

type Listener = { remove: () => Promise<void> };

export type ShellPlugins = {
  WebAuthSession?: {
    start: (options: {
      url: string;
      callbackScheme: string;
    }) => Promise<{ url: string }>;
  };
  Browser?: {
    open: (options: { url: string }) => Promise<void>;
    close: () => Promise<void>;
    addListener?: (
      event: "browserFinished",
      fn: () => void,
    ) => Promise<Listener>;
  };
  App?: {
    addListener: (
      event: "appUrlOpen",
      fn: (data: { url?: string }) => void,
    ) => Promise<Listener>;
  };
};

type ShellWindow = {
  Capacitor?: {
    isNativePlatform?: () => boolean;
    Plugins?: ShellPlugins;
  };
};

/** The shell's plugins when this page runs inside the iOS or Android app. */
export function shellPlugins(win: unknown): ShellPlugins | null {
  const cap = (win as ShellWindow | undefined)?.Capacitor;
  return cap?.isNativePlatform?.() === true ? (cap.Plugins ?? {}) : null;
}

export type AppSignInOutcome = "signed-in" | "cancelled" | "failed";

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** A random verifier and its challenge, as the server checks them. */
export async function newVerifier(
  crypto: Crypto = globalThis.crypto,
): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

/** The code in the sheet's return address, if it is ours. */
export function codeFromCallback(url: string, scheme: string): string | null {
  if (!url.toLowerCase().startsWith(`${scheme}:`)) return null;
  try {
    return new URL(url).searchParams.get("code");
  } catch {
    return null;
  }
}

export async function signInWithGoogleInApp({
  plugins,
  origin,
  scheme,
  fetch: fetchImpl = fetch,
  crypto = globalThis.crypto,
}: {
  plugins: ShellPlugins;
  /** This site, where the web view and the sheet both sign in. */
  origin: string;
  scheme: string;
  fetch?: typeof fetch;
  crypto?: Crypto;
}): Promise<AppSignInOutcome> {
  const { verifier, challenge } = await newVerifier(crypto);
  const start = `${origin}/api/app-sign-in/google?${new URLSearchParams({ challenge })}`;

  async function redeem(callback: string): Promise<AppSignInOutcome> {
    const code = codeFromCallback(callback, scheme);
    if (!code) return "failed";
    const response = await fetchImpl(`${origin}/api/auth/app-sign-in/redeem`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, verifier }),
    }).catch(() => null);
    return response?.ok ? "signed-in" : "failed";
  }

  // iOS: the system sheet hands the return address straight back.
  if (plugins.WebAuthSession) {
    const result = await plugins.WebAuthSession.start({
      url: start,
      callbackScheme: scheme,
    }).catch(() => null);
    return result ? redeem(result.url) : "cancelled";
  }

  // Android (and an iOS shell without the plugin): a browser tab that
  // returns through the app's URL scheme.
  const { Browser, App } = plugins;
  if (!Browser || !App) return "failed";
  return new Promise<AppSignInOutcome>((resolve) => {
    let settled = false;
    let returned = false;
    const listeners: Promise<Listener>[] = [];
    const settle = (outcome: AppSignInOutcome) => {
      if (settled) return;
      settled = true;
      for (const l of listeners) void l.then((x) => x.remove()).catch(() => {});
      resolve(outcome);
    };
    listeners.push(
      App.addListener("appUrlOpen", ({ url }) => {
        if (returned || !url || !codeFromCallback(url, scheme)) return;
        returned = true;
        void Browser.close().catch(() => {});
        void redeem(url).then(settle);
      }),
    );
    if (Browser.addListener)
      listeners.push(
        Browser.addListener("browserFinished", () => {
          // The return can close the tab before its address arrives, so a
          // close counts as cancelling only when nothing follows soon.
          setTimeout(() => {
            if (!returned) settle("cancelled");
          }, 1500);
        }),
      );
    Browser.open({ url: start }).catch(() => settle("failed"));
  });
}
