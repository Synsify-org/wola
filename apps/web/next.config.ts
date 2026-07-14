import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@wola/db", "@wola/engine"],
  allowedDevOrigins: ["testco.local", "other.local"],
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