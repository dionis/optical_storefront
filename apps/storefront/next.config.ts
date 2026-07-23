import type { NextConfig } from "next";

const config: NextConfig = {
  images: {
    remotePatterns: [
      {
        // Cloudflare R2 CDN domain
        protocol: "https",
        hostname: process.env.NEXT_PUBLIC_CDN_HOSTNAME ?? "assets.example.com",
      },
    ],
  },
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
};

export default config;
