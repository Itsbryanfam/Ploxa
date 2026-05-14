import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Mascot } from "@/components/mascot/mascot";
import { env } from "@/lib/env";
import { getCachedUser } from "@/lib/supabase/auth-cache";

export default async function HomePage() {
  // Redirect signed-in users to the cockpit
  if (env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const user = await getCachedUser();
    if (user) {
      redirect("/home");
    }
  }

  return (
    <main className="flex min-h-screen flex-col">
      <header className="border-b border-[var(--border-soft)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center" aria-label="Ploxa home">
            <Image
              src="/logo/logo.png"
              alt="Ploxa"
              width={140}
              height={40}
              priority
              className="pixelated h-10 w-auto"
            />
          </Link>
          <nav className="flex items-center gap-3">
            <Link href="/login">
              <Button variant="ghost" size="sm">
                Log in
              </Button>
            </Link>
            <Link href="/signup">
              <Button variant="primary" size="sm">
                Sign up
              </Button>
            </Link>
          </nav>
        </div>
      </header>

      <section className="glow-bg relative flex flex-1 items-center justify-center px-6 py-24">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-12 flex justify-center">
            <Mascot
              size="xl"
              mood="waving"
              message="Hey, I'm here to help you remember every game you've played."
            />
          </div>
          <h1 className="text-5xl font-bold tracking-tight md:text-6xl">
            <span className="bg-gradient-to-br from-white to-[var(--text-dim)] bg-clip-text text-transparent">
              Track every game.
            </span>
            <br />
            <span className="text-[var(--text)]">Write better reviews.</span>
            <br />
            <span className="text-[var(--accent)]">Find your next obsession.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg text-[var(--text-dim)]">
            An AI-first game tracker with a pixel-art mascot. Built for people who love games
            and have opinions.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Link href="/signup">
              <Button variant="primary" size="lg">
                Get started — free
              </Button>
            </Link>
            <Link href="/login">
              <Button variant="secondary" size="lg">
                I already have an account
              </Button>
            </Link>
          </div>
          <p className="mt-6 text-xs text-[var(--text-faint)]">
            No credit card. No spam. Your gaming history stays yours.
          </p>
        </div>
      </section>

      <footer className="border-t border-[var(--border-soft)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4 text-xs text-[var(--text-faint)]">
          <span>Made with care for people who love games.</span>
          <span className="font-mono">▓▓▓▓▓▓▓▓▓▓</span>
        </div>
      </footer>
    </main>
  );
}
