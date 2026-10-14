"use client";
// Shows the one-shot message left by the previous page ("Signed in", "Signed out",
// "Your session ended"): see lib/flash.ts. Mount it once per surface: the app shell, the
// login pages and the platform console. Renders nothing.
import { useEffect } from "react";
import { toast } from "sonner";
import { describeFlash, reasonToFlashCode, takeFlash } from "@/lib/flash";

export default function AuthFlash({ name }: { name?: string | null }) {
  useEffect(() => {
    // The cookie is TAKEN here, so a second run of this effect (React StrictMode in
    // development, or a re-render) finds nothing and can't show it twice.
    const params = new URLSearchParams(window.location.search);
    const reason = params.get("reason");
    const code = takeFlash() ?? reasonToFlashCode(reason);
    if (reason) {
      params.delete("reason");
      const rest = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (rest ? `?${rest}` : "") + window.location.hash);
    }

    const flash = describeFlash(code, name);
    if (!flash) return;
    const show = flash.kind === "success" ? toast.success : flash.kind === "warning" ? toast.warning : toast.info;
    // On a full page load this effect runs before the toast host (a later sibling in the
    // root layout) has started listening, and an early toast is lost. A beat later it is
    // there. Deliberately no cleanup: if the first effect run is torn down, the cookie is
    // already gone and this timer is the only thing left to show it.
    setTimeout(() => show(flash.title, { description: flash.description }), 250);
  }, [name]);

  return null;
}
