import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

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
  webpack: (webpackConfig) => {
    // @eyewear/shared resolves to its TypeScript source (via tsconfig paths), and its
    // NodeNext moduleResolution requires internal relative imports to use ".js" extensions
    // pointing at the eventual compiled output. Webpack (unlike tsc) doesn't resolve those
    // to the sibling ".ts" source files by default.
    webpackConfig.resolve.extensionAlias = {
      ...webpackConfig.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return webpackConfig;
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(config);
