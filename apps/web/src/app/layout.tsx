// apps/web/src/app/layout.tsx
// Loads the type and injects the TENANT BRAND.
//
// Only --color-brand moves per tenant. State colours (approved / rejected /
// awaiting) are system-owned and defined in globals.css — a tenant cannot
// brand them, because an approver must never misread a rejected document as
// a header colour.
import type { Metadata } from "next";
import { headers } from "next/headers";
import localFont from "next/font/local";
import "./globals.css";
import { cn } from "@/lib/utils";
import { resolveTenant } from "@wola/db";
import { db } from "@/lib/tenant";
import { themeStyle } from "@/lib/theme";

// Fonts are self-hosted from ./fonts (Latin, variable weight axis), not
// fetched from Google at build time. next/font/google made every build depend
// on live requests to fonts.googleapis.com; a bad response from Google failed
// a production deploy outright (2026-09-24). Files come from the
// @fontsource-variable/* 5.3.0 packages, SIL OFL 1.1 (licences alongside).
// The app default is Segoe UI, a system font (globals.css --font-system), so
// these five are only tenant choices (lib/theme.ts FONT_OPTIONS — keep in
// sync). preload: false — a browser fetches a file only when a tenant has
// picked that font, so most users download no font at all. next/font/local
// still emits font-display: swap and size-adjusted fallbacks.
const inter = localFont({ src: "./fonts/inter.woff2", weight: "100 900", variable: "--font-inter", display: "swap", preload: false });

// Was the default sans; now a tenant option (Segoe UI is the default).
const outfit = localFont({ src: "./fonts/outfit.woff2", weight: "100 900", variable: "--font-outfit", display: "swap", preload: false });

const libre = localFont({ src: "./fonts/libre-franklin.woff2", weight: "100 900", variable: "--font-libre", display: "swap", preload: false });
const source = localFont({ src: "./fonts/source-sans-3.woff2", weight: "200 900", variable: "--font-source", display: "swap", preload: false });
const hanken = localFont({ src: "./fonts/hanken-grotesk.woff2", weight: "100 900", variable: "--font-hanken", display: "swap", preload: false });

export const metadata: Metadata = {
  title: "Wola",
  description: "Staff loan management",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The tenant slug is set by middleware from the subdomain (or the on-prem
  // single-tenant pin). Read the tenant's brand from settings.brand and derive
  // the full CSS variable set. Falls back to the default forest-green theme
  // (empty vars) when a tenant has no brand configured.
  const slug = (await headers()).get("x-tenant-slug") ?? "";
  let brand: { primary?: string; accent?: string; font?: string } | null = null;
  if (slug) {
    try {
      const tenant = await resolveTenant(db, slug);
      const settings = (tenant?.settings ?? {}) as { brand?: { primary?: string; accent?: string; font?: string } };
      brand = settings.brand ?? null;
    } catch {
      brand = null; // never let theming break the app; fall back to default
    }
  }
  const brandStyle = themeStyle(brand);

  return (
    <html
      lang="en"
      className={cn(inter.variable, outfit.variable, hanken.variable, libre.variable, source.variable, "font-sans")}
      suppressHydrationWarning
    >
      <body
        data-tenant={slug}
        style={Object.keys(brandStyle).length ? brandStyle : undefined}
      >
        {children}
      </body>
    </html>
  );
}
