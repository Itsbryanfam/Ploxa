import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "media.rawg.io" },
      // Steam library_600x900_2x.jpg — portrait box art, populated by
      // lib/games/poster-source.ts and consumed wherever games.posterUrl
      // is read. Verified live 2026-05-11.
      { protocol: "https", hostname: "cdn.cloudflare.steamstatic.com" },
      // SteamGridDB hosts user-uploaded covers across several CDN hosts.
      // The `cdn2.steamgriddb.com` host is the current canonical (per the
      // v2 API responses) — leaving this conservative.
      { protocol: "https", hostname: "cdn2.steamgriddb.com" },
      { protocol: "https", hostname: "cdn.steamgriddb.com" },
    ],
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60 * 60 * 24 * 30, // 30 days
  },
  compiler: {
    removeConsole: { exclude: ["error", "warn"] },
  },
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "framer-motion",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-slot",
    ],
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
};

export default withBundleAnalyzer(nextConfig);
