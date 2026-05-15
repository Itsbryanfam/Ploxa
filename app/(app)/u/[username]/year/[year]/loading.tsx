import { Mascot } from "@/components/mascot/mascot";

/**
 * /u/[username]/year/[year]/loading.tsx
 *
 * Phase 6 T11. Next.js renders this during the server-component suspension
 * window — between the user clicking through and `cacheOrBuildYearly`
 * resolving. For a cached row the render is essentially instant; for a
 * fresh build the aggregator + AI captions sequence can take several
 * seconds, so a deliberate loading state matters here.
 *
 * Mascot: `thinking` pose (matches SparseDataState's tone) with a `silent`
 * flag — the wall of mascot pose + caption "Reviewing your year…" is enough
 * communication without an extra speech bubble cluttering the frame.
 *
 * No client JS, no skeletons. The recap is a destination, not a list — a
 * skeleton would over-promise structure that's about to be replaced by a
 * full-screen Pageant. Keep this calm.
 */
export default function YearPageLoading() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 p-8 text-center">
      <Mascot mood="thinking" size="lg" silent />
      <p className="text-lg text-[var(--text-dim)]">
        Reviewing your year&hellip;
      </p>
    </div>
  );
}
