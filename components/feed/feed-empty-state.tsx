import { Mascot } from "@/components/mascot/mascot";

export function FeedEmptyState(props: { mode: "no-followees-or-events" | "no-more" }) {
  if (props.mode === "no-more") {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-[var(--text-dim)]">You&apos;re caught up.</p>
      </div>
    );
  }
  return (
    <div className="text-center py-16">
      <Mascot size="lg" mood="idle" silent />
      <h2 className="mt-6 text-xl font-semibold">Your feed is empty</h2>
      <p className="mt-2 text-sm text-[var(--text-dim)] max-w-md mx-auto">
        Follow people whose taste overlaps with yours to see their reviews, logs, and lists here.
      </p>
      <a
        href="/discover/people"
        className="mt-6 inline-block px-4 py-2 text-sm rounded-md bg-[var(--accent)] text-[var(--accent-fg)] hover:opacity-90"
      >
        Find people to follow &rarr;
      </a>
    </div>
  );
}
