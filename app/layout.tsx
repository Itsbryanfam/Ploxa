import type { Metadata } from "next";
import { Geist, Geist_Mono, Pixelify_Sans } from "next/font/google";

import "./globals.css";
import { Providers } from "./providers";
import { env } from "@/lib/env";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const pixelifySans = Pixelify_Sans({
  variable: "--font-pixelify",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Ploxa",
    template: "%s · Ploxa",
  },
  description:
    "An AI-first game tracker with a pixel-art mascot. Log what you play, write reviews with help, discover what to play next.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
};

// Supabase preconnect target. The client-side Supabase SDK opens TLS
// connections to this origin for auth refreshes, storage reads (avatars
// render via the storage CDN), and any RPC traffic. Hinting it in <head>
// lets the browser kick off DNS + TLS in parallel with HTML parsing so
// the first auth request and the first avatar image don't pay for a
// cold handshake. Wrapped because env.NEXT_PUBLIC_SUPABASE_URL is
// optional in dev-before-Supabase-is-wired-up workflows.
const supabaseOrigin = env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(env.NEXT_PUBLIC_SUPABASE_URL).origin
  : null;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${pixelifySans.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {supabaseOrigin && (
          <>
            <link rel="preconnect" href={supabaseOrigin} crossOrigin="anonymous" />
            <link rel="dns-prefetch" href={supabaseOrigin} />
          </>
        )}
      </head>
      <body className="min-h-full flex flex-col bg-[var(--bg)] text-[var(--text)]">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
