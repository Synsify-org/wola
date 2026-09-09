// apps/web/src/app/layout.tsx
// Loads the type and injects the TENANT BRAND.
//
// Only --color-brand moves per tenant. State colours (approved / rejected /
// awaiting) are system-owned and defined in globals.css â€” a tenant cannot
// brand them, because an approver must never misread a rejected document as
// a header colour.
import type { Metadata } from "next";
import { headers } from "next/headers";
import { Hanken_Grotesk, JetBrains_Mono, Inter, Libre_Franklin, Source_Sans_3, Outfit } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { resolveTenant } from "@wola/db";
import { db } from "@/lib/tenant";
import { themeStyle } from "@/lib/theme";

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

// Default sans since the Theme B refresh — see globals.css --font-sans.
const outfit = Outfit({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-outfit", display: "swap" });

const libre = Libre_Franklin({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-libre", display: "swap" });
const source = Source_Sans_3({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-source", display: "swap" });

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-hanken",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-jetbrains",
  display: "swap",
});

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
      className={cn(inter.variable, outfit.variable, hanken.variable, libre.variable, source.variable, jetbrains.variable, "font-sans")}
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
