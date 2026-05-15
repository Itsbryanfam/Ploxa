import Link from "next/link";

import { Mascot } from "@/components/mascot/mascot";

/**
 * SparseDataState — Phase 6 T10.
 *
 * Empty state for users whose recap window has fewer than 10 logs. Rendered
 * by the YIR page route (`/u/[username]/year/[year]`) when `buildRecap`
 * returns `{ tier: "too_sparse" }`, in lieu of the full Pageant.
 *
 * Tone: neutral + warm. No exclamation marks, no emojis — the user hit a
 * once-a-year page and got "not yet"; the copy should land as observational,
 * not disappointed and not chirpy.
 *
 * Mascot: `thinking` pose, `silent` (no speech bubble). The pose reads as
 * "considering quietly" — quieter than `pointing` (a CTA nudge) which is
 * the choice used by the always-on taste-tier sparse view. The recap is a
 * destination, not an instruction, so a softer pose fits.
 *
 * Reduced motion: the global mascot CSS in `app/globals.css` already
 * disables sprite animation under `@media (prefers-reduced-motion: reduce)`
 * (see the `.mascot-root .mascot-sprite { animation: none; }` block). No
 * additional motion is introduced here, so this state honors that pref by
 * inheritance.
 *
 * CTA: a `<Link>` (not a button) back to the user's profile. Matches the
 * pattern from `components/feed/feed-empty-state.tsx` and other empty
 * states across the app.
 */
export function SparseDataState({ username }: { username: string }) {
  return (
    <div className="text-center py-16">
      <Mascot size="lg" mood="thinking" silent />
      <h2 className="mt-6 text-xl font-semibold text-[var(--text)]">
        Not enough yet
      </h2>
      <p className="mt-2 text-sm text-[var(--text-dim)] max-w-md mx-auto">
        Come back when you&apos;ve logged a few more. Your year-in-review
        unlocks once there&apos;s enough to look back on.
      </p>
      <Link
        href={`/u/${username}`}
        className="mt-6 inline-block px-4 py-2 text-sm rounded-md bg-[var(--accent)] text-[var(--accent-fg)] hover:opacity-90"
      >
        Back to profile
      </Link>
    </div>
  );
}
