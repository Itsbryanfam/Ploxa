import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.9";
import { requireServiceRole } from "../_shared/auth.ts";
import { aggregate, type AggregateRow } from "../_shared/taste-engine.ts";

// `EdgeRuntime` is injected by the Supabase Edge Functions Deno runtime.
// `waitUntil` keeps the isolate alive until the promise settles so our
// fire-and-forget refresh-fingerprint trigger fetches actually complete
// after we return the cron response. Without it the isolate may terminate
// mid-fetch and trigger requests silently drop. Same pattern as daily-sync.
declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void;
} | undefined;

type Snapshot = {
  genre: Record<string, number>;
  theme: Record<string, number>;
  mechanic: Record<string, number>;
};

function cosineSim(a: Record<string, number>, b: Record<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const av = a[k] ?? 0;
    const bv = b[k] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function drift(current: Snapshot, snap: Snapshot): number {
  return Math.max(
    1 - cosineSim(current.genre, snap.genre),
    1 - cosineSim(current.theme, snap.theme),
    1 - cosineSim(current.mechanic, snap.mechanic),
  );
}

// Q5 boundary from T1's design — re-narrate when any vector axis drifts
// past 25% cosine distance from the snapshot.
const DRIFT_THRESHOLD = 0.25;

Deno.serve(async (req) => {
  // Auth: service-role key via `apikey` header. Same internal-service
  // pattern as refresh-fingerprint (T4), rerank-recs (T12), daily-sync (P3).
  const unauthorized = requireServiceRole(req);
  if (unauthorized) return unauthorized;

  const databaseUrl = Deno.env.get("DATABASE_URL")!;
  const functionsUrl =
    Deno.env.get("SUPABASE_FUNCTIONS_URL") ??
    Deno.env.get("SUPABASE_URL") + "/functions/v1";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sql = postgres(databaseUrl, { prepare: false });

  try {
    // 1. Find candidate users — those whose last narrative is > 7 days old.
    //    snapshot may be null for legacy rows written before T4 started
    //    populating narrative_snapshot_vectors; we treat null as "drifted"
    //    (Infinity) so those users get a fresh narrative on first scan.
    const candidates = await sql<
      Array<{ user_id: string; snapshot: Snapshot | null }>
    >`
      SELECT user_id, narrative_snapshot_vectors AS snapshot
      FROM taste_fingerprints
      WHERE narrative_generated_at IS NOT NULL
        AND narrative_generated_at < NOW() - INTERVAL '7 days'
    `;

    let drifted = 0;
    let scheduled = 0;
    // Concurrency cap = 10 — mirrors Phase 3 daily-sync. Each iteration
    // does a full vector recompute (logs JOIN games) so we batch to keep
    // peak DB connections bounded.
    const BATCH = 10;

    for (let i = 0; i < candidates.length; i += BATCH) {
      const slice = candidates.slice(i, i + BATCH);
      const jobs = slice.map(async (c) => {
        // Recompute current vectors. Uses EXISTS (not LEFT JOIN) to avoid
        // row multiplication when a log has 2+ published reviews. Matches
        // T4 refresh-fingerprint and the Next-side lib/taste/server-actions.ts.
        const rows = await sql<AggregateRow[]>`
          SELECT
            l.status,
            l.rating::float AS rating,
            EXISTS (
              SELECT 1 FROM reviews r
              WHERE r.log_id = l.id AND r.published_at IS NOT NULL
            ) AS has_published_review,
            g.genres,
            g.themes,
            g.mechanics,
            g.playtime_avg_hours::float AS playtime_avg_hours
          FROM logs l
          JOIN games g ON g.id = l.game_id
          WHERE l.user_id = ${c.user_id}
        `;
        if (rows.length === 0) return;
        const agg = aggregate(rows);
        const current: Snapshot = {
          genre: agg.genre,
          theme: agg.theme,
          mechanic: agg.mechanic,
        };
        const d = c.snapshot ? drift(current, c.snapshot) : Infinity;
        if (d > DRIFT_THRESHOLD) {
          drifted++;
          const triggerPromise = fetch(`${functionsUrl}/refresh-fingerprint`, {
            method: "POST",
            headers: {
              apikey: serviceRoleKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              userId: c.user_id,
              reason: "drift",
              driftValue: d,
            }),
          }).catch((err) =>
            console.error("taste-drift-cron trigger failed:", c.user_id, err),
          );
          if (typeof EdgeRuntime !== "undefined") {
            EdgeRuntime.waitUntil(triggerPromise);
          } else {
            // Local-dev fallback (no EdgeRuntime global) — await inline.
            await triggerPromise;
          }
          scheduled++;
        }
      });
      await Promise.all(jobs);
    }

    const summary = { scanned: candidates.length, drifted, scheduled };
    console.log("taste-drift-cron:", JSON.stringify(summary));
    return Response.json(summary);
  } finally {
    await sql.end({ timeout: 5 });
  }
});
