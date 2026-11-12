import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-6 px-4 py-16 md:px-6">
      <p className="text-micro font-semibold tracking-widest text-accent uppercase">
        Sundays in the park
      </p>
      <h1 className="max-w-[16ch] text-display text-text">
        Adult kickball, organized.
      </h1>
      <p className="max-w-prose text-body-lg text-text-muted">
        Register your team or join as a free agent, pay your share, and see the
        schedule, scores and standings in one place. The full site is being
        built.
      </p>
      <div>
        <Link
          href="/sign-in"
          className="inline-flex min-h-11 items-center rounded-input bg-brand px-5 font-medium text-on-brand"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
