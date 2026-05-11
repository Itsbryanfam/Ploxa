import { Mascot } from "@/components/mascot/mascot";

export default function Loading() {
  return (
    <div className="px-6 py-12 max-w-2xl mx-auto flex flex-col items-center gap-4">
      <Mascot size="md" mood="thinking" />
      <p className="text-sm text-[var(--text-dim)]">Setting up your interview…</p>
    </div>
  );
}
