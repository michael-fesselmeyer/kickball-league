"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * A tab in the app's bar. Marks itself as the current page, so the bar
 * says where you are; Home only on the home page itself.
 */
export function TabLink({
  href,
  exact,
  className,
  children,
}: {
  href: string;
  exact: boolean;
  className: string;
  children: React.ReactNode;
}) {
  const path = usePathname();
  const current = exact
    ? path === href
    : path === href || path.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={className}
    >
      {children}
    </Link>
  );
}

/**
 * The menu is a native popover, which Escape and a tap outside already
 * close. A link inside it moves to another page without reloading, so this
 * closes the menu on the way.
 */
export function CloseMenuOnLink({ menuId }: { menuId: string }) {
  useEffect(() => {
    const menu = document.getElementById(menuId);
    if (!menu) return;
    const close = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest("a"))
        menu.hidePopover?.();
    };
    menu.addEventListener("click", close);
    return () => menu.removeEventListener("click", close);
  }, [menuId]);
  return null;
}
