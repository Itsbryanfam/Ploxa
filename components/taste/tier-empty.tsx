import Link from "next/link";

import { Mascot } from "@/components/mascot/mascot";

/**
 * Empty-tier render — owner-only, since the only thing to show a non-owner
 * is the absence of data (which leaks profile state). The page route gates
 * non-owners to 404, so this only renders for the profile owner.
 *
 * Mascot mood "celebrating" maps to the plan's "excited" pose — welcoming a
 * brand-new logger who's about to start their fingerprint.
 */
export function TierEmpty() {
  return (
    <div className="flex flex-col items-center gap-6 py-16 text-center">
      <Mascot mood="celebrating" size="lg" silent />
      <div className="space-y-2">
        <h2 className="font-mono text-xl">No taste yet</h2>
        <p className="text-sm text-[var(--text-dim)]">
          Log a game and I&apos;ll start reading it.
        </p>
      </div>
      <Link
        href="/games"
        className="rounded-md bg-[var(--accent)] px-4 py-2 font-mono text-sm text-[var(--accent-fg)] transition-colors hover:bg-[var(--accent)]/90"
      >
        Find a game to log →
      </Link>
    </div>
  );
}
