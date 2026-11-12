import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Account deleted",
  robots: { index: false },
};

/** Where a person lands after deleting their account. */
export default function AccountDeletedPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-10">
      <h1 className="text-h1">Your account is deleted</h1>
      <p>
        Your profile, email address and sign-in methods are removed, and you are
        signed out. Past rosters and payments now show &ldquo;Deleted
        account&rdquo; instead of your name. Signed waivers are kept as signed.
      </p>
      <p>
        <Link href="/" className="underline">
          Back to the home page
        </Link>
      </p>
    </main>
  );
}
