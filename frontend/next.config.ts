import type { NextConfig } from "next";
import path from "node:path";

const backendUrl = process.env.BACKEND_URL?.replace(/\/+$/, "");

const nextConfig: NextConfig = {
  // Avoid Next.js inferring the monorepo root when multiple lockfiles exist.
  turbopack: {
    root: path.resolve(__dirname),
  },
  async rewrites() {
    if (!backendUrl) return [];
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
