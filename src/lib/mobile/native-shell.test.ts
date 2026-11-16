// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { isNativeShell, nativeShellScript } from "./native-shell";

type Listener = (event?: unknown) => void;

const ORIGIN = "https://league.example.test";

/**
 * Runs the inline script as written, against this page's DOM and a fake
 * Capacitor bridge, location and history, and returns what it touched.
 */
function run({
  native = true,
  plugins = ["App", "Browser"],
}: { native?: boolean | "absent"; plugins?: string[] } = {}) {
  const appListeners = new Map<string, Listener>();
  const calls = {
    browser: vi.fn(),
    minimize: vi.fn(),
    windowOpen: vi.fn(),
    back: vi.fn(),
    assign: vi.fn(),
  };
  const Plugins: Record<string, unknown> = {};
  if (plugins.includes("App"))
    Plugins.App = {
      addListener: (name: string, fn: Listener) => appListeners.set(name, fn),
      minimizeApp: calls.minimize,
    };
  if (plugins.includes("Browser")) Plugins.Browser = { open: calls.browser };
  const fakeWindow = {
    Capacitor:
      native === "absent"
        ? undefined
        : { isNativePlatform: () => native, Plugins },
    open: calls.windowOpen,
  };
  const fakeLocation = {
    href: `${ORIGIN}/app`,
    origin: ORIGIN,
    assign: calls.assign,
  };
  const fakeHistory = { back: calls.back };
  new Function("window", "location", "history", nativeShellScript)(
    fakeWindow,
    fakeLocation,
    fakeHistory,
  );
  return { calls, appListeners };
}

/** Renders `html` and clicks its link (or span) as a person would. */
function click(html: string, init: MouseEventInit = {}) {
  document.body.innerHTML = html;
  const target = document.body.querySelector("a, span") as HTMLElement;
  const event = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...init,
  });
  // jsdom would try to navigate; the script only needs to see the click.
  document.addEventListener("click", (e) => e.preventDefault(), {
    once: true,
  });
  target.dispatchEvent(event);
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  document.documentElement.removeAttribute("data-shell");
  document.body.innerHTML = "";
  for (const undo of cleanups.splice(0)) undo();
});

/** Each run adds a document listener; record and drop it after the test. */
function tracked(options?: Parameters<typeof run>[0]) {
  const added: [string, EventListenerOrEventListenerObject][] = [];
  const original = document.addEventListener.bind(document);
  const spy = vi
    .spyOn(document, "addEventListener")
    .mockImplementation((type, listener, opts) => {
      if (listener) added.push([type, listener]);
      original(type, listener, opts);
    });
  const result = run(options);
  spy.mockRestore();
  cleanups.push(() => {
    for (const [type, listener] of added)
      document.removeEventListener(type, listener);
  });
  return result;
}

describe("nativeShellScript in a browser", () => {
  it("does nothing without the app's bridge", () => {
    const absent = tracked({ native: "absent" });
    const web = tracked({ native: false });
    expect(isNativeShell()).toBe(false);
    expect(absent.appListeners.size + web.appListeners.size).toBe(0);
    click(`<a href="https://elsewhere.example.test/">x</a>`);
    expect(absent.calls.browser).not.toHaveBeenCalled();
    expect(web.calls.windowOpen).not.toHaveBeenCalled();
  });
});

describe("nativeShellScript in the app", () => {
  it("marks the page as running in the app", () => {
    tracked();
    expect(isNativeShell()).toBe(true);
    expect(document.documentElement.getAttribute("data-shell")).toBe("app");
  });

  it("opens other sites in the system browser", () => {
    const { calls } = tracked();
    click(
      `<a href="https://partiful.example.test/e/1" target="_blank">RSVP</a>`,
    );
    expect(calls.browser).toHaveBeenCalledWith({
      url: "https://partiful.example.test/e/1",
    });
  });

  it("falls back to a new window without the Browser plugin", () => {
    const { calls } = tracked({ plugins: ["App"] });
    click(`<a href="http://elsewhere.example.test/x">x</a>`);
    expect(calls.windowOpen).toHaveBeenCalledWith(
      "http://elsewhere.example.test/x",
      "_blank",
      "noopener",
    );
  });

  it("leaves this site's links, other schemes and modified clicks alone", () => {
    const { calls } = tracked();
    click(`<a href="/games/1">Game</a>`);
    click(`<a href="${ORIGIN}/seasons">Seasons</a>`);
    click(`<a href="mailto:league@example.test">Email</a>`);
    click(`<a href="tel:+15550100">Call</a>`);
    click(`<a href="https://elsewhere.example.test/" download>File</a>`);
    click(`<a href="https://elsewhere.example.test/">x</a>`, { metaKey: true });
    click(`<span>not a link</span>`);
    expect(calls.browser).not.toHaveBeenCalled();
    expect(calls.windowOpen).not.toHaveBeenCalled();
  });

  it("finds the link from a click on something inside it", () => {
    const { calls } = tracked();
    document.body.innerHTML = `<a href="https://elsewhere.example.test/"><b>in</b></a>`;
    document.body
      .querySelector("b")!
      .dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
      );
    expect(calls.browser).toHaveBeenCalledOnce();
  });

  it("skips a click the page already handled", () => {
    const { calls } = tracked();
    document.body.innerHTML = `<a href="https://elsewhere.example.test/">x</a>`;
    const link = document.body.querySelector("a")!;
    link.addEventListener("click", (e) => e.preventDefault());
    link.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );
    expect(calls.browser).not.toHaveBeenCalled();
  });
});

describe("Android's back button", () => {
  it("closes an open dialog before anything else", () => {
    const { calls, appListeners } = tracked();
    document.body.innerHTML = `<dialog open>Confirm</dialog>`;
    const dialog = document.querySelector("dialog")!;
    dialog.close = vi.fn(() => dialog.removeAttribute("open"));
    appListeners.get("backButton")!({ canGoBack: true });
    expect(dialog.close).toHaveBeenCalledOnce();
    expect(calls.back).not.toHaveBeenCalled();
  });

  it("goes back a page, and at the first page leaves the app open in the background", () => {
    const { calls, appListeners } = tracked();
    appListeners.get("backButton")!({ canGoBack: true });
    expect(calls.back).toHaveBeenCalledOnce();
    appListeners.get("backButton")!({ canGoBack: false });
    expect(calls.minimize).toHaveBeenCalledOnce();
  });

  it("needs the App plugin, and is left to the web view without it", () => {
    const { appListeners } = tracked({ plugins: ["Browser"] });
    expect(appListeners.size).toBe(0);
    expect(isNativeShell()).toBe(true);
  });
});

describe("links that open the app", () => {
  it("follows a link to this site to its page", () => {
    const { calls, appListeners } = tracked();
    appListeners.get("appUrlOpen")!({ url: `${ORIGIN}/games/abc?x=1#score` });
    expect(calls.assign).toHaveBeenCalledWith("/games/abc?x=1#score");
  });

  it("ignores other sites and nonsense", () => {
    const { calls, appListeners } = tracked();
    appListeners.get("appUrlOpen")!({ url: "https://evil.example.test/app" });
    appListeners.get("appUrlOpen")!({ url: "not a url" });
    appListeners.get("appUrlOpen")!(undefined);
    expect(calls.assign).not.toHaveBeenCalled();
  });
});
