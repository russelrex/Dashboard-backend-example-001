import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Credentials", value: "true" },
          { key: "Access-Control-Allow-Origin", value: "*" }, // Allow all for now
          { key: "Access-Control-Allow-Methods", value: "GET,DELETE,PATCH,POST,PUT,OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization" },
        ]
      }
    ]
  },
  turbopack: {},
  reactStrictMode: true,

  eslint: {
    // ✅ Temporarily disable blocking builds on ESLint errors (Vercel-friendly)
    ignoreDuringBuilds: true,
  },
  typescript: {
    // ✅ This disables type checking on builds (e.g., in Vercel)
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
