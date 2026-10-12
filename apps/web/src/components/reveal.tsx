"use client";
// apps/web/src/components/reveal.tsx
// Fade a below-the-fold section in when it's scrolled to, instead of on mount
// (when a phone user would never see the animation finish). Server HTML is
// fully visible, so no-JS / failed hydration never hides content: only after
// mount, and only for a section that starts below the viewport, do we hide it
// and wait for it to enter. Reduced-motion users never get the hide step.
import { createElement, useEffect, useRef, useState } from "react";

const ANIMATE = "animate-in fade-in slide-in-from-bottom-2 duration-500";

export default function Reveal({
  as = "div",
  className = "",
  children,
}: {
  as?: "div" | "section";
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const [state, setState] = useState<"initial" | "hidden" | "shown">("initial");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined" || !window.matchMedia) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight) return; // already on screen
    setState("hidden");
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setState("shown");
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    // The scroll container is <main>, not the window; a null root observes the
    // viewport, which is what we want since main fills it.
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const motion = state === "hidden" ? "opacity-0" : ANIMATE;
  return createElement(as, { ref, "data-reveal": state, className: `${className} ${motion}`.trim() }, children);
}
