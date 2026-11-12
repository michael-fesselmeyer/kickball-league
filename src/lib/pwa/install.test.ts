import { describe, expect, it } from "vitest";
import {
  DISMISSED_KEY,
  INSTALLABLE_EVENT,
  type InstallState,
  installOffer,
  isIos,
  registerWorkerScript,
  VISITS_KEY,
} from "./install";

const returning: InstallState = {
  visits: 2,
  dismissed: false,
  standalone: false,
  canPrompt: true,
  ios: false,
};

describe("installOffer", () => {
  it("never offers on the first visit", () => {
    expect(installOffer({ ...returning, visits: 0 })).toBeNull();
    expect(installOffer({ ...returning, visits: 1 })).toBeNull();
    expect(installOffer(returning)).toBe("prompt");
  });

  it("stays away once dismissed or installed", () => {
    expect(installOffer({ ...returning, dismissed: true })).toBeNull();
    expect(installOffer({ ...returning, standalone: true })).toBeNull();
  });

  it("explains Safari's Share menu on iPhone, and is quiet elsewhere", () => {
    const ios = { ...returning, canPrompt: false, ios: true };
    expect(installOffer(ios)).toBe("ios");
    expect(installOffer({ ...ios, ios: false })).toBeNull();
  });
});

describe("isIos", () => {
  it("knows iPhones and iPads, including iPads that say they are Macs", () => {
    expect(isIos("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)", 5)).toBe(true);
    expect(isIos("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe(
      true,
    );
    expect(isIos("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)).toBe(
      false,
    );
    expect(isIos("Mozilla/5.0 (Linux; Android 15; Pixel 9)", 5)).toBe(false);
  });
});

describe("registerWorkerScript", () => {
  /** Runs the inline script against a fake window and returns what it did. */
  function run({
    storage = new Map<string, string>(),
    session = new Map<string, string>(),
    serviceWorker = true,
  } = {}) {
    const listeners = new Map<string, (event: unknown) => void>();
    const dispatched: string[] = [];
    const registered: unknown[] = [];
    const store = (map: Map<string, string>) => ({
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => map.set(key, value),
    });
    const win: Record<string, unknown> = {};
    const navigator = serviceWorker
      ? {
          serviceWorker: {
            register: (...args: unknown[]) => {
              registered.push(args);
              return Promise.resolve();
            },
          },
        }
      : {};
    new Function(
      "navigator",
      "addEventListener",
      "dispatchEvent",
      "localStorage",
      "sessionStorage",
      "window",
      "Event",
      registerWorkerScript,
    )(
      navigator,
      (type: string, listener: (event: unknown) => void) =>
        listeners.set(type, listener),
      (event: { type: string }) => dispatched.push(event.type),
      store(storage),
      store(session),
      win,
      class {
        constructor(readonly type: string) {}
      },
    );
    return { listeners, dispatched, registered, storage, session, win };
  }

  it("registers the worker for the whole site after the page loads", () => {
    const { listeners, registered } = run();
    expect(registered).toEqual([]);
    listeners.get("load")?.({});
    expect(registered).toEqual([
      ["/sw.js", { scope: "/", updateViaCache: "none" }],
    ]);
  });

  it("does nothing about the worker where browsers have none", () => {
    expect(run({ serviceWorker: false }).listeners.has("load")).toBe(false);
  });

  it("counts one visit per browser session", () => {
    const storage = new Map<string, string>();
    const session = new Map<string, string>();
    run({ storage, session });
    run({ storage, session });
    expect(storage.get(VISITS_KEY)).toBe("1");
    run({ storage, session: new Map() });
    expect(storage.get(VISITS_KEY)).toBe("2");
    expect(storage.has(DISMISSED_KEY)).toBe(false);
  });

  it("holds the browser's install prompt for the home screen", () => {
    const { listeners, dispatched, win } = run();
    let prevented = false;
    const prompt = { preventDefault: () => (prevented = true) };
    listeners.get("beforeinstallprompt")?.(prompt);
    expect(prevented).toBe(true);
    expect(win.__kbInstallPrompt).toBe(prompt);
    expect(dispatched).toEqual([INSTALLABLE_EVENT]);
  });
});
