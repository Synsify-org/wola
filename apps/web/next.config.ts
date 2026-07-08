import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@wola/db"],
  experimental: {
    serverActions: {
      allowedOrigins: [
        "testco.localhost:3000",
        "other.localhost:3000",
        "localhost:3000",
      ],
    },
  },
};

export default nextConfig;