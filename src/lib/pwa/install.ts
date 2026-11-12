/**
 * When the home screen offers to install the app (docs/architecture.md,
 * section 14). Only captains, refs and admins see the offer, never on their
 * first visit, and "Not now" is remembered on the device.
 */

export const VISITS_KEY = "kb-visits";
export const VISIT_SESSION_KEY = "kb-visit-counted";
export const DISMISSED_KEY = "kb-install-dismissed";
/** The window event that says a deferred install prompt is waiting. */
export const INSTALLABLE_EVENT = "kb-installable";

export type InstallState = {
  /** Browser sessions on this device, counted by the registration script. */
  visits: number;
  dismissed: boolean;
  /** Already running as the installed app. */
  standalone: boolean;
  /** The browser handed us its install prompt (Chrome, Edge, Android). */
  canPrompt: boolean;
  /** iPhone and iPad install from Safari's Share menu instead. */
  ios: boolean;
};

export type InstallOffer = "prompt" | "ios" | null;

export function installOffer(state: InstallState): InstallOffer {
  if (state.visits < 2 || state.dismissed || state.standalone) return null;
  if (state.canPrompt) return "prompt";
  if (state.ios) return "ios";
  return null;
}

/** iPhone, iPod, or an iPad that reports itself as a Mac. */
export function isIos(userAgent: string, maxTouchPoints: number): boolean {
  return (
    /iPhone|iPad|iPod/.test(userAgent) ||
    (/Macintosh/.test(userAgent) && maxTouchPoints > 1)
  );
}

/**
 * Inlined in <head> on every page in production builds: registers the
 * service worker after load, counts one visit per browser session, and
 * holds the browser's install prompt so only the home screen offers it.
 * Kept tiny and dependency-free because every page carries it.
 */
export const registerWorkerScript = [
  `if("serviceWorker"in navigator)addEventListener("load",function(){navigator.serviceWorker.register("/sw.js",{scope:"/",updateViaCache:"none"}).catch(function(){})});`,
  `try{if(!sessionStorage.getItem("${VISIT_SESSION_KEY}")){sessionStorage.setItem("${VISIT_SESSION_KEY}","1");localStorage.setItem("${VISITS_KEY}",String((Number(localStorage.getItem("${VISITS_KEY}"))||0)+1))}}catch(e){}`,
  `addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__kbInstallPrompt=e;dispatchEvent(new Event("${INSTALLABLE_EVENT}"))});`,
].join("");
