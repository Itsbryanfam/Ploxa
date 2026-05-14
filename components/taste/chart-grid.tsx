import { ScoreBar } from "./score-bar";
import type { LengthBucket } from "@/lib/taste/aggregate";

type SparseVector = Record<string, number>;
type LengthPreference = Record<string, number>;

function topN(vec: SparseVector, n: number): Array<[string, number]> {
  return Object.entries(vec)
    .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
    .slice(0, n);
}

export function ChartGrid({
  vectors,
  lengthPreference,
}: {
  vectors: {
    genre: SparseVector;
    theme: SparseVector;
    mechanic: SparseVector;
    gameMode: SparseVector;
    playerPerspective: SparseVector;
  };
  lengthPreference: LengthPreference;
}) {
  const genres = topN(vectors.genre, 5);
  const themes = topN(vectors.theme, 5);
  const mechanics = topN(vectors.mechanic, 5);
  const modes = topN(vectors.gameMode, 5);
  const perspectives = topN(vectors.playerPerspective, 5);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      <ChartCard title="Top Genres">
        {genres.length === 0 ? (
          <Empty />
        ) : (
          genres.map(([k, v]) => <ScoreBar key={k} value={v} label={k} />)
        )}
      </ChartCard>

      <ChartCard title="Top Themes">
        {themes.length === 0 ? (
          <Empty />
        ) : (
          themes.map(([k, v]) => <ScoreBar key={k} value={v} label={k} />)
        )}
      </ChartCard>

      <ChartCard title="Top Mechanics">
        {mechanics.length === 0 ? (
          <Empty />
        ) : (
          mechanics.map(([k, v]) => <ScoreBar key={k} value={v} label={k} />)
        )}
      </ChartCard>

      <ChartCard title="Game Modes">
        {modes.length === 0 ? (
          <Empty />
        ) : (
          modes.map(([k, v]) => <ScoreBar key={k} value={v} label={k} />)
        )}
      </ChartCard>

      <ChartCard title="Player Perspectives">
        {perspectives.length === 0 ? (
          <Empty />
        ) : (
          perspectives.map(([k, v]) => <ScoreBar key={k} value={v} label={k} />)
        )}
      </ChartCard>

      <ChartCard title="Session Length">
        <LengthDistribution data={lengthPreference} />
      </ChartCard>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-dim)]">
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Empty() {
  return <p className="text-xs text-[var(--text-faint)]">No signal yet.</p>;
}

function LengthDistribution({ data }: { data: LengthPreference }) {
  const buckets: Array<[LengthBucket, string]> = [
    ["<5h", "<5 hrs"],
    ["5-10h", "5–10 hrs"],
    ["10-30h", "10–30 hrs"],
    ["30-60h", "30–60 hrs"],
    ["60h+", "60+ hrs"],
  ];
  return (
    <>
      {buckets.map(([k, label]) => (
        <ScoreBar key={k} value={data[k] ?? 0} label={label} />
      ))}
    </>
  );
}
