/**
 * Closes a menu sheet (a native popover) when one of its links is followed.
 * The client router moves to the next page without reloading, so the sheet
 * would otherwise stay open over it. Inlined into every page's <head>, like
 * the theme button's script, so the public header's menu costs no script
 * file (src/components/site-header.tsx, docs/design-system.md, Performance
 * budgets). Escape, a tap outside and Close are the popover's own.
 */
export function installCloseMenuOnLink(): () => void {
  const close = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest("[popover] a[href]");
    const menu = link?.closest<HTMLElement>("[popover]");
    if (menu?.matches(":popover-open")) menu.hidePopover();
  };
  document.addEventListener("click", close);
  return () => document.removeEventListener("click", close);
}

export const closeMenuOnLinkScript = `(${installCloseMenuOnLink.toString()})();`;
