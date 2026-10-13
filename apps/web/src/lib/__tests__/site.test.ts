import { describe, test, expect } from "vitest";
import { pageMeta, SHARE_IMAGES } from "../site";

// next/headers is only touched by siteOrigin(), which these tests don't call.
describe("pageMeta", () => {
  test("pages are private by default: noindex, nofollow, noarchive, nosnippet", () => {
    const m = pageMeta({ title: "Loan products", description: "d", path: "/settings/products" });
    expect(m.robots).toEqual({ index: false, follow: false, noarchive: true, nosnippet: true });
  });

  test("only an explicit opt-in is indexable (the sign-in page)", () => {
    const m = pageMeta({ title: "Sign in", description: "d", path: "/login", index: true });
    expect(m.robots).toEqual({ index: true, follow: true });
  });

  test("every page gets a canonical path, a description and link-preview images", () => {
    const m = pageMeta({ title: "Reports", description: "Portfolio reports.", path: "/reports" });
    expect(m.title).toBe("Reports"); // the root layout's template adds " · Wola"
    expect(m.description).toBe("Portfolio reports.");
    expect(m.alternates?.canonical).toBe("/reports");
    expect((m.openGraph as { images: unknown }).images).toEqual(SHARE_IMAGES.openGraph);
    expect((m.twitter as { images: unknown }).images).toEqual(SHARE_IMAGES.twitter);
  });

  test("share images are described for screen readers and sized for large previews", () => {
    const [og] = SHARE_IMAGES.openGraph;
    expect(og.alt.length).toBeGreaterThan(10);
    expect([og.width, og.height]).toEqual([1200, 630]);
  });
});
