import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const apiInternalUrl = process.env.API_INTERNAL_URL ?? "http://localhost:8081";

const nextConfig: NextConfig = {
  output: "standalone",
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
      },
    },
  },
  experimental: {
    // Localized global 404 for unprefixed, unmatched paths (PRD 4.1).
    globalNotFound: true,
  },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${apiInternalUrl}/api/:path*` },
      { source: "/media/:path*", destination: `${apiInternalUrl}/media/:path*` },
      { source: "/sitemap.xml", destination: "/sitemap-index" },
      { source: "/sitemap-:file", destination: "/sitemap-locale/:file" },
    ];
  },
};

const withNextIntl = createNextIntlPlugin();
export default withNextIntl(nextConfig);
