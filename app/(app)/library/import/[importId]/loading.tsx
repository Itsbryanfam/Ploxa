export default function Loading() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <div className="border border-[var(--border)] rounded-md p-6 text-center space-y-3">
        <div className="h-4 w-40 mx-auto bg-[var(--bg-card)] rounded animate-pulse" />
        <div className="h-3 w-24 mx-auto bg-[var(--bg-card)] rounded animate-pulse" />
        <div className="h-1 bg-[var(--bg-card)] rounded max-w-[280px] mx-auto animate-pulse" />
      </div>
    </div>
  );
}
