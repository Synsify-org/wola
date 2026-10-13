"use client";
import { useEffect } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";

// A page inside the signed-in app failed. Keeps the shell (navigation stays),
// shows no technical detail, and gives a reference that matches the server log.
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-md py-16 text-center" role="alert">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-rejected-wash text-rejected">
        <TriangleAlert className="h-7 w-7" aria-hidden />
      </span>
      <h1 className="mt-6 text-2xl font-semibold text-ink">This page couldn&apos;t load</h1>
      <p className="mt-3 text-sm text-ink-soft">
        Something went wrong on our side. Nothing you entered has been submitted or changed. Try again, or go back to the dashboard.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <button type="button" onClick={reset} className="btn btn--primary rounded-full px-5 text-sm">Try again</button>
        <Link href="/" className="btn btn--ghost rounded-full px-5 text-sm">Dashboard</Link>
      </div>
      {error.digest ? (
        <p className="mt-6 text-xs text-ink-faint">Reference: <span className="num">{error.digest}</span></p>
      ) : null}
    </div>
  );
}
