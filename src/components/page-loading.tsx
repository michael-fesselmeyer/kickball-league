/**
 * The loading state of a public page whose content streams in after a
 * database read. It holds a screen's height, so the footer starts below the
 * fold and does not jump when the content arrives (the layout-shift budget
 * in docs/design-system.md).
 */
export function PageLoading({ children }: { children: React.ReactNode }) {
  return <p className="min-h-svh">{children}</p>;
}
