import type { Metadata } from "next";
import { ContactForm } from "./contact-form";

export const metadata: Metadata = {
  title: "Contact the league",
  description:
    "Ask the league a question or tell it about a problem at the field. No account needed.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-12 md:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-h1">Contact the league</h1>
        <p className="text-body-lg text-text-muted">
          A question, or a problem at the field? Tell us. No account needed, and
          only the league&apos;s admins read it.
        </p>
      </header>
      <ContactForm />
    </main>
  );
}
