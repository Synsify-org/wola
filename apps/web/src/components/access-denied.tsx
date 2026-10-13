import Link from "next/link";
import { Lock } from "lucide-react";

/** What someone sees on a page their role can't use: a real heading (every page
 *  has exactly one h1, including this one), one plain sentence, a way back. */
export default function AccessDenied({ title, message }: { title: string; message: string }) {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-rule bg-surface p-8 text-center shadow-theme-xs">
      <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-paper text-ink-soft">
        <Lock className="h-5 w-5" aria-hidden />
      </span>
      <h1 className="mt-4 text-lg font-semibold text-ink">{title}</h1>
      <p className="mt-2 text-sm text-ink-soft">{message}</p>
      <Link href="/" className="mt-5 inline-block text-sm font-medium text-brand-700 hover:underline">
        Back to the dashboard
      </Link>
    </div>
  );
}
