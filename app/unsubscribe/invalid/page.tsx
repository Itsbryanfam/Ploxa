import { Mascot } from "@/components/mascot/mascot";

export const metadata = { title: "Unsubscribe link invalid" };

export default function InvalidPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8">
      <Mascot size="lg" mood="idle" silent />
      <h1 className="text-2xl font-bold">This unsubscribe link is no longer valid.</h1>
      <p className="mt-2 text-sm text-[var(--text-dim)] max-w-md text-center">
        Visit{" "}
        <a href="/settings/notifications" className="underline">your settings</a>
        {" "}to update digest preferences directly.
      </p>
    </div>
  );
}
