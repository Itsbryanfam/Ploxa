import { Mascot } from "@/components/mascot/mascot";

/**
 * /u/[username]/month/[yyyymm]/loading.tsx
 *
 * Phase 6 T16. Next.js renders this during the server-component suspension
 * window — between the user clicking through and `cacheOrBuildMonthly`
 * resolving. For a cached row the render is essentially instant; for a
 * fresh build the aggregator + AI captions sequence can take several
 * seconds, so a deliberate loading state matters here.
 *
 * Mirrors the yearly loading.tsx — same mascot pose, same dark-theme palette,
 * adapted copy for a monthly recap.
 */
export default function MonthPageLoading() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 p-8 text-center">
      <Mascot mood="thinking" size="lg" silent />
      <p className="text-lg text-[var(--text-dim)]">
        Reviewing your month&hellip;
      </p>
    </div>
  );
}
