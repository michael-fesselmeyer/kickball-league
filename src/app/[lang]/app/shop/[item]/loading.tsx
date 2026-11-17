/**
 * The shop item while it loads: blocks where the breadcrumb, title, photo
 * and order form will be, at their sizes, so nothing jumps when the item
 * arrives (the layout-shift budget in docs/design-system.md).
 */
export default function ShopItemLoading() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <ShopItemSkeleton />
    </main>
  );
}

const BLOCK = "rounded-input bg-surface-2 motion-safe:animate-pulse";

export function ShopItemSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <p className="sr-only" role="status">
        Loading the item…
      </p>
      <div aria-hidden="true" className="flex min-h-11 items-center">
        <div className={`h-4 w-24 ${BLOCK}`} />
      </div>
      <div aria-hidden="true" className="flex flex-col gap-2">
        <div className={`h-10 w-3/4 ${BLOCK}`} />
        <div className={`h-6 w-1/3 ${BLOCK}`} />
      </div>
      <div aria-hidden="true" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className={`col-span-2 aspect-square ${BLOCK}`} />
      </div>
      <div
        aria-hidden="true"
        className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4"
      >
        <div className={`h-8 w-24 ${BLOCK}`} />
        <div className={`h-11 w-40 ${BLOCK}`} />
        <div className={`h-11 w-28 ${BLOCK}`} />
        <div className={`h-11 w-48 rounded-full ${BLOCK}`} />
      </div>
    </div>
  );
}
