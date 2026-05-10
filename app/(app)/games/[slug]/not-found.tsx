import { EmptyState } from "@/components/ui/empty-state";
import { copy } from "@/lib/mascot/copy";

export default function GameNotFound() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <EmptyState mood="confused" title={copy("error.404")} body="That game isn't in our catalog." />
    </div>
  );
}
