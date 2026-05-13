import { Mascot } from "@/components/mascot/mascot";

export const metadata = { title: "Unsubscribed" };

export default function ConfirmedPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8">
      <Mascot size="lg" mood="idle" silent />
      <h1 className="mt-6 text-2xl font-bold">{"You're unsubscribed."}</h1>
      <p className="mt-2 text-sm text-[var(--text-dim)] max-w-md text-center">
        {"We won't send you digest emails anymore. You can re-enable them anytime in "}
        <a href="/settings/notifications" className="underline">your settings</a>.
      </p>
    </div>
  );
}
