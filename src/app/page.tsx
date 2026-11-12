import Link from "next/link";
import { Kickball } from "@/components/kickball";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-8 px-4 py-16 md:px-6">
      <p>
        <span className="sticker">Sundays in the park ☀️</span>
      </p>
      <h1 className="max-w-[14ch] text-display text-text">
        Kick a ball. Meet your new{" "}
        <span className="swipe">favorite people.</span>
      </h1>
      <p className="max-w-prose text-body-lg text-text-muted">
        Grown-up kickball for people who haven&apos;t played since recess. Bring
        a team or come solo and we&apos;ll find you one. Stick around after for
        a drink (or a seltzer). The full site is warming up.
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <Link href="/sign-in" className="btn btn-primary">
          Sign in
        </Link>
        <Kickball className="size-12 rotate-12" />
      </div>
    </main>
  );
}
