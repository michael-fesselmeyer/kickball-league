import Link from "next/link";
import { type HelpRole, helpHref } from "@/app/help/articles";

/**
 * A screen's "Help" link to its how-to in the help center. `article` is the
 * how-to's anchor; a test checks every one used in src/app exists.
 */
export function HelpLink({
  role,
  article,
  topic,
}: {
  role: HelpRole["slug"];
  article: string;
  /** What the how-to is about, for screen readers ("Help: paying"). */
  topic: string;
}) {
  return (
    <Link
      href={helpHref(role, article)}
      prefetch={false}
      className="inline-flex min-h-11 items-center self-start text-small underline underline-offset-4"
    >
      Help<span className="sr-only">: {topic}</span>
    </Link>
  );
}
