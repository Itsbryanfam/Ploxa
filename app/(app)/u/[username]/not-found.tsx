import { EmptyState } from "@/components/ui/empty-state";

export default function ProfileNotFound() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <EmptyState mood="confused" title="No such profile." body="Try a different username." />
    </div>
  );
}
