import { type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Skip everything the auth-session refresh can't usefully act on:
    //   - Next internals: static chunks, image optimizer, RSC payload streams
    //   - Static asset extensions: images, fonts, CSS, JS, audio/video
    //   - Common root-served metadata files: favicon, robots, sitemap, manifest
    // Trimming these saves an Edge invocation + Supabase session-refresh
    // round-trip on every asset / RSC subrequest a page triggers.
    "/((?!_next/static|_next/image|_next/data|favicon\\.ico|robots\\.txt|sitemap\\.xml|manifest\\.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|mjs|woff|woff2|ttf|otf|mp4|webm|mp3|ogg|wav)$).*)",
  ],
};
