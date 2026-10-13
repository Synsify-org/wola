import type { Metadata } from "next";
import Link from "next/link";
import { Compass } from "lucide-react";

export const metadata: Metadata = {
  title: "Page not found",
  description: "The page you were looking for doesn't exist, or you don't have access to it.",
  robots: { index: false, follow: false },
};

// Inside the signed-in shell, so the person keeps their navigation. Also what
// `notFound()` renders for a record that doesn't exist or isn't theirs to see —
// deliberately the same page, so the two can't be told apart.
export default function AppNotFound() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-700">
        <Compass className="h-7 w-7" aria-hidden />
      </span>
      <p className="mt-6 text-sm font-semibold text-brand-700">Error 404</p>
      <h1 className="mt-2 text-2xl font-semibold text-ink">We can&apos;t find that page</h1>
      <p className="mt-3 text-sm text-ink-soft">
        It may have moved, or it may not exist. If you followed a link inside Wola, tell your administrator.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link href="/" className="btn btn--primary rounded-full px-5 text-sm">Go to dashboard</Link>
        <Link href="/applications" className="btn btn--ghost rounded-full px-5 text-sm">Applications</Link>
        <Link href="/loans" className="btn btn--ghost rounded-full px-5 text-sm">My loans</Link>
      </div>
    </div>
  );
}
