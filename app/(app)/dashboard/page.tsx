import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Mascot } from "@/components/mascot/mascot";

export const metadata = {
  title: "Dashboard",
};

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <div className="mb-12 flex flex-col items-center gap-4 text-center">
        <Mascot size="lg" mood="celebrating" message="You're in! Phase 1 starts soon." />
        <h1 className="mt-4 text-3xl font-bold tracking-tight">Welcome to your dashboard</h1>
        <p className="max-w-md text-[var(--text-dim)]">
          You've successfully signed in. The good stuff (logging games, AI reviews, recommendations)
          comes online in the next phases.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Phase 1: Logging</CardTitle>
            <CardDescription>Coming next — search RAWG, log games, build your library.</CardDescription>
          </CardHeader>
          <CardContent>
            <span className="text-xs uppercase tracking-wide text-[var(--text-faint)]">In progress</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Phase 2: AI Reviews</CardTitle>
            <CardDescription>The mascot interviews you and drafts your reviews.</CardDescription>
          </CardHeader>
          <CardContent>
            <span className="text-xs uppercase tracking-wide text-[var(--text-faint)]">Planned</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Phase 3: Imports</CardTitle>
            <CardDescription>One-click Steam, Xbox, and (beta) PSN library import.</CardDescription>
          </CardHeader>
          <CardContent>
            <span className="text-xs uppercase tracking-wide text-[var(--text-faint)]">Planned</span>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
