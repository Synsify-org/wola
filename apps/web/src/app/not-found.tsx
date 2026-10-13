import type { Metadata } from "next";
import Link from "next/link";
import { Compass } from "lucide-react";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: "Page not found",
  description: "The page you were looking for doesn't exist or has moved.",
  robots: { index: false, follow: false },
};

// Shown for any address that doesn't exist (outside the signed-in app).
export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-paper px-6 py-16">
      <div className="w-full max-w-md text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-700">
          <Compass className="h-7 w-7" aria-hidden />
        </span>
        <p className="mt-6 text-sm font-semibold text-brand-700">Error 404</p>
        <h1 className="mt-2 text-2xl font-semibold text-ink">We can&apos;t find that page</h1>
        <p className="mt-3 text-sm text-ink-soft">
          The address may be mistyped, or the page may have moved. Nothing is wrong with your account.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/" className="btn btn--primary rounded-full px-5 text-sm">Go to {SITE_NAME}</Link>
          <Link href="/login" className="btn btn--ghost rounded-full px-5 text-sm">Sign in</Link>
        </div>
      </div>
    </main>
  );
}
