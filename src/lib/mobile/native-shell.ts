/**
 * What the site does differently inside the iOS and Android apps
 * (docs/mobile.md, ADR 0074). The apps are a Capacitor shell around the
 * site, which puts a `Capacitor` object on the page before any of the
 * site's own scripts run. In a browser there is no such object and none of
 * this does anything.
 */

/** Set on <html> before paint inside the apps, as `data-shell="app"`. */
export const SHELL_ATTRIBUTE = "data-shell";
export const SHELL_APP = "app";

/** True inside the iOS or Android app. Client code only. */
export function isNativeShell(doc: Document = document): boolean {
  return doc.documentElement.getAttribute(SHELL_ATTRIBUTE) === SHELL_APP;
}

/**
 * Inlined in <head> on every page, before paint. Kept tiny and
 * dependency-free because every page carries it, and it returns at once in
 * a browser. Inside the apps it:
 *
 * - marks <html> with data-shell="app", so the install offer and push
 *   settings know they are in the app (isNativeShell);
 * - opens links to other sites in the system browser (the Browser plugin's
 *   in-app sheet), so the app never turns into a browser without an
 *   address bar. Links to this site, mailto:, tel: and links the page
 *   already handles are left alone;
 * - makes Android's back button close an open dialog or popover first,
 *   then go back a page, and at the first page leave the app in the
 *   background rather than quit it;
 * - follows a link to this site that opened the app (an Android App Link)
 *   to its page.
 *
 * Plugins are reached through `Capacitor.Plugins`, which the shell fills
 * for the plugins it was built with; a missing plugin falls back to the
 * web view's own behavior.
 */
export const nativeShellScript = [
  `(function(){var C=window.Capacitor;if(!C||!C.isNativePlatform||!C.isNativePlatform())return;`,
  `document.documentElement.setAttribute("${SHELL_ATTRIBUTE}","${SHELL_APP}");`,
  `var P=C.Plugins||{};`,
  `document.addEventListener("click",function(e){`,
  `if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;`,
  `var a=e.target&&e.target.closest&&e.target.closest("a[href]");if(!a||a.hasAttribute("download"))return;`,
  `var u;try{u=new URL(a.getAttribute("href"),location.href)}catch(x){return}`,
  `if(u.origin===location.origin||(u.protocol!=="https:"&&u.protocol!=="http:"))return;`,
  `e.preventDefault();if(P.Browser)P.Browser.open({url:u.href});else window.open(u.href,"_blank","noopener")});`,
  `if(!P.App)return;`,
  `P.App.addListener("backButton",function(s){`,
  `var d=document.querySelector("dialog[open]");if(d){d.close();return}`,
  `try{var p=document.querySelector(":popover-open");if(p){p.hidePopover();return}}catch(x){}`,
  `if(s&&s.canGoBack)history.back();else P.App.minimizeApp()});`,
  `P.App.addListener("appUrlOpen",function(o){var u;try{u=new URL(o&&o.url)}catch(x){return}`,
  `if(u.origin===location.origin)location.assign(u.pathname+u.search+u.hash)})`,
  `})();`,
].join("");
