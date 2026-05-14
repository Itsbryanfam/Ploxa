import type { MetadataRoute } from "next";

import { env } from "@/lib/env";

// Next.js 16 file convention. Served at /robots.txt.
// https://nextjs.org/docs/app/api-reference/file-conventions/metadata/robots
export default function robots(): MetadataRoute.Robots {
  const baseUrl = env.NEXT_PUBLIC_APP_URL;
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Keep auth-only routes and internal endpoints out of search results.
        // Public profiles/lists/games are linked from the sitemap.
        disallow: ["/api/", "/admin/", "/settings/", "/home/", "/library/"],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
