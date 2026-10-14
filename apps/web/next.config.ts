import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@wola/db", "@wola/engine"],
  // Never ship source maps to browsers: they expose the original source of every
  // client component. (Off by default; stated here so nobody turns it on to
  // debug and forgets.)
  productionBrowserSourceMaps: false,
  // Don't advertise the framework in an X-Powered-By header.
  poweredByHeader: false,
  allowedDevOrigins: ["testco.local", "other.local"],
  // One address per page, named the way the menu names it (see docs/ROUTES.md).
  //  - /reconciliation became /payroll. Kept as a permanent redirect because old
  //    notifications, bookmarks and exported links still point at it.
  //  - The rest are the addresses people guess; they land on the real page.
  // Query strings (?cycle=2026-08) pass through untouched.
  async redirects() {
    return [
      { source: "/reconciliation", destination: "/payroll", permanent: true },
      { source: "/reconciliation/:path*", destination: "/payroll/:path*", permanent: true },
      { source: "/dashboard", destination: "/", permanent: false },
      { source: "/home", destination: "/", permanent: false },
      { source: "/employees", destination: "/settings/employees", permanent: false },
      { source: "/staff", destination: "/settings/employees", permanent: false },
      { source: "/audit", destination: "/audit-log", permanent: false },
      { source: "/my-loans", destination: "/loans", permanent: false },
    ];
  },
  // Baseline security headers on every response.
  //  - frame-ancestors 'none' + X-Frame-Options: nothing may embed Wola in an
  //    iframe, so the login page can't be overlaid for clickjacking. (CSP is
  //    the modern control; XFO covers older browsers.)
  //  - nosniff: browsers must honour declared content types.
  //  - Referrer-Policy: don't leak full URLs (loan/application ids) to other
  //    sites.
  //  - HSTS: HTTPS only, including every tenant subdomain. Browsers ignore it
  //    over plain http, so local dev is unaffected.
  // A full script-src CSP needs per-request nonces for Next's inline scripts;
  // that's a separate change, deliberately not attempted here.
  async headers() {
    return [
      // Everything except the public sign-in page and the crawler/metadata files
      // is private: tell search engines (and caches) not to index or keep it,
      // even if a page's own meta tag were ever lost. See lib/site.ts.
      {
        source: "/((?!login$|robots\.txt$|sitemap\.xml$|llms\.txt$|icon\.svg$|apple-icon\.png$|favicon\.ico$|manifest\.webmanifest$|opengraph-image|twitter-image).*)",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }],
      },
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
  experimental: {
    // Import only the icons / chart parts / primitives actually used, not whole
    // barrel packages, to keep client bundles small.
    optimizePackageImports: ["lucide-react", "recharts", "radix-ui"],
    serverActions: {
      allowedOrigins: [
        "testco.local:3000",
        "other.local:3000",
        "localhost:3000",
      ],
    },
  },
};

export default nextConfig;