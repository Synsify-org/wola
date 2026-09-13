// apps/web/src/app/(app)/loading.tsx
// Route-level loading fallback for every authenticated page. Only possible
// now that Shell lives in (app)/layout.tsx rather than being re-rendered by
// each page — this replaces just the content area (main's children), not
// the whole page, so the sidebar/topbar stay put during navigation instead
// of flashing away. Matches the "no loading feedback, it just freezes"
// report, alongside the per-link spinner in nav-links.tsx.
import { Loader2 } from "lucide-react";

export default function Loading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-brand" aria-label="Loading" />
    </div>
  );
}
