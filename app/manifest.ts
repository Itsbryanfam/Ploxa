import type { MetadataRoute } from "next";

// Next.js 16 file convention. Served at /manifest.webmanifest.
// https://nextjs.org/docs/app/api-reference/file-conventions/metadata/manifest
//
// theme_color matches `--accent` from app/globals.css (#7c5cff).
// background_color matches `--bg` (the dark surface — used by Android's PWA
// splash screen).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Letterboxd for Games",
    short_name: "L4G",
    description:
      "An AI-first game tracker with a pixel-art mascot. Track every game, write better reviews, find your next obsession.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b0b0f",
    theme_color: "#7c5cff",
    // Only the favicon is dimension-clean. Mascot pixel-art lives at
    // 310x512 (non-square) and isn't the right shape for a PWA app icon.
    // Add a properly-sized maskable icon to public/icons/ later if we ship a
    // real install prompt.
    icons: [
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
      },
    ],
  };
}
