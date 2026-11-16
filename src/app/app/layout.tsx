import { Suspense } from "react";
import { AppNav, NavPlaceholder } from "./app-nav";

/**
 * Every signed-in screen: the app's tab bar and menu around the page. The
 * bar reads who is signed in, so it streams in behind a placeholder of the
 * same size.
 */
export default function AppLayout({ children }: LayoutProps<"/app">) {
  return (
    <>
      <Suspense fallback={<NavPlaceholder />}>
        <AppNav />
      </Suspense>
      {children}
    </>
  );
}
