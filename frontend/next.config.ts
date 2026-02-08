import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Avoid Next.js inferring the monorepo root when multiple lockfiles exist.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
