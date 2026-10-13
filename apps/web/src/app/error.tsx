"use client";
import { useEffect } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";

// Boundary for pages outside the signed-in app (sign-in, invitations, password
// reset). Never shows the technical message; shows a reference the user can
// quote to support, which matches the server log line for the same failure.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="grid min-h-dvh place-items-center bg-paper px-6 py-16">
      <div className="w-full max-w-md text-center" role="alert">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-rejected-wash text-rejected">
          <TriangleAlert className="h-7 w-7" aria-hidden />
        </span>
        <h1 className="mt-6 text-2xl font-semibold text-ink">Something went wrong</h1>
        <p className="mt-3 text-sm text-ink-soft">
          We couldn&apos;t load this page. It&apos;s not your fault, and nothing you entered has been submitted.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button type="button" onClick={reset} className="btn btn--primary rounded-full px-5 text-sm">Try again</button>
          <Link href="/login" className="btn btn--ghost rounded-full px-5 text-sm">Back to sign in</Link>
        </div>
        {error.digest ? (
          <p className="mt-6 text-xs text-ink-faint">Reference: <span className="num">{error.digest}</span></p>
        ) : null}
      </div>
    </main>
  );
}
