// apps/web/src/app/layout.tsx
// Loads the type and injects the TENANT BRAND.
//
// Only --color-brand moves per tenant. State colours (approved / rejected /
// awaiting) are system-owned and defined in globals.css â€” a tenant cannot
// brand them, because an approver must never misread a rejected document as
// a header colour.
import type { Metadata } from "next";
import { headers } from "next/headers";
import { Hanken_Grotesk, JetBrains_Mono, Inter } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

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
  // The tenant slug is set by proxy.ts from the subdomain.
  const slug = (await headers()).get("x-tenant-slug") ?? "";

  // TODO(0008): read tenants.brand_color and set it here. Until that column
  // exists every tenant gets the default. The token architecture is already
  // in place â€” this is the only line that changes.
  const brand: string | null = null;

  return (
    <html
      lang="en"
      className={cn(inter.variable, jetbrains.variable, "font-sans")}
      suppressHydrationWarning
    >
      <body
        data-tenant={slug}
        style={brand ? ({ "--color-brand": brand } as React.CSSProperties) : undefined}
      >
        {children}
      </body>
    </html>
  );
}