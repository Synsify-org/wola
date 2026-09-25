import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@wola/db", "@wola/engine"],
  allowedDevOrigins: ["testco.local", "other.local"],
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